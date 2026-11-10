import { constants } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseBackup, MAX_DOCUMENT_BYTES, ownerSchema } from '@autohand/squad-portable';
import { actorKey, ownerKey } from './identity.mjs';
import { datasetPaths, ownedDirectory } from './datasets.mjs';
import { acquireWriterLease } from './writer-lease.mjs';
import { planRestore } from './restore.mjs';
import { replaceMetadata, syncMetadataDirectory } from './metadata.mjs';

const hex=z.string().regex(/^[a-f0-9]{64}$/);
const sourceSchema=z.object({version:z.literal(1),id:z.uuid(),ownerKey:hex,actorKey:hex,format:z.enum(['json','yaml']),bytes:z.number().int().nonnegative().max(MAX_DOCUMENT_BYTES),sha256:hex,
  createdAt:z.iso.datetime(),expiresAt:z.iso.datetime(),sourceOwner:ownerSchema,memberCount:z.number().int().nonnegative().max(10_000),fileCount:z.number().int().nonnegative().max(100_000),routineCount:z.number().int().nonnegative(),workspaceCount:z.number().int().nonnegative(),
  memberSamples:z.array(z.object({name:z.string().max(120),role:z.string().max(120)}).strict()).max(20),omissionCount:z.number().int().nonnegative(),omissionSamples:z.array(z.object({path:z.string().max(240),reason:z.string().max(240)}).strict()).max(10),warningSamples:z.array(z.string().max(1000)).max(10).default([])}).strict();
const fail=(message,status=409,code='import_source_changed')=>Object.assign(Error(message),{status,code});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const label=value=>String(value||'').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'').slice(0,120);

async function privateBytes(path,maximum) {
  let file;
  try {
    file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    const before=await file.stat();
    if(!before.isFile()||before.nlink!==1||before.size>maximum) throw fail('This saved import source is unsafe or exceeds its size limit.');
    const chunks=[];let size=0;
    for await(const chunk of file.createReadStream({autoClose:false,end:maximum})) {size+=chunk.length;if(size>maximum)throw fail('This saved import source exceeds its size limit.');chunks.push(chunk);}
    const after=await file.stat();
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs) throw fail('This import source changed while it was being read. Choose it again.');
    return Buffer.concat(chunks,size);
  } finally {await file?.close();}
}
async function durableFile(directory, filename, bytes) {
  const temporary=join(directory,`.source-${randomUUID()}.tmp`);
  try {
    const file=await open(temporary,'wx',0o600);
    try {await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    await replaceMetadata(temporary,join(directory,filename));
    await syncMetadataDirectory(directory);
  } finally {await rm(temporary,{force:true}).catch(()=>{});}
}

/** Verified upload plans contain no execution capability. The immutable source
 * is kept outside datasets and scoped to both owner and initiating actor, so a
 * pointer publication cannot lose it and another actor cannot adopt it. */
export function createImportSources({context,assertCurrent}) {
  if(!context.owner||!context.actor||typeof assertCurrent!=='function') throw Error('Import sources require a captured authorized context.');
  const key=ownerKey(context.owner),initiator=actorKey(context.actor);
  if(context.owner.issuer!==context.actor.issuer || (context.owner.kind==='user' && context.owner.id!==context.actor.id)) throw fail('This import belongs to a different account.',403,'owner_mismatch');
  const parts=['owners',key,'imports',initiator];
  async function directory() {assertCurrent();return ownedDirectory(context.serviceRoot,parts);}
  async function readPlan(id,{allowExpired=false}={}) {
    z.uuid().parse(id);const root=await directory();
    let bytes;try{bytes=await privateBytes(join(root,`${id}.plan.json`),32*1024);}catch(error){if(error.code==='ENOENT')throw fail('This import preview is unavailable for the selected account.',404,'import_source_not_found');throw error;}
    const plan=sourceSchema.parse(JSON.parse(bytes.toString('utf8')));
    if(plan.id!==id||plan.ownerKey!==key||plan.actorKey!==initiator) throw fail('This import belongs to a different account or Squad.',403,'owner_mismatch');
    if(!allowExpired&&Date.parse(plan.expiresAt)<=Date.now()) throw fail('This import preview expired. Choose the backup again.',410,'import_expired');
    assertCurrent();return plan;
  }
  async function prepare({bytes,format,id=randomUUID()}) {
    assertCurrent(); z.uuid().parse(id);z.enum(['json','yaml']).parse(format);
    if(!context.canWrite) throw fail('This Squad is read-only. Choose a writable owner to import data.',403,'owner_read_only');
    if(!(bytes instanceof Uint8Array)||bytes.byteLength>MAX_DOCUMENT_BYTES) throw fail('Choose a JSON or YAML backup up to 256 MiB.',413,'invalid_backup');
    const body=Buffer.from(bytes), digest=sha(body);
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(body);}catch{throw fail('Choose a UTF-8 JSON or YAML backup.',400,'invalid_backup');}
    const document=await parseBackup(text,format);assertCurrent();
    const compatibility=planRestore(document,{owner:context.owner,staged:datasetPaths(context.serviceRoot,key,randomUUID())});
    const root=await directory(), release=await acquireWriterLease(join(root,'sources.sqlite'));
    try {
      try {
        const existing=await readPlan(id);
        if(existing.sha256!==digest||existing.format!==format) throw fail('This import request already refers to a different file.');
        const saved=await privateBytes(join(root,`${id}.${format}`),MAX_DOCUMENT_BYTES);
        if(saved.byteLength!==existing.bytes||sha(saved)!==digest) throw fail('The saved source changed after its preview. Choose the backup again.');
        assertCurrent();
        return existing;
      } catch(error) {if(error.code!=='import_source_not_found') throw error;}
      const now=Date.now();
      const plan=sourceSchema.parse({version:1,id,ownerKey:key,actorKey:initiator,format,bytes:body.byteLength,sha256:digest,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+24*60*60*1000).toISOString(),
        sourceOwner:document.owner,memberCount:document.agents.length,fileCount:document.files.length,routineCount:document.agents.reduce((sum,agent)=>sum+agent.routines.length,0),workspaceCount:document.workspaces.length,
        memberSamples:document.agents.slice(0,20).map(agent=>({name:label(agent.profile.name||agent.id),role:label(agent.profile.role)})),omissionCount:document.omissions.length,
        omissionSamples:document.omissions.slice(0,10).map(item=>({path:item.path.slice(0,240),reason:item.reason.slice(0,240)})),warningSamples:compatibility.warnings.slice(0,10)});
      assertCurrent();await durableFile(root,`${id}.${format}`,body);assertCurrent();
      await durableFile(root,`${id}.plan.json`,Buffer.from(`${JSON.stringify(plan)}\n`));assertCurrent();
      return plan;
    } finally {release();}
  }
  async function load(id) {
    const plan=await readPlan(id),root=await directory();
    const bytes=await privateBytes(join(root,`${id}.${plan.format}`),MAX_DOCUMENT_BYTES);assertCurrent();
    if(bytes.byteLength!==plan.bytes||sha(bytes)!==plan.sha256) throw fail('This import source no longer matches its preview. Choose the file again.');
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw fail('The saved import source is not valid UTF-8.');}
    const document=await parseBackup(text,plan.format);assertCurrent();return {plan,document};
  }
  return {prepare,get:readPlan,load};
}
