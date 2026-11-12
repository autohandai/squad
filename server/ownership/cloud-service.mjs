import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { parseBackup, decodeFile, inventory, checkStructure, validateState, ownerSchema, MAX_DOCUMENT_BYTES } from '@autohand/squad-portable';
import { ownedDirectory } from './datasets.mjs';
import { actorKey, ownerKey } from './identity.mjs';
import { acquireWriterLease } from './writer-lease.mjs';
import { OwnedAgentRepository } from './repository.mjs';
import { createOwnedCloudClient } from './cloud-backups.mjs';
import { createSquadApi, squadApiUrl } from '../squad-cloud/client.mjs';
import { createImportSources } from './import-sources.mjs';
import { replaceMetadata, syncMetadataDirectory } from './metadata.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,status=409,code='cloud_backup_conflict')=>Object.assign(Error(message),{status,code});
const contentHash=value=>sha(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)??'undefined');
const recordSchema=z.object({baseRevision:z.number().int().nonnegative(),desiredHash:z.string().regex(/^[a-f0-9]{64}$/),committedRevision:z.number().int().positive().optional()}).strict();
const conflictSchema=z.object({key:z.string(),kind:z.enum(['agent','squad']),id:z.string(),remoteRevision:z.number().int().nonnegative(),remoteHash:z.string(),localHash:z.string()}).strict();
const operationSchema=z.object({version:z.literal(1),id:z.uuid(),backupId:z.uuid(),datasetId:z.uuid(),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/),label:z.string().min(1).max(120),
  phase:z.enum(['uploading','conflicts','freezing','complete','failed']),records:z.record(z.string(),recordSchema),uploaded:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(100_000),conflicts:z.array(conflictSchema).max(10_001),
  planId:z.uuid().nullable(),freezeAttempt:z.number().int().nonnegative().default(0),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime(),error:z.string().max(1000)}).strict();
const sessionSchema=z.object({version:z.literal(1),actorKey:z.string(),ownerKey:z.string(),apiOrigin:z.url(),fingerprint:z.string(),token:z.string().regex(/^ss_[a-f0-9]{64}$/),expiresAt:z.iso.datetime()}).strict();
const publicOperation=operation=>({id:operation.id,backupId:operation.backupId,phase:operation.phase,label:operation.label,planId:operation.planId,conflicts:operation.conflicts,
  publishedRecords:Object.values(operation.records).filter(record=>record.committedRevision).length,uploadedFiles:operation.uploaded.length,updatedAt:operation.updatedAt,error:operation.error});

