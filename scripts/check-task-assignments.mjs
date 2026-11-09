#!/usr/bin/env node
// Real managed MCP dispatch, persisted work/queue stores and the serial
// dispatcher. The gated executor stands in for the engine, not the queue.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeamService } from '../server/team/service.mjs';
import { createWorkStore, taskInputFrom } from '../server/work/store.mjs';
import { QueueStore } from '../server/queues/store.mjs';
import { QueueDispatcher } from '../server/queues/dispatcher.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-task-assignments-'));
let dispatcher;
try {
  const roster = [{ id: 'eva', name: 'Eva' }, { id: 'noah', name: 'Noah' }];
  let assignments;
  const team = createTeamService({ stateDir: directory, rootDir: directory, bridgeUrl: 'http://127.0.0.1:1', members: async () => roster, isBusy: async () => false, assignTask: input => assignments.assign(input) });
  const session = await team.openWork({ memberId: 'noah', runId: 'turn-1', workspace: directory });
  const token = session.mcpServer.env.AUTOHAND_SQUAD_TEAM_TOKEN;
  const call = (args, id = 1) => team.dispatch(token, { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'squad_assign_task', arguments: args } });
  const tools = await team.dispatch(token, { jsonrpc: '2.0', id: 0, method: 'tools/list' });
  assert.ok(tools.tools.some(tool => tool.name === 'squad_assign_task'), 'a member can assign a durable task through the managed MCP');
  const { createTaskAssignments } = await import('../server/work/assignments.mjs');
  const work = createWorkStore(join(directory, 'work.json'));
  await work.load();
  const queue = new QueueStore({ squadStateDir: directory });
  await queue.ready;
  let busy = true;
  const starts = [];
  const gates = new Map();
  dispatcher = new QueueDispatcher({ store: queue, isMemberBusy: async () => busy, canRun: item => Boolean(work.task(item.workTaskId)), executeTurn: (payload, { signal }) => new Promise((resolve, reject) => {
    starts.push(payload.workTaskId);
    gates.set(payload.workTaskId, resolve);
    signal.addEventListener('abort', () => reject(new Error('selected task cancelled')), { once: true });
  }), emit: (name, event) => { if (name === 'queue.started' || name === 'queue.finished') void assignments.sync(event.itemId); } });
  assignments = createTaskAssignments({ work, queue, dispatcher, prepare: async memberId => ({ agentId: memberId, agent: roster.find(m => m.id === memberId), workspace: directory }) });
  const args = { to: 'Eva', title: 'Review release', detail: 'Check the actual artifact', request_id: 'review-1' };
  const first = JSON.parse((await call(args)).content[0].text);
  assert.equal(first.status, 'queued');
  assert.equal(work.task(first.taskId).assignment.fromName, 'Noah');
  await dispatcher.tick();
  assert.equal(starts.length, 0, 'busy recipient continues its current work');
  const repeats = await Promise.all([call(args, 2), call(args, 3)]);
  assert.ok(repeats.every(r => JSON.parse(r.content[0].text).taskId === first.taskId));
  assert.equal(queue.items.size, 1, 'parallel retries create one task and one queue entry');
  assert.equal((await call({ ...args, title: 'Different request' }, 4)).isError, true, 'reusing a request id for different work is refused');
  const persisted = createWorkStore(join(directory, 'work.json'));
  await persisted.load();
  assert.equal(persisted.task(first.taskId).assignment.fromId, 'noah', 'sender survives disk reload');
  await assignments.remove(first.taskId);
  assert.equal((await queue.get(first.queueItemId)).status, 'cancelled');
  assert.equal((await call(args, 5)).isError, true, 'replay cannot recreate a task the owner deleted');
  const second = JSON.parse((await call({ ...args, request_id: 'review-2' }, 6)).content[0].text);
  const third = JSON.parse((await call({ ...args, title: 'Then test', request_id: 'review-3' }, 7)).content[0].text);
  busy = false;
  await dispatcher.tick();
  await until(() => starts.includes(second.taskId));
  await until(() => work.task(second.taskId)?.status === 'doing');
  await assignments.remove(second.taskId);
  await until(() => starts.includes(third.taskId));
  assert.equal(queue.memberState('eva').paused, false, 'deleting one task does not pause unrelated work');
  assert.equal(work.task(second.taskId), null, 'cancel completion does not resurrect the deleted task');
  gates.get(third.taskId)({ reply: 'Tested the release.' });
  await until(() => work.task(third.taskId)?.status === 'done');
  assert.match(work.task(third.taskId).outcome, /Tested/);
  const self = await call({ ...args, to: 'Noah', request_id: 'self' }, 8);
  assert.equal(self.isError, true, 'assignment requires a different saved member');
  const forged = await call({ ...args, fromId: 'eva', request_id: 'forge' }, 9);
  assert.equal(forged.isError, true, 'sender cannot be spoofed through tool arguments');
  const orphan = taskInputFrom({ title: 'Old interrupted task' }, null, { memberId: 'eva' });
  orphan.assignment = { queueItemId: 'missing-item', state: 'running' }; work.replaceTask(orphan); await work.save();
  await assignments.remove(orphan.id); assert.equal(work.task(orphan.id), null, 'owner can delete a task even when its old queue record is gone');
  console.log('check-task-assignments: managed assignment, busy queue, persistence, replay, targeted deletion and completion passed');
} finally {
  dispatcher?.close();
  if (dispatcher) await Promise.all([...dispatcher.workers.values()].map(worker => worker.done));
  await rm(directory, { recursive: true, force: true });
}

async function until(check) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('task lifecycle did not reach the expected state');
}
