import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { encodeBackup } from '../packages/squad-portable/index.mjs';
import { createImportSources } from '../server/ownership/import-sources.mjs';
import { actorKey, ownerKey } from '../server/ownership/identity.mjs';
import { ensureDataset, readDataset } from '../server/ownership/datasets.mjs';

const serviceRoot=await mkdtemp(join(tmpdir(),'squad-import-sources-'));
const issuer='https://identity.example.test', owner={kind:'team',issuer,id:'team-fixture'},actor={issuer,id:'alice'};
try {
  const selected=await ensureDataset(serviceRoot,ownerKey(owner));
  const context={...selected,serviceRoot,owner,actor,canWrite:true};let active=true;
  const sources=createImportSources({context,assertCurrent(){if(!active)throw Object.assign(Error('The account changed.'),{code:'context_changed'});}});
  const bytes=Buffer.from('Exact memory bytes: 世界\n\0No execution.');
  const ref={id:'memory',path:'member/memory/MEMORY.md',kind:'memory',sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.byteLength,mediaType:'text/markdown'};
  const document={format:'autohand-squad',schemaVersion:1,createdAt:new Date().toISOString(),owner:{kind:'user',issuer:'https://source.example.test',id:'foreign-source-owner'},
    agents:[{id:'eva',profile:{name:'Eva',harness:{id:'claude'},future:{'vendor.example':'kept'}},memories:[],conversations:[],routines:[{id:'daily',schedule:{kind:'interval',everyMinutes:60,startDate:'2026-11-10',startTime:'09:00',timeZone:'UTC'},enabled:true,instructions:'Must not run during preview.'}],skills:[],files:[ref],extensions:{'vendor.example':{untouched:true}}}],
    shared:{data:{},files:[]},workspaces:[],omissions:[],extensions:{},files:[{agentId:'eva',id:'memory',encoding:'base64',content:bytes.toString('base64')}]};
  for(const format of ['json','yaml']) {
    const body=Buffer.from(encodeBackup(document,format)),id=randomUUID();
    const plan=await sources.prepare({bytes:body,format,id});
    assert.deepEqual(plan.sourceOwner,document.owner,'source provenance is not rewritten into destination authority');
    assert.equal(plan.ownerKey,ownerKey(owner));assert.equal(plan.actorKey,actorKey(actor));
    assert.equal(plan.memberCount,1);assert.equal(plan.routineCount,1);assert.equal(plan.fileCount,1);
    assert.deepEqual(await sources.prepare({bytes:body,format,id}),plan);
    const loaded=await sources.load(id);
    assert.equal(loaded.document.agents[0].routines[0].enabled,true,'preview preserves the document and cannot activate its routine');
    assert.equal(loaded.document.agents[0].extensions['vendor.example'].untouched,true);
    assert.deepEqual(loaded.document.owner,document.owner);
    const bob=createImportSources({context:{...context,actor:{issuer,id:'bob'}},assertCurrent(){}});
    await assert.rejects(bob.get(id),{code:'import_source_not_found'});
    const directory=join(serviceRoot,'owners',ownerKey(owner),'imports',actorKey(actor));
    assert.deepEqual(await readFile(join(directory,`${id}.${format}`)),body,'the verified source remains exact bytes');
    await writeFile(join(directory,`${id}.${format}`),'tampered');
    await assert.rejects(sources.load(id),{code:'import_source_changed'});
    await assert.rejects(sources.prepare({bytes:body,format,id}),{code:'import_source_changed'},'idempotent preview never claims a corrupted saved source is ready');
  }
  const corrupted=structuredClone(document);corrupted.files[0].content=Buffer.from('wrong').toString('base64');
  await assert.rejects(sources.prepare({bytes:Buffer.from(encodeBackup(corrupted,'json')),format:'json'}),{code:'invalid_backup'});
  await assert.rejects(sources.prepare({bytes:Buffer.from([0xc3,0x28]),format:'json'}),{code:'invalid_backup'});
  const readOnly=createImportSources({context:{...context,canWrite:false},assertCurrent(){}});
  await assert.rejects(readOnly.prepare({bytes:Buffer.from('{}'),format:'json'}),{code:'owner_read_only'});
  active=false;await assert.rejects(sources.get(randomUUID()),{code:'context_changed'});
  assert.equal((await readDataset(serviceRoot,ownerKey(owner))).datasetId,selected.datasetId,'source validation never publishes or changes the selected Squad');
  console.log('Import sources: verified JSON/YAML preview, exact source bytes, idempotency, checksum/UTF-8 tamper refusal, actor namespace, readonly/context fences and unchanged dataset passed. No agents or routines were restored or launched.');
} finally {await rm(serviceRoot,{recursive:true,force:true});}
