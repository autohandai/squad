import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOwnershipBroker } from '../server/ownership/broker.mjs';
import { ensureDataset } from '../server/ownership/datasets.mjs';
import { ownerKey } from '../server/ownership/identity.mjs';
import { createRemoteRegistry } from '../server/remote/registry.mjs';
import { mintToken } from '../server/remote/auth.mjs';
import { until } from './lib/reliability-browser.mjs';

const address=Object.values(networkInterfaces()).flat().find(entry=>entry?.family==='IPv4'&&!entry.internal)?.address;
assert(address,'A same-computer nonloopback interface is required to exercise the real socket boundary.');
const directory=await mkdtemp(join(tmpdir(),'squad-owned-remote-')),serviceRoot=join(directory,'squad'),configPath=join(directory,'config.json'),rootDir=fileURLToPath(new URL('..',import.meta.url));
const issuer='https://identity.example.test',team={kind:'team',issuer,id:'readonly'};
let person='alice',token='fixture-alice-token',broker;
const savedEnvironment={},env={HOME:join(directory,'home'),AUTOHAND_HOME:join(directory,'home','.autohand'),AUTOHAND_USER_CONFIG_PATH:configPath,NODE_OPTIONS:`--import=${fileURLToPath(new URL('./fixtures/ownership-browser-guard.mjs',import.meta.url))}`};
const owner=()=>({kind:'user',issuer,id:person});
const identity={credential:()=>({token,fingerprint:createHash('sha256').update(token).digest('hex')}),verify:async current=>({actor:{issuer,id:person,email:`${person}@example.test`,name:person},fingerprint:current.fingerprint,expiresAt:Date.now()+3600_000}),personal:()=>({owner:owner(),label:'Personal',role:'owner',canWrite:true}),authorize:async(_actor,selected)=>{assert(selected.kind==='team'&&selected.id===team.id||selected.kind==='user'&&selected.id===person);return {owner:selected,label:'Fixture',role:selected.kind==='team'?'editor':'owner',canWrite:selected.kind==='user'};},owners:async()=>[]};
try {
  await mkdir(env.HOME,{recursive:true});for(const[key,value]of Object.entries(env)){savedEnvironment[key]=process.env[key];process.env[key]=value;}
  const auth=()=>writeFile(configPath,JSON.stringify({auth:{token,email:`${person}@example.test`,expiresAt:'2099-01-01T00:00:00Z'}}));await auth();
  const paths=await ensureDataset(serviceRoot,ownerKey(owner())),served=mintToken();
  await createRemoteRegistry({squadStateDir:paths.dataRoot}).addServedToken({token:served,label:'Same-computer test client'});
  broker=createOwnershipBroker({rootDir,serviceRoot,configPath,identity,host:'0.0.0.0',port:0});await broker.listen();
  const port=broker.server.address().port,local=`http://127.0.0.1:${port}`,remote=`http://${address}:${port}`;
  await until(()=>broker.context().state==='ready','real remote fixture ownership');
  const get=(path,headers={})=>fetch(remote+path,{headers,signal:AbortSignal.timeout(20_000)});
  const context=broker.context();
  assert.equal((await get('/api/channels',{'x-squad-context':context.generation})).status,401,'a current context hash is not remote authentication');
  assert.equal((await get('/api/runtime')).status,401,'remote readiness cannot reveal private account metadata');
  assert.equal((await get('/api/ownership/context')).status,403,'ownership control remains loopback only');
  const health=await(await get('/api/health')).json();assert.equal(health.stateDir,undefined);
  const invalid=await get('/api/runtime',{authorization:'Bearer ahs_wrong','x-squad-context':context.generation});assert.equal(invalid.status,401,`actual worker rejects an invalid token even with a current generation: ${await invalid.text()}`);
  assert.equal((await get('/api/runtime',{authorization:`Bearer ${served}`})).status,200,'actual worker validates a current owned served token');
  assert.equal((await fetch(local+'/api/runtime',{headers:{authorization:'Bearer ahs_wrong'}})).status,401,'loopback bearer clients must also pass real served-token validation');
  assert.equal((await fetch(local+'/api/runtime',{headers:{authorization:`Bearer ${served}`}})).status,200,'two local bridges use bearer transport without sharing ownership generations');
  assert.equal((await fetch(local+'/api/owned/members',{headers:{authorization:`Bearer ${served}`}})).status,404,'loopback bearer transport cannot become operator authority');
  assert.equal((await get('/api/owned/members',{authorization:`Bearer ${served}`})).status,404,'valid member-serving token cannot read operator-only owned data');
  person='bob';token='fixture-bob-token';await auth();await until(()=>broker.context().actor?.id==='bob'&&broker.context().state==='ready','account switch while remote serving');
  assert.equal((await get('/api/runtime',{authorization:`Bearer ${served}`})).status,401,'previous owner’s valid token cannot reach the next owner');
  const selected=await fetch(local+'/api/ownership/select',{method:'POST',headers:{'content-type':'application/json','x-squad-context':broker.context().generation},body:JSON.stringify({owner:team,expectedGeneration:broker.context().generation})});assert.equal(selected.status,200);
  assert.equal((await get('/api/runtime',{authorization:`Bearer ${served}`,'x-squad-context':broker.context().generation})).status,403,'read-only dataset never becomes a remote execution runtime');
  const localRead=await fetch(local+'/api/owned/members',{headers:{'x-squad-context':broker.context().generation}});assert.equal(localRead.status,200,'passive local data retrieval remains available');
  console.log('Owned remote boundary: real nonloopback socket, actual writable/passive workers, generation-only and wrong bearer denial, valid served-token/member-route admission, operator-route restriction, account switch revocation, readonly remote refusal and private health metadata passed. Same computer only; provider execution/external calls disabled.');
} finally {await broker?.close();for(const[key,value]of Object.entries(savedEnvironment)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(directory,{recursive:true,force:true});}
