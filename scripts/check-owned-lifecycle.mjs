import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireWriterLease } from '../server/ownership/writer-lease.mjs';
import { createWorkerLedger } from '../server/ownership/worker-ledger.mjs';
import { createOwnershipBroker } from '../server/ownership/broker.mjs';
import { createNativeDrain } from '../server/ownership/native-drain.mjs';
import { fileURLToPath } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'squad-owned-lifecycle-'));
const leaseModule = new URL('../server/ownership/writer-lease.mjs', import.meta.url).href;
const ledgerModule = new URL('../server/ownership/worker-ledger.mjs', import.meta.url).href;
const children = new Set(); let helperGroup;
async function child(script, env) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  children.add(child);
  let errors = ''; child.stderr.on('data', chunk => { errors += chunk; });
  const value = await Promise.race([once(child, 'message').then(([message]) => message), once(child, 'exit').then(([code]) => { throw Error(`Fixture exited ${code}: ${errors}`); }), new Promise((_, reject) => { const timer=setTimeout(() => reject(Error('Lifecycle fixture did not become ready.')),5000); timer.unref(); })]);
  return { child, value };
}
async function kill(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
}
try {
  const path = join(directory, 'writer.sqlite');
  const holder = await child(`import {acquireWriterLease} from ${JSON.stringify(leaseModule)}; await acquireWriterLease(process.env.FIXTURE_LEASE); process.send({ready:true}); setInterval(()=>{},1000);`, { FIXTURE_LEASE: path });
  await assert.rejects(acquireWriterLease(path), error => error.code === 'dataset_busy', 'another process cannot acquire a live lease');
  await kill(holder.child);
  const release = await acquireWriterLease(path);
  await assert.rejects(acquireWriterLease(path), error => error.code === 'dataset_busy', 'a same-process contender never opens/closes a held SQLite inode');
  release();
  const next = await acquireWriterLease(path); next();

  const brokerRoot = join(directory, 'broker');
  const options = {rootDir:fileURLToPath(new URL('..', import.meta.url)), serviceRoot:brokerRoot, configPath:join(directory,'no-auth.json'), port:0, identity:{credential:()=>null}};
  const first = createOwnershipBroker(options), contender = createOwnershipBroker(options);
  try {
    const origin = await first.listen();
    const readyDeadline=Date.now()+10_000;
    while(true) {
      const receipt=await readFile(join(brokerRoot,'ownership-active.json'),'utf8').then(JSON.parse,error=>{if(error.code==='ENOENT')return null;throw error;});
      if(receipt?.state==='signed_out')break;
      assert.ok(Date.now()<readyDeadline,'The actual holder must finish publishing its signed-out receipt.');
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    const before = await readFile(join(brokerRoot,'ownership-active.json'),'utf8');
    await assert.rejects(contender.listen(), error=>error.code==='dataset_busy');
    await contender.close();
    await new Promise(resolve=>setTimeout(resolve,500));
    assert.equal(await readFile(join(brokerRoot,'ownership-active.json'),'utf8'), before, 'a rejected broker cannot write through its timer or close path');
  } finally { await contender.close(); await first.close(); }

  if (process.platform !== 'win32') {
    const root = join(directory, 'crashed-broker');
    const fixture = await child(`import {createWorkerLedger} from ${JSON.stringify(ledgerModule)}; import {spawn} from 'node:child_process'; const ledger=await createWorkerLedger(process.env.FIXTURE_ROOT,'fixture'); const intent=await ledger.pending(); const helper=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}); await intent.launched(helper.pid); process.send({group:helper.pid}); setInterval(()=>{},1000);`, { FIXTURE_ROOT: root });
    helperGroup = fixture.value.group;
    await kill(fixture.child);
    const intents=join(root,'native-work-intents');await mkdir(intents,{recursive:true});
    await writeFile(join(intents,'fixture-native.json'),JSON.stringify({version:1,daemonPid:fixture.child.pid,daemonInstance:`${fixture.child.pid}:fixture-only`,group:helperGroup}));
    const native=createNativeDrain({serviceRoot:root,brokerId:'fixture',token:'a'.repeat(64)});
    await assert.rejects(native.capture(), /previous Squad process/, 'no daemon record does not mean its native process group exited');
    await assert.rejects(native.drain(null,crypto.randomUUID()), /previous Squad process/, 'an absent-daemon drain rechecks the durable native ledger');
    await assert.rejects(createWorkerLedger(root, 'replacement'), /previous private Squad process/, 'a released broker lease does not prove its detached helpers exited');
    process.kill(-helperGroup, 'SIGKILL');
    const deadline = Date.now() + 5000;
    while (true) { try { process.kill(-helperGroup, 0); } catch (error) { if (error.code === 'ESRCH') break; throw error; } assert.ok(Date.now() < deadline, 'fixture group did not exit'); await new Promise(resolve => setTimeout(resolve, 20)); }
    helperGroup = null;
    assert.equal(await native.capture(),null);
    await native.drain(null,crypto.randomUUID());
    await createWorkerLedger(root, 'replacement');
  }
  assert.ok((await stat(path)).isFile(), 'stable lease inode is retained after release');
  console.log('Owned lifecycle: cross-process exclusion, crash-released lease, same-process inode safety and surviving-helper refusal passed.');
} finally {
  if (helperGroup) { try { process.kill(-helperGroup, 'SIGKILL'); } catch {} }
  await Promise.all([...children].map(kill));
  await rm(directory, { recursive: true, force: true });
}
