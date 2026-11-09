// Actual thread/history routes and persisted state, with engine preparation
// gated at the two boundaries where Stop previously had no run id to target.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as threads from '../server/routes/member-threads.route.mjs';
import * as history from '../server/routes/history.route.mjs';
import { ChatStore, buildChatRecord } from '../server/chats/store.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-thread-races-'));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const workspaceGate = deferred(), workspaceEntered = deferred(), launchGate = deferred(), launchEntered = deferred();
const events = new EventEmitter();
const runs = new Map([['unrelated', { id: 'unrelated', agentId: 'noah', status: 'running' }]]);
const stopped = [], failures = [], ids = [];
let stage = 'workspace', starts = 0;
const ctx = {
  squadStateDir: directory, runs, events, SEVERITY: { ERROR: 17 },
  emit: (name, data) => events.emit(name, data), logEvent: (_severity, message) => failures.push(message),
  json: (res, status, body) => { res.result = { status, ...body }; }, readBody: async req => req.body || {},
  agentChannelActions: { memberAccess: async id => ({ agent: { id, name: 'Eva', workspace: directory } }) },
  cleanWorkspace: async () => { if (stage === 'workspace') { workspaceEntered.resolve(); await workspaceGate.promise; } return directory; },
  startRun: async () => {
    starts++;
    const run = { id: `run-${starts}`, agentId: 'eva', status: 'running', reply: '', finishedAt: null };
    runs.set(run.id, run); launchEntered.resolve(); await launchGate.promise; return run;
  },
  stopRun: async id => { const run = runs.get(id); if (!run) return false; stopped.push(id); run.status = 'stopped'; run.finishedAt = new Date().toISOString(); return true; },
};
async function call(module, path, method = 'GET', body) {
  const res = {};
  assert.equal(await module.handle({ method, body }, res, new URL(path, 'http://127.0.0.1'), ctx), true);
  return res.result;
}
const prefix = '/api/members/eva/threads';
async function create(id) {
  const result = await call(threads, prefix, 'POST', { root: { id, role: 'user', body: 'Review the release' }, creationId: id });
  assert.equal(result.status, 201); ids.push(result.data.id); return result.data.id;
}
async function until(check) {
  const end = Date.now() + 3000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('thread did not reach the gated state');
}
try {
  await threads.init(ctx); await history.init(ctx);
  const store = new ChatStore({ squadStateDir: directory });
  await store.save(buildChatRecord('eva', { messages: [{ id: 'saved-u', role: 'user', body: 'Earlier discussion' }] }, { id: 'chat-source' }));
  const first = await create('before-workspace');
  await call(threads, `${prefix}/${first}/messages`, 'POST', { text: 'Start work', requestId: 'first' });
  await workspaceEntered.promise;
  const refused = await call(history, '/api/members/eva/history/merge', 'POST', { requestId: 'live-merge', selection: [{ kind: 'thread', id: first }, { kind: 'chat', id: 'chat-source' }] });
  assert.equal(refused.status, 409, 'a starting thread cannot be merged as if it were finished');
  assert.equal((await store.list('eva')).length, 1, 'live merge refusal saves nothing');
  assert.equal((await call(threads, `${prefix}/${first}`, 'DELETE')).status, 409, 'deletion cannot race pending work');
  const firstStop = call(threads, `${prefix}/${first}/stop`, 'POST');
  await until(async () => JSON.parse(await readFile(join(directory, 'member-threads.json'), 'utf8')).threads[0].stopRequested);
  workspaceGate.resolve();
  assert.equal((await firstStop).status, 200);
  assert.equal(starts, 0, 'Stop before workspace preparation completes prevents the engine launch');
  assert.equal((await call(threads, `${prefix}/${first}`)).data.working, false);
  assert.equal((await call(threads, `${prefix}/${first}`, 'DELETE')).status, 200);

  stage = 'launch';
  const second = await create('before-run-receipt');
  await call(threads, `${prefix}/${second}/messages`, 'POST', { text: 'Start another review', requestId: 'second' });
  await launchEntered.promise;
  const secondStop = call(threads, `${prefix}/${second}/stop`, 'POST');
  await until(async () => JSON.parse(await readFile(join(directory, 'member-threads.json'), 'utf8')).threads.some(thread => thread.id === second && thread.stopRequested));
  launchGate.resolve();
  assert.equal((await secondStop).status, 200);
  assert.deepEqual([...new Set(stopped)], ['run-1'], 'a late run receipt is stopped by its exact id');
  assert.equal(runs.get('unrelated').status, 'running');
  assert.equal((await call(threads, `${prefix}/${second}`, 'DELETE')).status, 200);
  assert.equal((await call(threads, prefix)).data.threads.length, 0, 'late results do not recreate either deleted thread');
  assert.deepEqual(failures, []);
  console.log('PASS thread/history races: live merge/delete refused, Stop before preparation prevents launch, late run receipt cancelled exactly, unrelated work preserved, deleted threads stay absent.');
} finally {
  workspaceGate.resolve(); launchGate.resolve();
  for (const id of ids) await call(threads, `${prefix}/${id}/stop`, 'POST').catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
