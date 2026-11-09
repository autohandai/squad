import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConversationChanges } from '../server/chats/admission.mjs';
import { ChatStore, buildChatRecord } from '../server/chats/store.mjs';
import * as route from '../server/routes/chats.route.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-history-admission-'));
let busy = true, resets = 0, releaseReset, resetEntered;
const entered = new Promise(resolve => { resetEntered = resolve; });
const gate = new Promise(resolve => { releaseReset = resolve; });
const changes = createConversationChanges({ isBusy: async () => busy });
const ctx = {
  squadStateDir: directory, appStateDir: join(directory, 'app'), runs: new Map(),
  readBody: async req => req.body || {}, json: (res, status, body) => { res.result = { status, ...body }; },
  holdMemberConversation: memberId => changes.hold(memberId),
  sdkSessions: { reset: async () => { resets++; resetEntered(); await gate; return 0; } },
};
async function call(path, body = {}) {
  const res = {};
  await route.handle({ method: 'POST', body }, res, new URL(path, 'http://127.0.0.1'), ctx);
  return res.result;
}
let pending;
try {
  await route.init(ctx);
  const store = new ChatStore({ squadStateDir: directory });
  await store.save(buildChatRecord('eva', { messages: [{ id: 'q', role: 'user', body: 'Saved discussion' }] }, { id: 'saved-chat' }));
  const open = '/api/members/eva/chats/saved-chat/open';
  assert.equal((await call(open)).status, 409, 'another window cannot reset a busy member');
  assert.equal((await call('/api/members/eva/chats', { messages: [{ id: 'q2', role: 'user', body: 'Current discussion' }] })).status, 409, 'New chat cannot interrupt another window either');
  assert.equal(resets, 0, 'busy refusal happens before engine or file changes');
  assert.ok(await store.get('eva', 'saved-chat'), 'refusal keeps the saved conversation');
  busy = false;
  pending = call(open); await entered;
  assert.throws(() => changes.assertCanStart('eva'), /switching conversations/, 'new engine work cannot enter while sessions are being moved');
  assert.doesNotThrow(() => changes.assertCanStart('noah'), 'other members keep working');
  assert.equal((await call(open)).status, 409, 'concurrent Open cannot swap the same sessions twice');
  releaseReset(); assert.equal((await pending).status, 200);
  assert.equal(changes.has('eva'), false, 'success releases the reservation');
  // A failed disk/session mutation must release it as well.
  ctx.sdkSessions.reset = async () => { throw new Error('Fixture engine reset failed'); };
  // archive() tolerates engine cleanup failure; invalid input still fails save.
  assert.equal((await call('/api/members/eva/chats', { messages: [] })).status, 400);
  assert.equal(changes.has('eva'), false, 'failure releases the reservation');
  console.log('PASS history admission: busy Open/New chat refused without changes, session swap blocks same-member starts/concurrent Open, other members and failure cleanup preserved.');
} finally { releaseReset(); await pending?.catch(() => {}); await rm(directory, { recursive: true, force: true }); }
