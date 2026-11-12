import assert from 'node:assert/strict';
import { createBridgeClient, createTools } from '../server/control-plane/runtime.mjs';
import { startBridge } from './lib/reliability-browser.mjs';
import { prepareModelRoutingFixture } from './lib/model-routing-fixtures.mjs';
import { initialMemberExecution } from '../src/lib/model-routing.js';

const available = [
  { id: 'autohand', isDefault: true, status: 'setup-required' },
  { id: 'codex', status: 'ready', defaults: { model: 'codex-default', effort: 'high' } },
  { id: 'acp:gemini', status: 'ready', installed: true },
  { id: 'acp:cursor', status: 'ready', fetchOnUse: true, installed: false },
  { id: 'claude', status: 'not-detected' },
];
const automatic = initialMemberExecution(available);
assert.equal(automatic.harness.id, 'codex', 'an unavailable default cannot displace a ready connected engine');
assert.deepEqual(automatic.modelRouting.fallbacks.map(route => route.harness.id), ['acp:gemini'], 'automatic failover selects installed ACP connections, not fetch-on-use or unavailable engines');
const explicit = initialMemberExecution(available, { harness: { id: 'codex', model: 'chosen-model', effort: 'xhigh', access: 'plan' }, modelRouting: { fallbacks: [], allowAgentChanges: false } });
assert.equal(explicit.harness.model, 'chosen-model');
assert.equal(explicit.harness.effort, 'xhigh');
assert.equal(explicit.harness.access, 'plan');
assert.deepEqual(explicit.modelRouting.fallbacks, [], 'the user can explicitly disable automatic fallbacks');
assert.deepEqual(initialMemberExecution([]).modelRouting.fallbacks, [], 'no connected engine does not invent a fallback');

// Real owned HTTP/MCP-client boundary; recording engines provide readiness,
// defaults and authentication without a vendor request or real credentials.
const bridge = await startBridge({ development: false, prepare: prepareModelRoutingFixture });
try {
  const firstInstall = await bridge.api('/api/setup/complete', 'POST', { paths: [process.cwd()] });
  assert.equal(firstInstall.success, true, firstInstall.error);
  const coordinator = firstInstall.data.member;
  assert.equal(coordinator.harness.id, 'autohand', 'first install retains its advertised primary');
  assert(coordinator.modelRouting.fallbacks.some(route => route.harness.id === 'codex'), 'first install saves connected failovers through the owned HTTP boundary');
  const coordinatorAccess = (await bridge.api('/api/channels')).data.agentChannelAccess[coordinator.id].agent;
  const noCoordinatorFallbacks = { version: 1, fallbacks: [], allowAgentChanges: false };
  const editedCoordinator = await bridge.api(`/api/members/${coordinator.id}/channel-access`, 'PUT', { agent: coordinatorAccess, profilePatch: { modelRouting: noCoordinatorFallbacks }, expectedProfileRevision: coordinatorAccess.profileRevision });
  assert.equal(editedCoordinator.success, true, editedCoordinator.error);
  const setupReplay = await bridge.api('/api/setup/complete', 'POST', { paths: [] });
  assert.deepEqual(setupReplay.data.member.modelRouting, noCoordinatorFallbacks, 'setup replay preserves the person’s cleared fallback chain');
  const tools = () => createTools(createBridgeClient(bridge.origin));
  const created = await tools().create_member({ request_id: 'automatic-routing', name: 'Tatiana', role: 'Engineer', engine: 'codex' });
  let profile = await tools().get_member_profile({ member_id: created.id });
  assert(profile.modelRouting?.fallbacks.some(route => route.harness.id === 'claude'), 'new MCP members automatically get another ready engine');
  assert.equal(profile.harness?.id, 'codex', 'an explicit primary engine is preserved');
  assert.equal(profile.harness.model, 'codex-default', 'primary uses the connected engine default model');
  assert.equal(profile.harness.effort, 'high', 'primary uses the connected engine default reasoning');
  assert(!profile.modelRouting.fallbacks.some(route => route.harness.id === 'codex'), 'the primary engine is not its own automatic fallback');
  assert.equal(profile.modelRouting.allowAgentChanges, false, 'automatic setup does not delegate ongoing routing changes');
  const defaults = await tools().create_member({ request_id: 'preferred-ready-engine', name: 'Nova', role: 'Designer' });
  assert.equal(defaults.harness.id, 'autohand', 'automatic primary prefers the ready default engine');
  assert(defaults.modelRouting.fallbacks.some(route => route.harness.id === 'codex'));
  const canonical = (await bridge.api('/api/channels')).data.agentChannelAccess[created.id].agent;
  const chosenRouting = { version: 1, fallbacks: [], allowAgentChanges: false };
  const edited = await bridge.api('/api/members/' + created.id + '/channel-access', 'PUT', { agent: canonical, profilePatch: { modelRouting: chosenRouting }, expectedProfileRevision: profile.revision });
  assert.equal(edited.success, true, 'the ordinary app editor can clear automatic fallbacks');
  await bridge.restart();
  profile = await tools().get_member_profile({ member_id: created.id });
  assert.deepEqual(profile.modelRouting, chosenRouting, 'a user-cleared fallback list survives a service restart');
  assert.equal(profile.harness.model, 'codex-default');
  const replay = await tools().create_member({ request_id: 'automatic-routing', name: 'Tatiana', role: 'Engineer', engine: 'codex' });
  assert.equal(replay.created, false);
  assert.deepEqual(replay.modelRouting, chosenRouting, 'replay returns the user-edited routing instead of selecting defaults again');
  console.log('PASS: MCP creation chooses connected defaults, saves eligible failovers, preserves explicit primary, permissions and restart/retry identity.');
} finally { await bridge.close(); }
