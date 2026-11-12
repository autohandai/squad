import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createOwnershipBroker } from '../server/ownership/broker.mjs';
import { ownerKey } from '../server/ownership/identity.mjs';
import { readDataset } from '../server/ownership/datasets.mjs';
import { encodeBackup } from '../packages/squad-portable/index.mjs';
import { createBridgeClient, createTools } from '../server/control-plane/runtime.mjs';
import { TOOLS, validateArgs } from '../server/control-plane/control-plane.mjs';

const serviceRoot=await mkdtemp(join(tmpdir(),'squad-owned-transactions-')),rootDir=fileURLToPath(new URL('..',import.meta.url));
const issuer='https://identity.example.test',team={kind:'team',issuer,id:'qa-team'};
let person='alice',writable=true,broker,origin,context;
const identity={credential:()=>({fingerprint:createHash('sha256').update(person).digest('hex')}),
  async verify(current){return {actor:{issuer,id:person,email:`${person}@example.test`,name:person},fingerprint:current.fingerprint,expiresAt:Date.now()+3600_000};},
  personal(value){return {owner:{kind:'user',issuer,id:value.actor.id},label:'Personal',role:'owner',canWrite:true};},
  async authorize(value,owner){assert.equal(value.actor.id,person);if(owner.kind==='user')assert.equal(owner.id,person);return {owner,label:owner.kind==='team'?'QA team':'Personal',role:'owner',canWrite:owner.kind==='user'||writable};},
  async owners(value){return [this.personal(value),await this.authorize(value,team)];}};
