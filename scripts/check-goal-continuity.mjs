#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GoalManager } from '../server/goal-manager.mjs';

const root = await mkdtemp(join(tmpdir(), 'squad-goal-continuity-'));
const pin = { authority: 'squad:eva', packageId: 'research', revision: 'sha256:original', resource: 'SKILL.md' };
const continuity = () => ({ version: 1, approvedIntent: 'Verify approved work', workspaceId: 'repo:stable', skills: [pin], checkReferences: ['check:1'], pendingEffects: [],
  freshness: { runtimeVersion: '1', providerId: 'autohand', permissionEpoch: 'policy:1', capturedAt: Date.now() } });
const context = () => ({ workspaceId: 'repo:stable', runtimeVersion: '1', providerId: 'autohand', permissionEpoch: 'policy:1', checkedAt: Date.now(), resolveSkill: async ref => ({ ...ref }) });
const launch = { agentId: 'eva', workspace: '/moved/current/repository', agent: { id: 'eva', harness: { id: 'autohand' } } };
const complete = async () => ({ reply: 'Verified.', goalReport: { status: 'completed', checklist: [{ id: 'check', title: 'Verify result', status: 'completed' }], evidence: ['check:1'] } });
async function seed(name, savedContinuity = continuity(), options = {}) {
  const manager = new GoalManager({ squadStateDir: join(root, name), executeTurn: complete, ...options }); await manager.ready;
  const goal = { id: name, agentId: 'eva', workspace: launch.workspace, prompt: 'Approved work', harness: 'autohand', status: 'paused', checklist: [], evidence: [], summary: '', latestReply: '', turnCount: 0, maxTurns: 1, maxRuntimeMs: 60_000, launch,
    checkpoint: { summary: 'Progress saved', nextStep: 'Verify', recordedAt: Date.now(), ...(savedContinuity ? { continuity: savedContinuity } : {}) } };
  manager.records.set(name, goal); await manager.save(); return manager;
}
async function finish(manager, id) {
  for (let i = 0; i < 100; i++) { const goal = await manager.get(id); if (goal.status !== 'running') return goal; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Goal did not stop');
}
try {
  const absentHost = await seed('host');
  await assert.rejects(absentHost.control('host', 'resume'), /current context/);
  assert.equal((await absentHost.get('host')).status, 'paused');

  const missing = await seed('missing', continuity(), { resolveContinuityContext: async () => ({ ...context(), resolveSkill: async () => ({ ...pin, revision: 'sha256:new' }) }) });
  await assert.rejects(missing.control('missing', 'resume'), /sha256:original/);
  for (const key of ['workspaceId', 'runtimeVersion', 'providerId', 'permissionEpoch']) {
    const manager = await seed(key, continuity(), { resolveContinuityContext: async () => ({ ...context(), [key]: 'changed' }) });
    await assert.rejects(manager.control(key, 'resume'), new RegExp(key));
  }
  const unknown = continuity(); unknown.pendingEffects = [{ id: 'publish', description: 'Publication uncertain', status: 'unknown' }];
  let observation = 'unknown'; let observed = 0;
  const effects = await seed('effects', unknown, { resolveContinuityContext: async () => ({ ...context(), observeEffect: async () => { observed++; return { status: observation, evidence: 'receipt:verified', observedAt: Date.now() }; } }) });
  await assert.rejects(effects.control('effects', 'resume'), /uncertain/);
  observation = 'completed';
  await effects.control('effects', 'resume');
  const finished = await finish(effects, 'effects');
  assert.equal(finished.status, 'completed'); assert.equal(observed, 2);
  assert.equal(finished.checkpoint.continuity.pendingEffects[0].observation.status, 'completed');
  assert.equal(finished.checkpointHistory[0].continuity.pendingEffects[0].status, 'unknown');

  const upgrades = await seed('upgrades');
  const updated = await upgrades.upgradeSkillPins('upgrades', [{ ...pin, revision: 'sha256:approved-new' }]);
  assert.equal(updated.status, 'paused'); assert.equal(updated.checkpointHistory[0].continuity.skills[0].revision, pin.revision);
  assert.equal(updated.checkpoint.continuity.skills[0].revision, 'sha256:approved-new');
  await assert.rejects(upgrades.checkpoint('upgrades', { summary: 'Unpinned', continuity: { ...continuity(), skills: [{ authority: pin.authority, packageId: pin.packageId }] } }), /exact skill revision/);

  const restart = await seed('restart'); restart.records.get('restart').status = 'running'; await restart.save();
  let turns = 0;
  const recovered = new GoalManager({ squadStateDir: join(root, 'restart'), executeTurn: async () => { turns++; return complete(); } });
  assert.equal((await recovered.get('restart')).status, 'paused'); assert.equal(turns, 0);
  assert.deepEqual((await recovered.get('restart')).checkpoint.continuity.skills, [pin]);

  let releasePreflight; let enteredPreflight;
  const entered = new Promise(resolve => { enteredPreflight = resolve; });
  const interrupted = await seed('interrupted', continuity(), { resolveContinuityContext: async () => {
    enteredPreflight(); await new Promise(resolve => { releasePreflight = resolve; }); return context();
  } });
  const pendingResume = interrupted.control('interrupted', 'resume');
  await entered; await interrupted.control('interrupted', 'cancel'); releasePreflight();
  await assert.rejects(pendingResume, /changed/);
  assert.equal((await interrupted.get('interrupted')).status, 'cancelled');

  const captureContext = { workspaceId: 'repo:stable', runtimeVersion: '1', providerId: 'autohand', permissionEpoch: 'policy:1', capturedAt: Date.now() };
  const captured = await seed('captured', null, { executeTurn: async () => ({ ...await complete(), skillReceipts: [{ state: 'supplied', current: true, reference: pin }], skillContinuityContext: captureContext }) });
  await captured.control('captured', 'resume');
  const capturedGoal = await finish(captured, 'captured');
  assert.deepEqual(capturedGoal.checkpoint.continuity.skills, [pin]);
  assert.equal(capturedGoal.checkpoint.continuity.approvedIntent, 'Approved work');
  let predispatchObserved = false;
  const predispatch = await seed('predispatch', null, { executeTurn: async (payload, options) => {
    await options.onSkillContinuity({ skillReceipts: [{ state: 'prepared', current: true, reference: pin }], skillContinuityContext: captureContext });
    const persisted = JSON.parse(await readFile(join(root, 'predispatch', 'goals.json'), 'utf8'));
    assert.deepEqual(persisted.goals[0].checkpoint.continuity.skills, [pin]);
    predispatchObserved = true; return complete();
  } });
  await predispatch.control('predispatch', 'resume'); await finish(predispatch, 'predispatch'); assert.equal(predispatchObserved, true);

  const drift = await seed('drift', continuity(), { resolveContinuityContext: async () => context(), executeTurn: async () => ({ ...await complete(), skillReceipts: [{ state: 'submitted', current: true, reference: { ...pin, revision: 'sha256:drift' } }], skillContinuityContext: captureContext }) });
  await drift.control('drift', 'resume');
  const drifted = await finish(drift, 'drift');
  assert.equal(drifted.status, 'paused'); assert.match(drifted.pauseReason, /explicit.*upgrade/);
  assert.equal(drifted.checkpoint.continuity.skills[0].revision, pin.revision);

  const old = await seed('old', null); await old.control('old', 'resume');
  assert.equal((await finish(old, 'old')).status, 'completed');

  const live = await seed('live', continuity(), { resolveContinuityContext: async () => context() });
  live.records.set('other', { ...live.records.get('live'), id: 'other', status: 'running' });
  await assert.rejects(live.control('live', 'resume'), /another running goal/);
  assert.equal((await live.get('live')).status, 'paused');
  assert.ok(!(await readFile(join(root, 'upgrades', 'goals.json'), 'utf8')).includes('grants'));
  console.log('Goal continuity checks passed: strict pins/current context, uncertain effect observation, historical upgrades, restart pause, old records, and live-owner rejection.');
} finally { await rm(root, { recursive: true, force: true }); }
