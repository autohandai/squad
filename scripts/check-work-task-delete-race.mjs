import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as work from '../server/routes/work.route.mjs';
import * as queues from '../server/routes/queues.route.mjs';
import { createWorkStore } from '../server/work/store.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-task-delete-race-'));
const events = new EventEmitter();
const ctx = {
  squadStateDir: directory, runs: new Map(), events, SEVERITY: { INFO: 9 },
  emit: (name, data) => events.emit(name, data), logEvent() {},
  json: (res, status, body) => { res.result = { status, ...body }; },
  readBody: async req => { await req.waitForBody; return req.body || {}; },
  readChannelsState: async () => ({}), agentChannelActions: { registerHandler() {} },
};
async function call(path, method = 'GET', body, waitForBody) {
  const res = {};
  await work.handle({ method, body, waitForBody }, res, new URL(path, 'http://127.0.0.1'), ctx);
  return res.result;
}
try {
  await queues.init(ctx); await work.init(ctx);
  for (const operation of ['PATCH', 'PUT', 'done']) {
    const task = (await call('/api/work', 'POST', { memberId: 'eva', title: 'Delete wins over a stale edit' })).data;
    let release;
    const waitForBody = new Promise(resolve => { release = resolve; });
    const pending = call(`/api/work/${task.id}${operation === 'done' ? '/done' : ''}`, operation === 'done' ? 'POST' : operation, { title: 'Stale edit', outcome: 'Late completion' }, waitForBody);
    // Let the route reach its awaited request body before deleting the task.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await call(`/api/work/${task.id}`, 'DELETE')).status, 200);
    release();
    assert.equal((await pending).status, 404, `${operation} must re-read the task after waiting for input`);
    assert.equal((await call('/api/work')).data.tasks.some(item => item.id === task.id), false);
  }
  const path = join(directory, 'work.json');
  const saved = JSON.parse(await readFile(path, 'utf8'));
  const deleted = saved.deletedTasks[0];
  const stale = { id: deleted.id, memberId: deleted.memberId, title: 'Stale disk record' };
  saved.tasks.push(stale); await writeFile(path, JSON.stringify(saved));
  const restarted = createWorkStore(path); await restarted.load();
  assert.equal(restarted.task(stale.id), null, 'a tombstone also wins over a stale disk record');
  assert.throws(() => restarted.replaceTask(stale), /deleted/i, 'late bridge writers cannot revive a deleted identity');
  console.log('PASS task delete races: PATCH, PUT and Done cannot revive a deleted task; tombstones survive stale disk and bridge writes.');
} finally { queues.taskQueue().dispatcher.close(); await rm(directory, { recursive: true, force: true }); }
