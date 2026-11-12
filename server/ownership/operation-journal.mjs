import { constants } from 'node:fs';
import { open, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { replaceMetadata, syncMetadataDirectory } from './metadata.mjs';
import { ownerSchema } from '@autohand/squad-portable';
import { actorKey, ownerKey } from './identity.mjs';
import { ownedDirectory, readDataset } from './datasets.mjs';
import { acquireWriterLease } from './writer-lease.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const phases = z.enum(['requested', 'draining', 'staging', 'publishing', 'awaiting_restart', 'complete', 'failed']);
const kindSchema = z.enum(['restore','reset','legacy-import']);
const resultSchema=z.object({memberCount:z.number().int().nonnegative(),fileCount:z.number().int().nonnegative(),routineCount:z.number().int().nonnegative(),warningCount:z.number().int().nonnegative(),warningSamples:z.array(z.string().max(1000)).max(10)}).strict();
const intentSchema = z.object({ id:z.uuid(), kind:kindSchema, beforeDatasetId:z.uuid(), sourceId:z.uuid().nullable().default(null), sourceDigest:hex.nullable().default(null) }).strict()
  .refine(value => value.kind==='reset' ? value.sourceId===null && value.sourceDigest===null : value.sourceId!==null && value.sourceDigest!==null, 'Restore needs a verified source; reset must not have one.');
const rowSchema = z.object({ version:z.literal(1), revision:z.number().int().positive(), id:z.uuid(), kind:kindSchema, ownerKey:hex, actorKey:hex,
  beforeDatasetId:z.uuid(), afterDatasetId:z.uuid().nullable(), sourceId:z.uuid().nullable(), sourceDigest:hex.nullable(), intentHash:hex,
  phase:phases, error:z.string().max(2000), createdAt:z.iso.datetime(), updatedAt:z.iso.datetime(),acknowledgedBy:hex.optional(),result:resultSchema.optional() }).strict()
  .refine(row => row.afterDatasetId===null || row.afterDatasetId!==row.beforeDatasetId, 'A staged dataset must differ from the previous dataset.');
const patchSchema = z.object({ phase:phases, afterDatasetId:z.uuid().optional(), error:z.string().max(2000).optional(),result:resultSchema.optional() }).strict();
const nextPhases = { requested:['draining','failed'], draining:['staging','failed'], staging:['publishing','failed'], publishing:['awaiting_restart','failed'], awaiting_restart:['complete'], complete:[], failed:[] };
const fail = (message, code='operation_changed', status=409) => Object.assign(Error(message), {status,code});

async function readRow(path) {
  let file;
  try {
    file=await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const info=await file.stat(); if(!info.isFile()||info.nlink!==1||info.size>16*1024) throw fail('The data operation receipt is unsafe. Existing data was preserved.','operation_record_invalid',503);
    return rowSchema.parse(JSON.parse(await file.readFile('utf8')));
  } catch(error) { if(error.code==='ENOENT') return null; throw error; }
  finally {await file?.close();}
}
async function writeRow(directory, row) {
  const temporary=join(directory,`.operation-${randomUUID()}.tmp`);
  try {
    const file=await open(temporary,'wx',0o600);
    try {await file.writeFile(`${JSON.stringify(row)}\n`);await file.sync();} finally {await file.close();}
    await replaceMetadata(temporary,join(directory,`${row.id}.json`));
    await syncMetadataDirectory(directory);
  } finally {await rm(temporary,{force:true}).catch(()=>{});}
}

/** Internal metadata only. The broker must hold its machine writer lease,
 * freshly authorize the actor, and drain writers before reconciliation/data
 * mutation. This journal never grants imported content execution authority. */
export async function createOperationJournal({serviceRoot,owner:inputOwner,actor}) {
  const owner=ownerSchema.parse(inputOwner), key=ownerKey(owner), initiator=actorKey(actor);
  if(owner.issuer!==actor.issuer || (owner.kind==='user' && owner.id!==actor.id)) throw fail('This operation belongs to a different owner.','owner_mismatch',403);
  const directory=await ownedDirectory(serviceRoot,['owners',key,'operations']);
  const lockPath=join(await ownedDirectory(serviceRoot,['owners',key]),'operations.sqlite');
  const checked = async id => {
    z.uuid().parse(id); const row=await readRow(join(directory,`${id}.json`));
    if(row && (row.ownerKey!==key || row.id!==id)) throw fail('The data operation receipt belongs to another Squad.','operation_record_invalid',503);
    return row;
  };
  async function exclusive(action) {const release=await acquireWriterLease(lockPath);try{return await action();}finally{release();}}
  async function create(value) {
    const intent=intentSchema.parse(value);
    return exclusive(async()=>{
      const existing=await checked(intent.id), intentHash=hash(intent);
      if(existing) {
        if(existing.actorKey!==initiator || existing.intentHash!==intentHash) throw fail('This request ID already belongs to another data operation.');
        return existing;
      }
      const selected=await readDataset(serviceRoot,key);
      if(selected?.datasetId!==intent.beforeDatasetId) throw fail('This Squad changed before the operation started.','dataset_changed');
      const now=new Date().toISOString();
      const row=rowSchema.parse({...intent,version:1,revision:1,ownerKey:key,actorKey:initiator,intentHash,afterDatasetId:null,phase:'requested',error:'',createdAt:now,updatedAt:now});
      await writeRow(directory,row);return row;
    });
  }
  async function update(id, revision, value) {
    const patch=patchSchema.parse(value);
    return exclusive(async()=>{
      const before=await checked(id);
      if(!before || before.actorKey!==initiator) throw fail('This data operation is unavailable for the current account.','operation_not_found',404);
      if(before.revision!==revision || !nextPhases[before.phase].includes(patch.phase)) throw fail('This data operation advanced elsewhere. Read its receipt before continuing.');
      if(patch.afterDatasetId && before.afterDatasetId && patch.afterDatasetId!==before.afterDatasetId) throw fail('A data operation cannot change its staged dataset.');
      if(patch.afterDatasetId && !before.afterDatasetId && patch.phase!=='staging') throw fail('A dataset can only be assigned while staging.');
      const row=rowSchema.parse({...before,...patch,revision:before.revision+1,updatedAt:new Date().toISOString()});
      if(['staging','publishing','awaiting_restart','complete'].includes(row.phase) && !row.afterDatasetId) throw fail('A data operation needs a distinct staged dataset before publication.');
      await writeRow(directory,row);return row;
    });
  }
  async function get(id) {
    const row=await checked(id);
    if(!row || row.actorKey!==initiator) throw fail('This data operation is unavailable for the current account.','operation_not_found',404);
    return row;
  }
  async function reconcile() {
    return exclusive(async()=>{
      const names=await readdir(directory); if(names.length>10_000) throw fail('This Squad has too many operation records for automatic recovery. Existing data was preserved.','operation_record_limit',503);
      const pointer=await readDataset(serviceRoot,key), pending=[];
      for(const name of names.filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).sort()) {
        let row=await checked(name.slice(0,-5));
        if(!row || row.phase==='complete') continue;
        if(row.afterDatasetId && pointer?.datasetId===row.afterDatasetId) {
          if(row.phase!=='awaiting_restart') {row={...row,phase:'awaiting_restart',error:'',revision:row.revision+1,updatedAt:new Date().toISOString()};await writeRow(directory,row);}
          pending.push(row);continue;
        }
        if(row.phase==='failed') continue;
        row={...row,phase:'failed',error:pointer?.datasetId===row.beforeDatasetId?'The interrupted operation did not publish new data. Your previous data is still selected.':'Another operation changed the selected data. This receipt cannot publish it again.',revision:row.revision+1,updatedAt:new Date().toISOString()};
        await writeRow(directory,row);
      }
      return pending;
    });
  }
  // The broker freshly authorizes resources:operate before calling this.
  // A different team operator may acknowledge the already-published dataset,
  // while the original initiator and source remain immutable audit evidence.
  async function acknowledge(id,revision) {
    return exclusive(async()=>{
      const row=await checked(id),pointer=await readDataset(serviceRoot,key);
      if(!row||row.revision!==revision||row.phase!=='awaiting_restart'||pointer?.datasetId!==row.afterDatasetId)throw fail('This completed data operation changed. Refresh its completion screen.');
      const complete={...row,phase:'complete',acknowledgedBy:initiator,revision:row.revision+1,updatedAt:new Date().toISOString()};
      await writeRow(directory,complete);return complete;
    });
  }
  return {create,update,get,reconcile,acknowledge};
}
