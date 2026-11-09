import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConversationChanges } from '../server/chats/admission.mjs';
import { QueueStore } from '../server/queues/store.mjs';
import { QueueDispatcher } from '../server/queues/dispatcher.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-conversation-queue-race-'));
const changes = createConversationChanges({ isBusy: async () => false });
let dispatcher, release, allowRun, reachedRun;
const entered = new Promise(resolve => { reachedRun = resolve; });
const gate = new Promise(resolve => { allowRun = resolve; });
try {
  const store = new QueueStore({ squadStateDir: directory }); await store.ready;
  let calls = 0;
  dispatcher = new QueueDispatcher({ store, isMemberBusy: async memberId => changes.has(memberId), canRun: async () => { reachedRun(); await gate; return true; }, registerChat: memberId => { changes.assertCanStart(memberId); return () => {}; }, executeTurn: async () => { calls++; return { reply: 'Completed after switch' }; } });
  const receipt = await store.enqueue({ agentId: 'eva', workspace: directory, text: 'Keep this queued work' });
  const item = await store.get(receipt.id);
  const ticking = dispatcher.tick(); await entered;
  release = await changes.hold('eva'); allowRun(); await ticking;
  // Attach immediately to the real worker promise, including the old rejected
  // promise, so the regression reports its stranded state deterministically.
  await dispatcher.workers.get('eva')?.done.catch(() => {});
  assert.equal(dispatcher.workers.size, 0, 'a transient registration refusal must clean up the worker');
  assert.equal(item.status, 'queued', 'a conversation switch must not fail or consume queued work');
  assert.equal(store.memberState('eva').paused, false);
  release();
  const deadline = Date.now() + 3000;
  while (item.status !== 'done' && Date.now() < deadline) {
    await dispatcher.tick(); await dispatcher.workers.get('eva')?.done;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(item.status, 'done'); assert.equal(calls, 1);
  console.log('PASS conversation/queue race: a switch after eligibility leaves work queued, cleans its worker, preserves pause state and executes once after release.');
} finally { allowRun(); release?.(); dispatcher?.close(); await rm(directory, { recursive: true, force: true }); }
