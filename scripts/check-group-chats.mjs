import assert from 'node:assert/strict';
import { createBridgeClient, createTools } from '../server/control-plane/runtime.mjs';
import { startBridge } from './lib/reliability-browser.mjs';
import { prepareModelRoutingFixture } from './lib/model-routing-fixtures.mjs';
import { createSquadManagement } from '../server/team/member-management.mjs';
import { ownedFixtureHeaders } from './lib/owned-bridge-fixture.mjs';

const bridge = await startBridge({ development: false, prepare: prepareModelRoutingFixture });
try {
  const tools = createTools(createBridgeClient(bridge.origin));
  const members = [];
  for (const name of ['Eva', 'Noah', 'Iris']) members.push(await tools.create_member({ request_id: name, name, role: 'Reviewer', workspace: process.cwd() }));
  const result = await tools.create_group_chat({ request_id: 'review-group', name: 'Release discussion', member_ids: members.slice(0, 2).map(member => member.id) });
  assert.equal(result.channel.kind, 'group', 'a group chat is distinct from an ordinary private channel');
  assert.equal(result.channel.visibility, 'private');
  assert.deepEqual(result.channel.memberIds, members.slice(0, 2).map(member => member.id));
  const legacy = (await bridge.api('/api/channels')).data;
  for (const channel of legacy.channels) { delete channel.kind; delete channel.groupCreation; delete channel.groupConversion; }
  assert.equal((await bridge.api('/api/channels', 'PUT', legacy)).success, true);
  const retained = (await bridge.api('/api/channels')).data.channels.find(channel => channel.id === result.channel.id);
  assert.equal(retained.kind, 'group', 'older clients that omit lifecycle fields cannot erase a group identity');
  assert.equal((await tools.get_group_chat({ group_id: result.channel.id })).kind, 'group');
  assert((await tools.list_group_chats()).groups.some(group => group.id === result.channel.id));
  const publicPatch = await bridge.api('/api/channels/' + result.channel.id, 'PATCH', { visibility: 'public' });
  assert.equal(publicPatch.status, 400, 'making a group public requires explicit conversion');
  await tools.send_channel_message({ channel_id: result.channel.id, text: 'Keep this release discussion.', member_ids: [] });
  const omitted = (await bridge.api('/api/channels')).data;
  omitted.channels = omitted.channels.filter(channel => channel.id !== result.channel.id);
  delete omitted.revision;
  await bridge.api('/api/channels', 'PUT', omitted);
  const restored = (await bridge.api('/api/channels')).data;
  assert(restored.channels.some(channel => channel.id === result.channel.id), 'an older snapshot cannot omit a canonical group without an explicit deletion');
  assert(restored.messages.some(message => message.channelId === result.channel.id && message.body === 'Keep this release discussion.'), 'omitted groups retain their exact history');
  const staleHistory = (await bridge.api('/api/channels')).data;
  const savedHistory = { messages: staleHistory.messages, threads: staleHistory.threads };
  delete staleHistory.revision;
  staleHistory.messages = [];
  staleHistory.threads = [];
  await bridge.api('/api/channels', 'PUT', staleHistory);
  const retainedHistory = (await bridge.api('/api/channels')).data;
  assert.deepEqual(retainedHistory.messages, savedHistory.messages, 'a legacy snapshot retaining the group row cannot erase newer group messages');
  assert.deepEqual(retainedHistory.threads, savedHistory.threads, 'a legacy snapshot retaining the group row cannot erase newer group threads');
  const before = (await bridge.api('/api/channels')).data;
  const converted = await tools.convert_group_chat({ group_id: result.channel.id, visibility: 'public', name: 'release-coordination', request_id: 'convert-public' });
  assert.equal(converted.channel.id, result.channel.id, 'conversion retains the conversation identity');
  assert.equal(converted.channel.kind, 'channel');
  assert.equal(converted.channel.visibility, 'public');
  assert.deepEqual(converted.channel.memberIds, result.channel.memberIds);
  const after = (await bridge.api('/api/channels')).data;
  assert.deepEqual(after.messages, before.messages, 'conversion retains exact saved messages');
  assert.deepEqual(after.threads, before.threads, 'conversion retains exact saved threads');
  const kindless = { ...result.channel, updatedAt: '2099-01-01T00:00:00Z' };
  delete kindless.kind; delete kindless.groupCreation; delete kindless.groupConversion;
  await bridge.api('/api/channels/sync', 'PUT', { channels: [kindless] });
  const conversionFence = (await bridge.api('/api/channels')).data.channels.find(channel => channel.id === result.channel.id);
  assert.equal(conversionFence.name, 'release-coordination', 'a kind-less old cache cannot revert the explicit conversion name');
  assert.equal(conversionFence.visibility, 'public', 'a kind-less old cache cannot revert explicit conversion visibility');
  await assert.rejects(() => tools.delete_group_chat({ group_id: result.channel.id }), error => error.status === 409, 'a stale group delete cannot delete a converted channel');
  const disposable = (await tools.create_group_chat({ request_id: 'disposable-group', name: 'Temporary discussion', member_ids: members.slice(0, 2).map(member => member.id) })).channel;
  await tools.send_channel_message({ channel_id: disposable.id, text: 'Delete this discussion only.', member_ids: [] });
  const deleted = await tools.delete_group_chat({ group_id: disposable.id });
  assert.equal(deleted.deleted, true);
  const remaining = (await bridge.api('/api/channels')).data;
  assert(!remaining.channels.some(channel => channel.id === disposable.id));
  assert(!remaining.messages.some(message => message.channelId === disposable.id));
  assert(!remaining.threads.some(thread => thread.channelId === disposable.id));
  assert(remaining.deletedChannelIds.includes(disposable.id));
  assert(remaining.channels.some(channel => channel.id === result.channel.id), 'the converted channel remains present');
  await assert.rejects(() => tools.create_group_chat({ request_id: 'disposable-group', name: 'Temporary discussion', member_ids: members.slice(0, 2).map(member => member.id) }), error => error.status === 409, 'creation replay cannot resurrect a deleted group');
  await bridge.api('/api/channels/sync', 'PUT', { channels: [{ ...result.channel, updatedAt: '2099-01-01T00:00:00Z' }, disposable] });
  const reconciled = (await bridge.api('/api/channels')).data;
  assert.equal(reconciled.channels.find(channel => channel.id === result.channel.id).kind, 'channel', 'a stale group cache cannot undo conversion');
  assert.equal(reconciled.channels.find(channel => channel.id === result.channel.id).visibility, 'public');
  assert(!reconciled.channels.some(channel => channel.id === disposable.id), 'sync honors deletion tombstones');

  const outside = (await tools.create_group_chat({ name: 'Other members', member_ids: members.slice(1).map(member => member.id) })).channel;
  await tools.set_member_abilities({ member_id: members[0].id, tool_policies: ['squad_create_group_chat', 'squad_convert_group_chat', 'squad_delete_group_chat'].map(id => ({ id, mode: 'allow' })) });
  const management = createSquadManagement({
    actions: () => ({ memberAccess: async id => (await bridge.api('/api/channels')).data.agentChannelAccess[id] }),
    request: async (path, method, body, { signal }) => {
      const response = await fetch(bridge.origin + path, { method, signal, headers: await ownedFixtureHeaders(bridge.origin), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const envelope = await response.json();
      if (!response.ok) throw Object.assign(new Error(envelope.error), { status: response.status });
      return envelope.data;
    },
  });
  const call = (name, input) => management(name, input, { memberId: members[0].id, runId: 'active-group-turn', workspace: process.cwd() }, () => {});
  assert(!(await call('squad_list_group_chats', {})).groups.some(group => group.id === outside.id), 'managed discovery excludes other private groups');
  await assert.rejects(() => call('squad_get_group_chat', { group_id: 'group-not-present' }), error => error.status === 403, 'managed reads do not distinguish missing private groups from unassigned groups');
  for (const name of ['squad_get_group_chat', 'squad_delete_group_chat', 'squad_convert_group_chat']) {
    await assert.rejects(() => call(name, { group_id: outside.id, ...(name.includes('convert') ? { visibility: 'public' } : {}) }), error => error.status === 403, 'nonmembers cannot read or mutate a private group');
  }
  await assert.rejects(() => call('squad_create_group_chat', { name: 'Unauthorized roster', member_ids: members.slice(1).map(member => member.id) }), error => error.status === 403, 'managed creation must include its acting member');
  const managed = (await call('squad_create_group_chat', { name: 'Managed discussion', member_ids: members.slice(0, 2).map(member => member.id), request_id: 'managed-once' })).channel;
  assert.equal(managed.kind, 'group');
  assert.equal((await call('squad_convert_group_chat', { group_id: managed.id, visibility: 'private', request_id: 'managed-conversion' })).channel.visibility, 'private');
  await assert.rejects(() => call('squad_delete_group_chat', { group_id: managed.id }), error => error.status === 409);
  const longActor = 'a'.repeat(80);
  assert.equal((await bridge.api('/api/members/' + longActor + '/channel-access', 'PUT', { agent: { id: longActor, name: 'Long identity', role: 'Reviewer', permissions: { builtInPolicies: { squad_create_group_chat: 'allow' } } } })).success, true);
  const longRequest = await management('squad_create_group_chat', { name: 'Maximum identity bounds', request_id: 'r'.repeat(128), member_ids: [longActor, members[1].id] }, { memberId: longActor, runId: 'long-turn', workspace: process.cwd() }, () => {});
  assert.equal(longRequest.channel.kind, 'group', 'schema-valid maximum identities remain valid after actor namespacing');

  for (const reverse of [false, true]) {
    const racing = (await tools.create_group_chat({ name: `Concurrent ${reverse}`, member_ids: members.slice(0, 2).map(member => member.id) })).channel;
    const operations = [() => tools.convert_group_chat({ group_id: racing.id, visibility: 'private' }), () => tools.delete_group_chat({ group_id: racing.id })];
    if (reverse) operations.reverse();
    const outcomes = await Promise.allSettled(operations.map(operation => operation()));
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1, 'conversion and deletion cannot both succeed');
    const current = (await bridge.api('/api/channels')).data;
    const saved = current.channels.find(channel => channel.id === racing.id);
    assert(saved?.kind === 'channel' || current.deletedChannelIds.includes(racing.id));
  }
  await bridge.restart();
  const reconnected = createTools(createBridgeClient(bridge.origin));
  assert.equal((await reconnected.get_group_chat({ group_id: outside.id })).kind, 'group');
  assert.equal((await reconnected.create_group_chat({ request_id: 'review-group', name: 'Release discussion', member_ids: members.slice(0, 2).map(member => member.id) })).channel.kind, 'channel', 'creation replay cannot undo a saved conversion');
  console.log('PASS: real owned group lifecycle, exact history retention, both visibility choices, legacy snapshots, tombstones, concurrent conversion/delete, managed membership isolation, restart and replay. Controlled engines; no vendor inference.');
} finally { await bridge.close(); }
