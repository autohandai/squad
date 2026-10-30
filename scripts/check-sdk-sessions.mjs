#!/usr/bin/env node
// Deterministic checks for server/sdk-sessions.mjs using a fake SDK: reuse
// across prompts, serialisation, unhealthy release, reset, capacity, TTL.
import assert from 'node:assert/strict';
import { SdkSessionPool, sessionKeyFor } from '../server/sdk-sessions.mjs';

let created = 0;
let closed = 0;
function fakeSdk() {
  created += 1;
  return {
    started: false,
    async start() { this.started = true; },
    async interrupt() {},
    async close() { closed += 1; },
  };
}

assert.equal(sessionKeyFor({ agentId: 'a', workspace: '/w', options: { x: 1, timeout: 5 } }), sessionKeyFor({ agentId: 'a', workspace: '/w', options: { timeout: 9, x: 1 } }), 'timeout is not part of the key');
assert.notEqual(sessionKeyFor({ agentId: 'a', workspace: '/w', options: { x: 1 } }), sessionKeyFor({ agentId: 'a', workspace: '/w', options: { x: 2 } }));

const pool = new SdkSessionPool({ createSdk: fakeSdk, maxSessions: 2, idleTtlMs: 50, sweepMs: 10_000 });
const launch = { agentId: 'eva', workspace: '/w', options: { cliPath: '/x', extraArgs: ['--path', '/w'] } };

const first = await pool.acquire(launch);
assert.equal(first.created, true);
assert.equal(first.sdk.started, true);
// A second acquire for the same key waits until release.
let secondResolved = false;
const secondPromise = pool.acquire(launch).then((lease) => { secondResolved = true; return lease; });
await new Promise((r) => setTimeout(r, 20));
assert.equal(secondResolved, false, 'prompts are serialised per session');
await first.release(true);
const second = await secondPromise;
assert.equal(second.created, false, 'the warm session is reused');
assert.equal(second.sdk, first.sdk);
assert.equal(created, 1);
await second.release(false);
assert.equal(closed, 1, 'an unhealthy release closes the session');
assert.equal(pool.stats().active, 0);

// Reset closes every session of a member.
const third = await pool.acquire(launch);
await third.release(true);
assert.equal(await pool.reset('eva'), 1);
assert.equal(pool.stats().active, 0);

// Capacity evicts the least recently used idle session.
const a = await pool.acquire({ agentId: 'a', workspace: '/w', options: {} }); await a.release(true);
const b = await pool.acquire({ agentId: 'b', workspace: '/w', options: {} }); await b.release(true);
const c = await pool.acquire({ agentId: 'c', workspace: '/w', options: {} }); await c.release(true);
assert.equal(pool.stats().active, 2, 'pool stays at capacity');
assert.ok(!pool.stats().sessions.some((s) => s.agentId === 'a'), 'oldest idle session evicted');

// Idle TTL sweep.
await new Promise((r) => setTimeout(r, 80));
await pool.sweep();
assert.equal(pool.stats().active, 0, 'idle sessions are swept');

// Startup failure does not poison the key.
let fail = true;
const flaky = new SdkSessionPool({ createSdk: () => ({ async start() { if (fail) throw new Error('boom'); }, async close() {}, async interrupt() {} }), sweepMs: 10_000 });
await assert.rejects(flaky.acquire({ agentId: 'f', workspace: '/w', options: {} }), /boom/);
fail = false;
const ok = await flaky.acquire({ agentId: 'f', workspace: '/w', options: {} });
assert.equal(ok.created, true);
await ok.release(true);
await flaky.closeAll();
await pool.closeAll();

// Cancellation must cover startup, not only a prompt after the SDK is ready.
// Otherwise the fallback watchdog aborts a signal the session pool ignores.
let releaseStartup;
let enteredStartup;
let coldClosed=0;
const startupEntered=new Promise(resolve=>{enteredStartup=resolve;});
const cold=new SdkSessionPool({sweepMs:10_000,createSdk:()=>({async start(){enteredStartup();await new Promise(resolve=>{releaseStartup=resolve;});},async close(){coldClosed++;releaseStartup?.();},async interrupt(){}})});
const abort=new AbortController();
const pending=cold.acquire({...launch,signal:abort.signal});
pending.catch(()=>{});
try{
  await startupEntered;abort.abort(new Error('fixture startup cancelled'));
  let timer;
  try{await assert.rejects(Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Startup acquisition ignored cancellation')),150);})]),/fixture startup cancelled/);}finally{clearTimeout(timer);}
  assert.equal(coldClosed,1,'Cancelled startup closes its owned SDK');
  assert.equal(cold.stats().active,0,'Cancelled startup leaves no warm session');
}finally{releaseStartup?.();const acquired=await pending.catch(()=>null);await acquired?.release();await cold.closeAll();}

const serial=new SdkSessionPool({createSdk:fakeSdk,sweepMs:10_000});
try{
  const active=await serial.acquire(launch);
  const queuedAbort=new AbortController();
  const cancelled=serial.acquire({...launch,signal:queuedAbort.signal});cancelled.catch(()=>{});
  queuedAbort.abort(new Error('fixture queued cancellation'));
  let timer;
  try{await assert.rejects(Promise.race([cancelled,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Queued acquisition ignored cancellation')),150);})]),/fixture queued cancellation/);}finally{clearTimeout(timer);}
  let nextStarted=false;
  const next=serial.acquire(launch).then(lease=>{nextStarted=true;return lease;});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(nextStarted,false,'Cancelling a waiter cannot unlock another turn that is still active');
  await active.release(true);const nextLease=await next;assert.equal(nextLease.sdk,active.sdk);await nextLease.release(true);
}finally{await serial.closeAll();}
console.log('SDK session pool checks passed.');
