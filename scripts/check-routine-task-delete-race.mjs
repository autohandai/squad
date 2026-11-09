import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as routines from '../server/routes/routines.route.mjs';
import * as work from '../server/routes/work.route.mjs';
import * as queues from '../server/routes/queues.route.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-routine-task-race-'));
const events = new EventEmitter(), runs = new Map();
let release, entered;
const gate = new Promise(resolve => { release = resolve; });
const starting = new Promise(resolve => { entered = resolve; });
const failures = [];
const ctx = {
  squadStateDir: directory, runs, events, SEVERITY: { INFO: 9, WARN: 13, ERROR: 17 },
  emit: (name, data) => events.emit(name, data), logEvent: (level, message) => { if (level === 17) failures.push(message); },
  json: (res, status, body) => { res.result = { status, ...body }; }, readBody: async req => req.body || {},
  readChannelsState: async () => ({ agentChannelAccess: { eva: { agent: { id: 'eva', name: 'Eva', workspace: directory } } } }),
  agentChannelActions: { registerHandler() {} }, isLiveRun: run => run.status === 'running',
  startRun: async payload => {
    entered(); await gate;
    const run = { id: 'late-routine-run', agentId: 'eva', routineId: payload.routineId, status: 'running' };
    runs.set(run.id, run); return run;
  },
  stopRun: async id => { const run = runs.get(id); if (!run) return false; run.status = 'stopped'; run.finishedAt = new Date().toISOString(); events.emit('run.finished', { runId: id, status: 'stopped' }); return true; },
};
async function call(module, path, method = 'GET', body) {
  const res = {};
  assert.equal(await module.handle({ method, body }, res, new URL(path, 'http://127.0.0.1'), ctx), true);
  return res.result;
}
async function until(check) {
  const end = Date.now() + 3000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('late routine occurrence was not reconciled');
}
let pending;
try {
  await queues.init(ctx); await routines.init(ctx); await work.init(ctx);
  const created = await call(routines, '/api/routines', 'POST', { memberId: 'eva', title: 'Release checks', instructions: 'Verify the release', workspace: directory, schedule: { kind: 'cron', cron: '0 9 * * 1-5', timeZone: 'UTC' } });
  assert.equal(created.status, 201);
  const routineId = created.data.id;
  const task = await call(work, '/api/work', 'POST', { memberId: 'eva', title: 'Release checks', recurring: routineId });
  pending = call(routines, `/api/routines/${routineId}/run`, 'POST');
  await starting;
  assert.equal((await call(work, `/api/work/${task.data.id}`, 'DELETE')).status, 200);
  release(); await pending;
  await until(() => runs.get('late-routine-run')?.status === 'stopped');
  await until(async () => !(await call(routines, `/api/routines/${routineId}`)).data.activeRun);
  assert.equal((await call(work, '/api/work')).data.tasks.length, 0, 'the late start event cannot recreate the deleted task');
  assert.equal((await call(routines, `/api/routines/${routineId}`)).data.enabled, true, 'future scheduled work remains enabled');
  assert.deepEqual(failures, []);
  console.log('PASS routine task deletion race: deleting during preparation stops the late occurrence, keeps the task absent and preserves the future schedule.');
} finally { release(); await pending?.catch(() => {}); queues.taskQueue().dispatcher.close(); await rm(directory, { recursive: true, force: true }); }
