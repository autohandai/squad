import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConversationChanges } from '../server/chats/admission.mjs';
import { GoalManager } from '../server/goal-manager.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-conversation-goal-race-'));
const changes = createConversationChanges({ isBusy: async () => false });
let checks = 0, engineCalls = 0, enteredRun, allowRun, release;
const entered = new Promise(resolve => { enteredRun = resolve; });
const gate = new Promise(resolve => { allowRun = resolve; });
const manager = new GoalManager({ squadStateDir: directory,
  assertCanWork: async payload => { changes.assertCanStart(payload.agentId); if (++checks === 2) { enteredRun(); await gate; } },
  executeTurn: async payload => { changes.assertCanStart(payload.agentId); engineCalls++; return { reply: 'Fixture should not enter the engine' }; },
});
try {
  await manager.ready;
  release = await changes.hold('eva');
  await assert.rejects(manager.start({ agentId: 'eva', prompt: 'New goal during history swap' }), /switching conversations/);
  assert.equal((await manager.list()).length, 0, 'busy goal creation fails before persistence');
  release();
  const goal = await manager.start({ agentId: 'eva', prompt: 'Goal admitted just before history swap' });
  await entered; release = await changes.hold('eva'); allowRun();
  await manager.workers.get(goal.id).done;
  assert.equal(engineCalls, 0, 'the common turn guard blocks a late goal turn during session movement');
  assert.equal((await manager.get(goal.id)).status, 'paused', 'transient conversation refusal keeps the objective resumable');
  await assert.rejects(manager.control(goal.id, 'resume'), /switching conversations/);
  assert.equal((await manager.get(goal.id)).status, 'paused', 'refused resume leaves the goal paused');
  console.log('PASS conversation/goal admission: create/resume refuse before engine work; a late admitted turn pauses without losing its objective.');
} finally { allowRun(); release?.(); await Promise.all([...manager.workers.values()].map(worker => worker.done)); await rm(directory, { recursive: true, force: true }); }