async function privateBytes(path,maximum) {
  let file;
  try {
    file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const before=await file.stat();
    if(!before.isFile()||before.nlink!==1||before.size>maximum)throw fail('A private cloud backup record is unsafe or exceeds its read limit.',503,'cloud_record_invalid');
    const bytes=await file.readFile();const after=await file.stat();
    if(bytes.length>maximum||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw fail('A private cloud backup record changed while being read.');
    return bytes;
  }finally{await file?.close();}
}
async function privateJson(path,fallback,maximum=8*1024*1024) {
  try{const value=JSON.parse((await privateBytes(path,maximum)).toString('utf8'));checkStructure(value,200_000);return value;}catch(error){if(error.code==='ENOENT')return fallback;throw error;}
}
async function durableJson(directory,filename,value,assertCurrent) {
  const temporary=join(directory,`.cloud-${randomUUID()}.tmp`),bytes=Buffer.from(`${JSON.stringify(value)}\n`);
  if(bytes.length>8*1024*1024)throw fail('This cloud operation exceeds its local metadata limit.',413,'cloud_record_limit');
  try {
    assertCurrent();const file=await open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    assertCurrent();await replaceMetadata(temporary,join(directory,filename));
    await syncMetadataDirectory(directory);
    assertCurrent();
  }finally{await rm(temporary,{force:true}).catch(()=>{});}
}

/** Explicit cloud operations only; constructing/discovering local ownership
 * never uploads data. A factory is immutable for actor, owner and credential. */
export function createOwnedCloudBackups({context,assertCurrent,identityToken,baseUrl,fetchImpl=fetch,signal}) {
  const key=ownerKey(context.owner),actor=actorKey(context.actor),origin=squadApiUrl(baseUrl),fingerprint=sha(identityToken);
  if(!identityToken||typeof assertCurrent!=='function'||context.owner.issuer!==context.actor.issuer||context.owner.kind==='user'&&context.owner.id!==context.actor.id)throw fail('Choose a verified owner before connecting cloud backups.',403,'owner_mismatch');
  const repository=new OwnedAgentRepository(context,{assertCurrent});
  async function directory(){assertCurrent();return ownedDirectory(context.serviceRoot,['owners',key,'cloud',actor]);}
  async function client() {
    const root=await directory(),release=await acquireWriterLease(join(root,'session.sqlite'));
    try {
      let session=await privateJson(join(root,'session.json'),null,64*1024);
      if(session)session=sessionSchema.parse(session);
      const reusable=session?.actorKey===actor&&session.ownerKey===key&&session.apiOrigin===origin&&session.fingerprint===fingerprint&&Date.parse(session.expiresAt)>Date.now()+60_000;
      if(!reusable) {
        const exchanged=await createSquadApi({baseUrl:origin,fetchImpl,signal}).request('/v1/auth/exchange',{method:'POST',body:{identityToken,deviceName:'Squad owned backups'}});assertCurrent();
        session=sessionSchema.parse({version:1,actorKey:actor,ownerKey:key,apiOrigin:origin,fingerprint,token:exchanged.token,expiresAt:exchanged.expiresAt});
      }
      const identityApi=createSquadApi({baseUrl:origin,fetchImpl,token:session.token,signal}),me=await identityApi.request('/v1/me');assertCurrent();
      if(me.issuer!==context.actor.issuer||me.subject!==context.actor.id)throw fail('The cloud session belongs to a different immutable identity. Local data is unchanged.',403,'cloud_identity_mismatch');
      if(!reusable)await durableJson(root,'session.json',session,assertCurrent);
      return createOwnedCloudClient({owner:context.owner,token:session.token,identityToken:context.owner.kind==='team'?identityToken:undefined,baseUrl:origin,fetchImpl,assertCurrent,signal});
    }finally{release();}
  }
  async function getOperation(id) {
    z.uuid().parse(id);const root=await directory(),operation=await privateJson(join(root,`${id}.json`),null);
    if(!operation)throw fail('This cloud operation is unavailable for this actor and owner.',404,'cloud_operation_not_found');
    const parsed=operationSchema.parse(operation);if(parsed.id!==id)throw fail('This cloud operation record is invalid.',503,'cloud_record_invalid');
    assertCurrent();return publicOperation(parsed);
  }
  async function localBackup(id) {
    z.uuid().parse(id);const receipt=await repository.json(context.dataRoot,join(context.dataRoot,'backups',`${id}.receipt.json`),null);
    if(!receipt||!ownerSchema.safeParse(receipt.owner).success||!['json','yaml'].includes(receipt.format)||receipt.filename!==`${id}.${receipt.format}`||ownerKey(receipt.owner)!==key)throw fail('Choose a local backup from the selected dataset.',404,'backup_not_found');
    const opened=await repository.openFile(context.dataRoot,join(context.dataRoot,'backups',receipt.filename));let bytes;
    try{if(opened.info.size>MAX_DOCUMENT_BYTES)throw fail('This backup exceeds the portable document limit.',413,'backup_limit');bytes=await opened.file.readFile();}finally{await opened.file.close();}
    assertCurrent();if(bytes.length!==receipt.bytes||sha(bytes)!==receipt.sha256)throw fail('The local backup no longer matches its receipt. Export it again.');
    const document=await parseBackup(new TextDecoder('utf-8',{fatal:true}).decode(bytes),receipt.format);assertCurrent();
    if(ownerKey(document.owner)!==key)throw fail('The local backup belongs to a different owner.',403,'owner_mismatch');
    return {document,receipt};
  }
  async function save({id,backupId,label,resolutions=[]}) {
    z.uuid().parse(id);z.uuid().parse(backupId);label=z.string().trim().min(1).max(120).parse(label);
    resolutions=z.array(z.object({key:z.string(),remoteRevision:z.number().int().nonnegative(),remoteHash:z.string(),choice:z.literal('local')}).strict()).max(10_001).parse(resolutions);
    if(!context.canWrite)throw fail('This Squad is read-only. You can download its existing cloud backups.',403,'owner_read_only');
    const root=await directory(),release=await acquireWriterLease(join(root,`${id}.sqlite`));
    let operation;
    const persist=async()=>{operation.updatedAt=new Date().toISOString();operation=operationSchema.parse(operation);await durableJson(root,`${id}.json`,operation,assertCurrent);};
    try {
      const {document,receipt}=await localBackup(backupId);
      const existing=await privateJson(join(root,`${id}.json`),null);
      operation=existing?operationSchema.parse(existing):{version:1,id,backupId,datasetId:context.datasetId,sourceDigest:receipt.sha256,label,phase:'uploading',records:{},uploaded:[],conflicts:[],planId:null,freezeAttempt:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),error:''};
      if(operation.id!==id||operation.backupId!==backupId||operation.datasetId!==context.datasetId||operation.sourceDigest!==receipt.sha256||operation.label!==label)throw fail('This request ID already belongs to a different immutable cloud backup source.');
      if(operation.phase==='complete')return publicOperation(operation);
      const includeShared=true;
      const state=validateState({shared:document.shared,workspaces:document.workspaces,omissions:document.omissions,extensions:document.extensions});
      const records=document.agents.map(agent=>({kind:'agent',id:agent.id,content:agent,path:`/agents/${encodeURIComponent(agent.id)}`}));
      for(const content of [state,...records.map(record=>record.content)]) {checkStructure(content,50_000);if(Buffer.byteLength(JSON.stringify(content))>4*1024*1024-4096)throw fail('A record exceeds the cloud metadata limit. The local portable backup is kept.',413,'cloud_metadata_limit');}
      const api=await client(),anchors=await privateJson(join(root,'heads.json'),{}),conflicts=[];
      function matches(snapshot) {
        const frozenRecords=new Map(snapshot.manifest.agents.map(agent=>[`agent:${agent.id}`,agent]));
        frozenRecords.set('squad:state',validateState({shared:snapshot.manifest.shared,workspaces:snapshot.manifest.workspaces,omissions:snapshot.manifest.omissions,extensions:snapshot.manifest.extensions}));
        return snapshot.manifest.agents.length===document.agents.length&&[...records,{kind:'squad',id:'state',content:state}].every(record=>contentHash(frozenRecords.get(`${record.kind}:${record.id}`))===contentHash(record.content));
      }
      if(operation.planId) {
        let prior;
        try{prior=await api.frozenExport({planId:operation.planId});}catch(error){if(error.status!==410)throw error;}
        if(prior&&matches(prior)) {
          await api.request(`/exports/${operation.planId}/retain`,{method:'POST',value:{label}});
          operation.phase='complete';operation.error='';await persist();return publicOperation(operation);
        }
        operation.planId=null;operation.freezeAttempt++;await persist();
      }
      async function remote(record) {try{return await api.request(record.path);}catch(error){if(error.status===404)return {revision:0,content:null};throw error;}}
      for(const record of records) {
        const recordKey=`${record.kind}:${record.id}`,desiredHash=contentHash(record.content),saved=operation.records[recordKey],head=await remote(record),remoteHash=contentHash(head.content),resolution=resolutions.find(choice=>choice.key===recordKey);
        if(saved?.desiredHash&&saved.desiredHash!==desiredHash)throw fail('The cloud operation’s source content changed. Start with a new export.');
        if(head.content&&remoteHash===desiredHash){operation.records[recordKey]={baseRevision:head.revision,desiredHash,committedRevision:head.revision};continue;}
        const anchored=saved?!saved.committedRevision&&saved.baseRevision===head.revision:anchors[recordKey]?.revision===head.revision&&anchors[recordKey]?.hash===remoteHash;
        const explicit=resolution?.choice==='local'&&resolution.remoteRevision===head.revision&&resolution.remoteHash===remoteHash;
        if(head.revision>0&&!anchored&&!explicit) {conflicts.push({key:recordKey,kind:record.kind,id:record.id,remoteRevision:head.revision,remoteHash,localHash:desiredHash});continue;}
        operation.records[recordKey]={baseRevision:head.revision,desiredHash};
      }
      operation.conflicts=conflicts;operation.error='';operation.phase=conflicts.length?'conflicts':'uploading';await persist();
      if(conflicts.length)return publicOperation(operation);
      const inventoryHashes=[...new Set(inventory(document).map(ref=>ref.sha256))];
      if(Buffer.byteLength(JSON.stringify({...operation,uploaded:inventoryHashes}))>8*1024*1024)throw fail('This cloud backup exceeds the local resume-journal limit. Select fewer members; the portable backup is kept.',413,'cloud_record_limit');
      const uploaded=new Set(operation.uploaded),payloads=new Map(document.files.map(file=>[JSON.stringify([file.agentId,file.id]),file]));
      for(const ref of inventory(document))if(!uploaded.has(ref.sha256)) {
        const payload=payloads.get(JSON.stringify([ref.agentId,ref.id]));
        await api.request(`/files/${ref.sha256}`,{method:'PUT',rawBody:Buffer.from(decodeFile(payload))});uploaded.add(ref.sha256);operation.uploaded=[...uploaded];await persist();
      }
      for(const record of records) {
        const recordKey=`${record.kind}:${record.id}`,expected=operation.records[recordKey];
        if(!expected.committedRevision) {
          try {
            const committed=await api.request(record.path,{method:'PUT',value:{baseRevision:expected.baseRevision,content:record.content},idempotencyKey:`${id}.${sha(`${recordKey}:${expected.baseRevision}:${expected.desiredHash}`).slice(0,24)}`});
            expected.committedRevision=committed.revision;await persist();
          }catch(error) {
            if(error.code!=='revision_conflict')throw error;
            const head=await remote(record);operation.conflicts=[{key:recordKey,kind:record.kind,id:record.id,remoteRevision:head.revision,remoteHash:contentHash(head.content),localHash:expected.desiredHash}];operation.phase='conflicts';await persist();return publicOperation(operation);
          }
        }
        const unlock=await acquireWriterLease(join(root,'heads.sqlite'));
        try {const latest=await privateJson(join(root,'heads.json'),{});latest[recordKey]={revision:expected.committedRevision,hash:expected.desiredHash};await durableJson(root,'heads.json',latest,assertCurrent);}finally{unlock();}
      }
      operation.phase='freezing';await persist();
      const frozen=await api.frozenExport({agentIds:document.agents.map(agent=>agent.id),includeShared,stateOverride:state,idempotencyKey:`${id}.freeze.${operation.freezeAttempt}`});
      operation.planId=frozen.plan.id;await persist();
      if(!matches(frozen)) {operation.planId=null;operation.freezeAttempt++;throw fail('Cloud records changed while the complete backup was frozen. No cloud snapshot was retained; local data is kept. Review the conflict before retrying.');}
      await api.request(`/exports/${frozen.plan.id}/retain`,{method:'POST',value:{label}});
      operation.phase='complete';operation.error='';await persist();return publicOperation(operation);
    }catch(error) {
      if(operation&&operation.phase!=='complete') {operation.phase='failed';operation.error=String(error.message||'Cloud backup failed. Local data is kept.').slice(0,1000);try{await persist();}catch{/* A revoked context cannot publish a new result. */}}
      throw error;
    }finally{release();}
  }
  return {
    save,status:getOperation,
    async reconnect() {
      const root=await directory(),release=await acquireWriterLease(join(root,'session.sqlite'));
      try {
        const saved=await privateJson(join(root,'session.json'),null,64*1024);
        if(saved) {
          const session=sessionSchema.parse(saved);
          if(session.actorKey===actor&&session.ownerKey===key&&session.apiOrigin===origin) {
            const previous=createSquadApi({baseUrl:origin,fetchImpl,token:session.token,signal});
            try {const me=await previous.request('/v1/me');assertCurrent();if(me.issuer===context.actor.issuer&&me.subject===context.actor.id)await previous.request('/v1/auth/session',{method:'DELETE'});}catch(error){assertCurrent();if(error.status!==401&&error.status!==403)throw error;}
          }
          assertCurrent();await rm(join(root,'session.json'),{force:true});
        }
      }finally{release();}
      await client();return {connected:true,owner:context.owner};
    },
    async list({cursor=''}={}) {const api=await client();return api.request(`/exports?limit=50&cursor=${encodeURIComponent(cursor)}`);},
    async remove({planId,confirm}) {z.uuid().parse(planId);if(!context.canWrite||confirm!=='remove-cloud-backup')throw fail('Confirm removal from a writable owner first.',403,'confirmation_required');return (await client()).request(`/exports/${planId}`,{method:'DELETE',value:{confirm}});},
    async prepareImport({id=randomUUID(),planId,format='json'}) {
      z.uuid().parse(id);z.uuid().parse(planId);z.enum(['json','yaml']).parse(format);
      if(!context.canWrite)throw fail('Choose a writable owner before preparing a restore.',403,'owner_read_only');
      const root=await directory(),api=await client(),temporary=join(root,`.download-${id}.${format}`);
      try {
        await api.exportFile({planId,format,outputPath:temporary});
        const bytes=await privateBytes(temporary,MAX_DOCUMENT_BYTES);assertCurrent();
        return await createImportSources({context,assertCurrent}).prepare({id,bytes,format});
      }finally{await rm(temporary,{force:true}).catch(()=>{});}
    },
    async download({id=randomUUID(),planId,format='json'}) {
      z.uuid().parse(id);z.uuid().parse(planId);z.enum(['json','yaml']).parse(format);
      const directory=await ownedDirectory(context.serviceRoot,['owners',key,'datasets',context.datasetId,'state','backups']),filename=`${id}.${format}`;
      const saved=await (await client()).exportFile({planId,format,outputPath:join(directory,filename)}),{path:_private,...receipt}=saved;
      const result={...receipt,id,filename,downloadUrl:`/api/backups/${id}/download`};
      await durableJson(directory,`${id}.receipt.json`,result,assertCurrent);return result;
    },
  };
}
