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
console.log('SDK session pool checks passed.');
