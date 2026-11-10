// Runs on the real Windows native CI runner, after building the packaged helper.
import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createWindowsJob,windowsJobIsEmpty,windowsJobDrained,windowsBootUptime } from '../server/ownership/native-helper.mjs';
import { createWorkerLedger } from '../server/ownership/worker-ledger.mjs';
import { replaceMetadata } from '../server/ownership/metadata.mjs';
import { until,stop } from './lib/reliability-browser.mjs';

assert.equal(process.platform,'win32','This check requires a real Windows runner.');
process.env.AUTOHAND_SQUAD_DAEMON ||= resolve('daemon/target/debug/autohand-squad-daemon.exe');
const directory=await mkdtemp(join(tmpdir(),'squad-owned-windows-')),children=new Set(),jobs=new Set();
const receipts=new Map();
const makeJob=async name=>{const options={receiptPath:join(directory,name.slice(21)+'.drained'),bootUptimeMs:await windowsBootUptime()};receipts.set(name,options);return createWindowsJob(name,options);};
const drained=name=>windowsJobDrained(name,receipts.get(name));
const name=()=>`Global\\AutohandSquad-${randomBytes(32).toString('hex')}`;
const startModule=new URL('../server/ownership/worker-context.mjs',import.meta.url).href;
const jobModule=new URL('../server/ownership/native-helper.mjs',import.meta.url).href;
const ledgerModule=new URL('../server/ownership/worker-ledger.mjs',import.meta.url).href;
const fixture=join(directory,'gated.mjs');
const generation=randomUUID();
await writeFile(fixture,`import {awaitWorkerStart} from ${JSON.stringify(startModule)};import{spawn}from'node:child_process';await awaitWorkerStart({generation:${JSON.stringify(generation)}});const grandchild=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});process.send({grandchild:grandchild.pid});process.on('message',message=>{if(message==='exit-root')process.exit(0);});setInterval(()=>{},1000);`);
const gone=pid=>{try{process.kill(pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}};
async function launch(job) {
  const child=fork(fixture,[],{env:{...process.env,AUTOHAND_SQUAD_WIN_JOB_PIPE:job.pipe},stdio:['ignore','ignore','pipe','ipc']});children.add(child);
  const messages=[];child.on('message',message=>messages.push(message));
  await job.attached(child.pid);
  assert.equal(messages.some(message=>message.grandchild),false,'No workload can start before admission.');
  child.send({type:'ownership-start',generation});
  const message=await until(()=>messages.find(message=>message.grandchild),'Windows admitted grandchild');
  return {child,grandchild:message.grandchild};
}
try {
  const jobName=name(),job=await makeJob(jobName);jobs.add(job);
  await assert.rejects(createWindowsJob(jobName,receipts.get(jobName)),'A fresh host must not adopt an existing named job.');
  const running=await launch(job);
  const exited=once(running.child,'exit');running.child.send('exit-root');await exited;
  assert.equal(gone(running.grandchild),false,'Root exit alone does not drain its detached child.');
  await job.terminate();await until(()=>gone(running.grandchild),'job grandchild terminated');
  assert.equal(await drained(jobName),true);

  const cancelledName=name(),cancelled=await makeJob(cancelledName);jobs.add(cancelled);
  await cancelled.terminate();assert.equal(await drained(cancelledName),true,'Cancellation before pipe attachment closes the empty job.');

  const crashedName=name(),crashed=await makeJob(crashedName);jobs.add(crashed);
  const orphan=await launch(crashed);
  process.kill(crashed.pid,'SIGKILL');
  await until(()=>gone(orphan.grandchild)&&gone(orphan.child.pid),'host crash kills the owned tree');
  await assert.rejects(crashed.terminate(),/supervision stopped/);assert.equal(await drained(crashedName),false,'A missing job name after host loss is not a completed drain receipt.');

  const holder=join(directory,'holder.mjs'),ledgerRoot=join(directory,'ledger');
  await writeFile(holder,`import{createWorkerLedger}from ${JSON.stringify(ledgerModule)};import{createWindowsJob}from ${JSON.stringify(jobModule)};import{fork}from'node:child_process';const ledger=await createWorkerLedger(process.env.FIXTURE_LEDGER,'holder');const intent=await ledger.pending();const job=await createWindowsJob(intent.jobName,{receiptPath:intent.receiptPath,bootUptimeMs:intent.bootUptimeMs});const child=fork(${JSON.stringify(fixture)},[],{env:{...process.env,AUTOHAND_SQUAD_WIN_JOB_PIPE:job.pipe},stdio:['ignore','ignore','ignore','ipc']});child.on('message',message=>{if(message.grandchild)process.send({...message,root:child.pid,jobName:intent.jobName,receiptPath:intent.receiptPath,bootUptimeMs:intent.bootUptimeMs});});await job.attached(child.pid);await intent.launched(child.pid);child.send({type:'ownership-start',generation:${JSON.stringify(generation)}});setInterval(()=>{},1000);`);
  const broker=fork(holder,[],{env:{...process.env,FIXTURE_LEDGER:ledgerRoot},stdio:['ignore','ignore','pipe','ipc']});children.add(broker);
  const [held]=await once(broker,'message');
  await assert.rejects(createWorkerLedger(ledgerRoot,'contender'),/previous private Squad process/);
  const holderExited=once(broker,'exit');broker.kill('SIGKILL');await holderExited;
  await until(async()=>gone(held.root)&&gone(held.grandchild)&&await windowsJobDrained(held.jobName,{receiptPath:held.receiptPath,bootUptimeMs:held.bootUptimeMs}),'broker crash closes job host pipe and owned tree');
  await createWorkerLedger(ledgerRoot,'replacement');

  const current=join(directory,'current.json'),temporary=join(directory,'current.tmp');
  await writeFile(current,'{"dataset":"old"}');await writeFile(temporary,'{"dataset":"new"}',{flush:true});
  await replaceMetadata(temporary,current);
  assert.deepEqual(JSON.parse(await readFile(current,'utf8')),{dataset:'new'});
  await assert.rejects(replaceMetadata(current,join(directory,'elsewhere','current.json')),'No cross-directory replacement fallback.');
  console.log('PASS real Windows gated assignment, duplicate-job refusal, pre-attach cancellation, detached-grandchild drain, host/broker crashes, named-job recovery and same-directory metadata replacement.');
} finally {
  await Promise.allSettled([...jobs].map(job=>job.terminate()));
  await Promise.all([...children].map(stop));
  await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