async function start(expected='ready'){broker=createOwnershipBroker({rootDir,serviceRoot,configPath:join(serviceRoot,'no-real-auth'),identity,port:0,workerEntry:join(rootDir,'scripts','fixtures','ownership-worker.mjs')});origin=await broker.listen();await wait(expected);}
async function wait(state){for(let i=0;i<200;i++){context=(await(await fetch(`${origin}/api/ownership/context`)).json()).data;if(context.state===state)return;await new Promise(done=>setTimeout(done,20));}assert.equal(context.state,state);}
const request=(path,init={})=>fetch(`${origin}${path}`,{...init,headers:{'content-type':'application/json','x-squad-context':context.generation,...init.headers}});
const post=(path,data)=>request(path,{method:'POST',body:JSON.stringify(data)});
async function selectTeam(){const response=await post('/api/ownership/select',{owner:team,expectedGeneration:context.generation});assert.equal(response.status,200,await response.clone().text());context=(await response.json()).data;}
try {
  await start();await selectTeam();
  let response=await post('/api/members',{name:'Old worker data'});assert.equal(response.status,200,await response.clone().text());
  const before=await readDataset(serviceRoot,ownerKey(team)),oldGeneration=context.generation;
  const document={format:'autohand-squad',schemaVersion:1,createdAt:new Date().toISOString(),owner:{kind:'user',issuer:'https://foreign.example.test',id:'foreign-source'},agents:[{id:'eva',profile:{name:'Eva',role:'QA'},memories:[],conversations:[],routines:[{id:'daily',schedule:{kind:'interval',everyMinutes:60,startDate:'2026-11-10',startTime:'09:00',timeZone:'UTC'},enabled:true,instructions:'Must not run.'}],skills:[],files:[],extensions:{'vendor.example':{future:true}}}],shared:{data:{},files:[]},workspaces:[],omissions:[],extensions:{},files:[]};
  const sourceId=randomUUID();response=await request(`/api/ownership/imports?format=yaml&requestId=${sourceId}`,{method:'POST',body:encodeBackup(document,'yaml')});
  assert.equal(response.status,201,await response.clone().text());const preview=(await response.json()).data;
  assert.deepEqual(preview.sourceOwner,document.owner);assert.equal(preview.memberCount,1);
  const intent={id:randomUUID(),kind:'restore',beforeDatasetId:before.datasetId,sourceId,sourceDigest:preview.sha256,confirmation:'replace-current-squad'};
  response=await post('/api/ownership/operations',{...intent,confirmation:'unreviewed'});assert.equal(response.status,400);assert.equal((await readDataset(serviceRoot,ownerKey(team))).datasetId,before.datasetId);
  response=await post('/api/ownership/operations',intent);assert.equal(response.status,200,await response.clone().text());const completed=(await response.json()).data;context=completed.context;
  assert.equal(context.state,'awaiting_restart');assert.notEqual(context.generation,oldGeneration);assert.equal(context.canWrite,false);
  const after=await readDataset(serviceRoot,ownerKey(team));assert.equal(after.datasetId,completed.operation.afterDatasetId);assert.notEqual(after.datasetId,before.datasetId);
  assert.equal(JSON.parse(await readFile(join(before.dataRoot,'fixture-stopped.json'),'utf8')).generation,oldGeneration,'old worker and its final writes finish before publication');
  assert.equal((await request('/api/members')).status,401,'private runtime does not start behind completion screen');
  const restored=JSON.parse(await readFile(join(after.dataRoot,'channels.json'),'utf8'));assert.equal(Object.values(restored.agentChannelAccess)[0].agent.name,'Eva');
  response=await post('/api/ownership/operations',intent);assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).data.operation.afterDatasetId,after.datasetId,'retry after lost response never republishes');
  await broker.close();person='bob';await start();await selectTeam();
  assert.equal(context.state,'awaiting_restart','a new broker recovers the published pointer and requires explicit restart');
  response=await request(`/api/ownership/operations/${intent.id}`);assert.equal(response.status,404,'another team operator cannot read the initiating actor’s private source receipt');
  response=await post(`/api/ownership/operations/${intent.id}/restart`,{revision:context.pendingOperation.revision});assert.equal(response.status,200,await response.clone().text());context=(await response.json()).data;
  assert.equal(context.state,'ready');assert.equal(context.pendingOperation,null);assert.equal(context.datasetId,after.datasetId,'a freshly authorized team operator may acknowledge the committed dataset');
  response=await request('/api/members');assert.equal(response.status,200);assert.equal((await response.json()).data.records.length,0,'old worker cache cannot repopulate the new dataset');
  const reset={id:randomUUID(),kind:'reset',beforeDatasetId:after.datasetId,confirmation:'replace-current-squad'};
  response=await post('/api/ownership/operations',reset);assert.equal(response.status,200,await response.clone().text());context=(await response.json()).data.context;
  const resetDataset=await readDataset(serviceRoot,ownerKey(team));assert.notEqual(resetDataset.datasetId,after.datasetId);
  await assert.rejects(readFile(join(resetDataset.dataRoot,'channels.json')),{code:'ENOENT'});assert.equal(Object.keys(restored.agentChannelAccess).length,1,'reset retains earlier dataset separately');
  await broker.close();await start('awaiting_restart');await selectTeam();assert.equal(context.state,'awaiting_restart');
  writable=false;await wait('awaiting_restart');response=await post(`/api/ownership/operations/${reset.id}/restart`,{revision:context.pendingOperation.revision});assert.equal(response.status,409,'changed entitlements cannot acknowledge publication');
  assert.equal((await readDataset(serviceRoot,ownerKey(team))).datasetId,resetDataset.datasetId);
  writable=true;
  const mcp=createTools(createBridgeClient(origin));
  for(const name of ['prepare_squad_import','prepare_legacy_recovery','restore_squad','reset_squad_data','get_squad_data_operation','restart_squad_data'])assert(TOOLS.some(tool=>tool.name===name)&&typeof mcp[name]==='function');
  assert(validateArgs(TOOLS.find(tool=>tool.name==='restore_squad').inputSchema,{source_id:'source',request_id:randomUUID(),destination_owner:team,confirm_replace:false}).length);
  assert.equal((await mcp.get_squad_context()).state,'awaiting_restart');
  await mcp.restart_squad_data({operation_id:reset.id,revision:context.pendingOperation.revision});
  const recoveryIntent={request_id:randomUUID(),destination_owner:team,browser_data:JSON.stringify({agents:[{id:'legacy-eva',name:'Old browser Eva'}],messages:{'legacy-eva':[{id:'old',role:'user',body:'Explicit old browser data.'}]}}),confirm_preview:true};
  await assert.rejects(mcp.prepare_legacy_recovery({...recoveryIntent,confirm_preview:false}),/Explicit consent/);
  await assert.rejects(mcp.prepare_legacy_recovery({...recoveryIntent,destination_owner:{...team,id:'other'}}),/destination owner/);
  const legacy=await mcp.prepare_legacy_recovery(recoveryIntent);assert.equal(legacy.members,1);assert.equal(legacy.sourceOwner.id,'unowned');
  assert.deepEqual(await mcp.prepare_legacy_recovery(recoveryIntent),legacy,'actual MCP retry keeps the original passive recovery preview');
  const prepared=await mcp.prepare_squad_import({format:'json',document:encodeBackup(document,'json')});assert.equal(prepared.members,1);
  const mcpIntent={source_id:prepared.source_id,request_id:randomUUID(),destination_owner:team,confirm_replace:true};
  await assert.rejects(mcp.restore_squad({...mcpIntent,destination_owner:{...team,id:'another-team'}}),/destination owner/);
  const mcpRestored=await mcp.restore_squad(mcpIntent);assert.equal(mcpRestored.phase,'awaiting_restart');
  assert.equal((await mcp.restore_squad(mcpIntent)).afterDatasetId,mcpRestored.afterDatasetId,'MCP retry keeps the same durable publication');
  assert.equal((await mcp.get_squad_data_operation({operation_id:mcpIntent.request_id})).phase,'awaiting_restart');
  await mcp.restart_squad_data({operation_id:mcpIntent.request_id,revision:mcpRestored.revision});
  assert.equal((await mcp.get_squad_context()).state,'ready','explicit data handoff keeps the same actor/owner MCP binding');
  console.log('Owned transactions: real broker/worker drain, verified upload, explicit confirmation, atomic restore/reset, stale generation denial, idempotent lost-response retry, new-process recovery, actor-private receipts and fresh team acknowledgment passed. No real credentials or installed app used.');
} finally {await broker?.close();await rm(serviceRoot,{recursive:true,force:true});}
