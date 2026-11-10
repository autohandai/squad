// Actual Unix gate/worker IPC with a durable broker ledger. A deliberately
// stalled journal must prevent the executable from doing even its first write.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {access,mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createWorkerLedger} from '../server/ownership/worker-ledger.mjs';
import {createEngineLedger} from '../server/ownership/engine-ledger.mjs';
import {stop,until} from './lib/reliability-browser.mjs';

if(process.platform==='win32'){console.log('Owned Unix engine gates: Windows uses the separately tested private Job Object.');process.exit(0);}
const directory=await mkdtemp(join(tmpdir(),'squad-engine-gates-'));
const generation=randomUUID(),children=new Set();
let release;
try {
  const ledger=await createWorkerLedger(directory,'engine-test');
  const barrier=new Promise(resolve=>{release=resolve;});
  const engines=createEngineLedger(()=>({pending:async()=>{await barrier;return ledger.pending();}}));
  const module=new URL('../server/ownership/engine-child.mjs',import.meta.url).href;
  const entry=join(directory,'worker.mjs');
  await writeFile(entry,`import {once} from 'node:events';import{configureOwnedEngines,spawnOwnedEngine,drainOwnedEngines}from ${JSON.stringify(module)};configureOwnedEngines({generation:${JSON.stringify(generation)},assertCurrent:()=>{}});try{const child=await spawnOwnedEngine(process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],'admitted');console.log('actual engine output');",process.argv[2]],{cwd:${JSON.stringify(directory)},env:process.env,detached:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.resume();child.on('error',()=>{});const[code,signal]=await once(child,'close');await drainOwnedEngines();process.send({done:true,code,signal,output},()=>process.disconnect());}catch(error){process.send({done:true,error:error.message},()=>process.disconnect());}`);
  async function launch(marker,admit){
    const child=fork(entry,[marker],{stdio:['ignore','ignore','pipe','ipc']});children.add(child);
    const messages=[];let errors='';child.stderr.on('data',chunk=>errors+=chunk);
    child.on('message',message=>{messages.push(message);if(message.type==='ownership-engine')void engines.message(child,message,generation,()=>admit);});
    return{child,messages,get errors(){return errors;}};
  }
  const marker=join(directory,'allowed.txt'),allowed=await launch(marker,true);
  await until(()=>allowed.messages.some(message=>message.type==='ownership-engine'&&message.phase==='start'),'gated registration request');
  await new Promise(resolve=>setTimeout(resolve,150));
  await assert.rejects(access(marker),'no executable write before durable admission');
  assert.equal(allowed.messages.some(message=>message.done),false);
  release();
  const result=await until(()=>allowed.messages.find(message=>message.done),'engine completion after admission');
  assert.equal(result.error,undefined,JSON.stringify(result));
  assert.equal(result.code,0,'report actual engine status instead of cleanup SIGKILL');
  assert.equal(result.signal,null);
  assert.match(result.output,/actual engine output/);
  await access(marker);
  const deniedMarker=join(directory,'denied.txt'),denied=await launch(deniedMarker,false);
  const refusal=await until(()=>denied.messages.find(message=>message.done),'refused engine gate closes');
  assert.match(refusal.error,/no longer admits/);
  await assert.rejects(access(deniedMarker),'a refused owner context cannot launch the executable');
  await engines.releaseAll();
  assert.deepEqual((await readdir(join(directory,'ownership-workers'))).filter(name=>name.endsWith('.json')),[],'completed/refused gates leave no live group intent');
  console.log('PASS actual owned engine gates: no work before durable admission, exact output/status after anchored group cleanup, denied context never starts, and cleared durable intents. Temporary fixture only.');
}finally{
  release?.();await Promise.all([...children].map(stop));
  await rm(directory,{recursive:true,force:true});
}
