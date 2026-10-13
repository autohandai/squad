#!/usr/bin/env node
// Channel responder rules (ADR-0094): pure recipient resolution, then the real
// bridge in an isolated state dir against a local fake OpenAI-compatible
// endpoint. No vendor, credential, installed app or provider request is used.
// The fake counts every request so the ADR's request numbers come from here.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBridge, until } from './lib/reliability-browser.mjs';
import {
  decideFromPick,
  needsResponderPick,
  normalizeResponder,
  resolveMentions,
  resolveResponderRecipients,
  responderStatus,
  responderTagLabel,
} from '../src/lib/channel-responders.js';
import { chatCompletionsUrl, directEndpoint, parsePickAnswer } from '../server/responders/pick.mjs';

const failures = [];
const check = async (label, fn) => {
  try { await fn(); console.log(`ok ${label}`); }
  catch (error) { failures.push({ label, error: error.message }); console.error(`FAIL ${label}: ${error.message}`); }
};
const members = [{ id: 'noah', name: 'Noah Reed', role: 'Backend engineer' }, { id: 'iris', name: 'Iris Chen', role: 'Designer' }, { id: 'eva', name: 'Eva Park', role: 'QA' }];
const roster = members.map(member => member.id);
const channelWith = responder => ({ id: 'c1', name: 'build', memberIds: roster, responder });
const mentionsOf = text => resolveMentions(text, members);

// --- Pure rules: mentions > @here > thread > mode ----------------------------
await check('normalisation defaults to everyone and keeps a lead id', () => {
  assert.deepEqual(normalizeResponder(undefined), { mode: 'everyone', leadMemberId: '' });
  assert.deepEqual(normalizeResponder({ mode: 'bogus', leadMemberId: 7 }), { mode: 'everyone', leadMemberId: '7' });
  assert.deepEqual(normalizeResponder({ mode: 'lead', leadMemberId: ' noah ' }), { mode: 'lead', leadMemberId: 'noah' });
});
await check('explicit mentions win over every mode', () => {
  for (const mode of ['everyone', 'lead', 'auto']) {
    const channel = channelWith({ mode, leadMemberId: 'iris' });
    const mentions = mentionsOf('@Noah please look');
    assert.equal(needsResponderPick(mentions, channel), false, `${mode}: a mentioned message never needs a pick`);
    const result = resolveResponderRecipients({ mentions, channel, pick: { rule: 'auto', memberIds: ['eva'], memberId: 'eva', probability: 0.99 } });
    assert.deepEqual(result, { rule: 'mentions', memberIds: ['noah'], responder: null });
  }
});
await check('@here wins over lead and auto', () => {
  for (const mode of ['lead', 'auto']) {
    const result = resolveResponderRecipients({ mentions: mentionsOf('@here standup'), channel: channelWith({ mode, leadMemberId: 'iris' }) });
    assert.equal(result.rule, 'here'); assert.deepEqual(result.memberIds, roster);
  }
});
await check('thread follow-ups keep the thread recipients without a pick', () => {
  const channel = channelWith({ mode: 'auto', leadMemberId: '' });
  const mentions = { hasMentions: false, mode: 'thread', targetMemberIds: ['eva'] };
  assert.equal(needsResponderPick(mentions, channel), false);
  assert.deepEqual(resolveResponderRecipients({ mentions, channel }), { rule: 'thread', memberIds: ['eva'], responder: null });
});
await check('everyone mode is the original fan-out', () => {
  const result = resolveResponderRecipients({ mentions: mentionsOf('ship it'), channel: channelWith({ mode: 'everyone' }) });
  assert.deepEqual(result, { rule: 'everyone', memberIds: roster, responder: null });
  assert.equal(needsResponderPick(mentionsOf('ship it'), channelWith({ mode: 'everyone' })), false);
});
await check('lead mode sends un-mentioned messages to the lead only', () => {
  const result = resolveResponderRecipients({ mentions: mentionsOf('ship it'), channel: channelWith({ mode: 'lead', leadMemberId: 'iris' }) });
  assert.deepEqual(result.memberIds, ['iris']); assert.equal(result.rule, 'lead');
  assert.equal(responderTagLabel(result.responder, members), 'Answered by Iris Chen (lead)');
});
await check('a lead removed from the roster falls back to everyone and says so', () => {
  const channel = { ...channelWith({ mode: 'lead', leadMemberId: 'iris' }), memberIds: ['noah', 'eva'] };
  const status = responderStatus(channel);
  assert.equal(status.leadMissing, true); assert.equal(status.effectiveMode, 'everyone'); assert.equal(status.leadMemberId, '');
  const result = resolveResponderRecipients({ mentions: mentionsOf('ship it'), channel });
  assert.deepEqual(result.memberIds, ['noah', 'eva']); assert.equal(result.rule, 'everyone');
  assert.equal(result.responder.reason, 'lead left the channel');
});
await check('auto decisions: one member at >= 0.6, everyone for several, otherwise the lead or everyone', () => {
  assert.deepEqual(decideFromPick({ choice: 'noah', probability: 0.8 }, { memberIds: roster, leadMemberId: 'iris' }).memberIds, ['noah']);
  assert.deepEqual(decideFromPick({ choice: 'several', probability: 0.9 }, { memberIds: roster, leadMemberId: 'iris' }).memberIds, roster);
  assert.deepEqual(decideFromPick({ choice: 'noah', probability: 0.59 }, { memberIds: roster, leadMemberId: 'iris' }).memberIds, ['iris']);
  assert.deepEqual(decideFromPick({ choice: 'noah', probability: 0.59 }, { memberIds: roster, leadMemberId: '' }).memberIds, roster);
  assert.equal(decideFromPick({ choice: 'ghost', probability: 0.99 }, { memberIds: roster, leadMemberId: 'iris' }).reason, 'invalid answer');
  assert.equal(decideFromPick({ choice: 'noah', probability: 'high' }, { memberIds: roster }).reason, 'invalid answer');
  const auto = resolveResponderRecipients({ mentions: mentionsOf('ship it'), channel: channelWith({ mode: 'auto' }), pick: decideFromPick({ choice: 'noah', probability: 0.8 }, { memberIds: roster }) });
  assert.equal(responderTagLabel(auto.responder, members), 'Answered by Noah Reed (auto · 80%)');
  const several = resolveResponderRecipients({ mentions: mentionsOf('ship it'), channel: channelWith({ mode: 'auto' }), pick: decideFromPick({ choice: 'several', probability: 0.7 }, { memberIds: roster }) });
  assert.equal(responderTagLabel(several.responder, members), 'Everyone answered (auto · 70%)');
  const unavailable = resolveResponderRecipients({ mentions: mentionsOf('ship it'), channel: channelWith({ mode: 'auto', leadMemberId: 'iris' }), pick: { reason: 'timeout after 3000 ms' } });
  assert.deepEqual(unavailable.memberIds, ['iris']);
  assert.equal(responderTagLabel(unavailable.responder, members), 'Answered by Iris Chen (auto fell back: timeout after 3000 ms)');
  assert.equal(responderTagLabel(null, members), '');
});
await check('direct endpoints: OpenAI-compatible providers with a key, Ollama without, nothing else', () => {
  assert.equal(chatCompletionsUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(chatCompletionsUrl('http://127.0.0.1:11434', 'ollama'), 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(chatCompletionsUrl('https://api.deepseek.com', 'deepseek'), 'https://api.deepseek.com/chat/completions');
  assert.equal(directEndpoint({ provider: 'openai', label: 'OpenAI', apiKey: 'k', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5' }).ok, true);
  assert.equal(directEndpoint({ provider: 'ollama', label: 'Ollama', apiKey: '', baseUrl: 'http://127.0.0.1:11434', model: 'llama3.1' }).ok, true);
  assert.match(directEndpoint({ provider: 'openai', label: 'OpenAI', apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5' }).reason, /API key is missing/);
  assert.match(directEndpoint({ provider: 'bedrock', label: 'Amazon Bedrock', apiKey: '', model: 'x' }).reason, /unavailable with Amazon Bedrock/);
  assert.match(directEndpoint({ provider: 'autohandai', label: 'Autohand AI', apiKey: '', model: 'auto' }, { autohandBaseUrl: 'https://inference.autohand.ai/v1' }).reason, /API key/);
  assert.equal(directEndpoint({ provider: 'autohandai', label: 'Autohand AI', apiKey: 'k', model: 'auto' }, { autohandBaseUrl: 'https://inference.autohand.ai/v1' }).endpoint.url, 'https://inference.autohand.ai/v1/chat/completions');
  assert.deepEqual(parsePickAnswer('Sure: {"choice":"noah","probability":0.8}'), { choice: 'noah', probability: 0.8 });
  assert.equal(parsePickAnswer('no json here'), null);
});

// --- Fake OpenAI-compatible endpoint ---------------------------------------
const fake = { behaviour: 'member', requests: 0, bodies: [], pending: new Set() };
const fakeServer = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    fake.requests += 1;
    try { fake.bodies.push(JSON.parse(raw)); } catch { fake.bodies.push({ raw }); }
    const reply = content => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] })); };
    if (req.url !== '/v1/chat/completions' || req.headers.authorization !== 'Bearer fake-key') { res.writeHead(401); res.end('{}'); return; }
    switch (fake.behaviour) {
      case 'member': return reply('{"choice":"noah","probability":0.8}');
      case 'several': return reply('{"choice":"several","probability":0.9}');
      case 'low': return reply('{"choice":"noah","probability":0.4}');
      case 'junk': return reply('I would pick Noah, probably.');
      case 'error': res.writeHead(500); return res.end('{}');
      case 'hang': fake.pending.add(res); return;
      default: return reply('{}');
    }
  });
});
await new Promise(resolve => fakeServer.listen(0, '127.0.0.1', resolve));
const fakeOrigin = `http://127.0.0.1:${fakeServer.address().port}`;

// --- Real bridge, isolated state, controlled SDK output ----------------------
const bridge = await startBridge({ prepare: async directory => {
  const entry = join(directory, 'fixture-sdk.mjs');
  await mkdir(join(directory, 'workspace'));
  await writeFile(entry, `
export class AutohandSDK {
 constructor(options) { this.options = options; this.member = options.envVars.AUTOHAND_CLIENT_NAME.replace('autohand-squad-', ''); }
 async start() {}
 async *streamPrompt({ message }) {
  const action = message.match(/REQUEST:(.*)/)?.[1];
  yield { type: 'message_end', content: action ? 'Organising work.\\nSQUAD_ACTION: ' + action : 'Purpose received by ' + this.member + '.' };
 }
 async interrupt() {}
 async close() {}
}
`);
  return { AUTOHAND_AGENT_SDK_ENTRY: entry, AUTOHAND_AGENT_SDK_DIR: directory };
} });
const counts = [];
const record = (scenario, before) => counts.push({ scenario, requests: fake.requests - before });
const pick = (channelId, message, extra = {}) => bridge.api(`/api/channels/${channelId}/responders/pick`, 'POST', { message, members, ...extra });
try {
  await bridge.api('/api/provider-settings', 'POST', { defaultProvider: 'openai', providers: { openai: { enabled: true, apiKey: 'fake-key', baseUrl: `${fakeOrigin}/v1`, model: 'gpt-fake' } } });
  await check('each responder mode saves through the channel edit route and reads back after restart', async () => {
    const created = await bridge.api('/api/channels', 'POST', { id: 'rules', name: 'rules', memberIds: roster });
    assert.equal(created.status, 201);
    assert.deepEqual(created.data.responder, { mode: 'everyone', leadMemberId: '' }, 'a new channel answers like today');
    for (const responder of [{ mode: 'lead', leadMemberId: 'iris' }, { mode: 'auto', leadMemberId: 'noah' }, { mode: 'auto', leadMemberId: '' }, { mode: 'everyone', leadMemberId: '' }]) {
      const saved = await bridge.api('/api/channels/rules', 'PATCH', { responder });
      assert.equal(saved.success, true, saved.error);
      assert.deepEqual(saved.data.responder, responder);
      await bridge.restart();
      const read = (await bridge.api('/api/channels')).data.channels.find(channel => channel.id === 'rules');
      assert.deepEqual(read.responder, responder, `${responder.mode} survives restart`);
    }
    const unchanged = await bridge.api('/api/channels/rules', 'PATCH', { name: 'rules-renamed' });
    assert.deepEqual(unchanged.data.responder, { mode: 'everyone', leadMemberId: '' }, 'editing other fields keeps the responder');
    const mirrored = await bridge.api('/api/channels', 'PUT', { ...(await bridge.api('/api/channels')).data });
    assert.equal(mirrored.status, 200, mirrored.error);
  });
  await check('a lead must be on the roster to be chosen', async () => {
    const missing = await bridge.api('/api/channels/rules', 'PATCH', { responder: { mode: 'lead', leadMemberId: '' } });
    assert.equal(missing.status, 400); assert.match(missing.error, /Choose a lead/);
    const stranger = await bridge.api('/api/channels/rules', 'PATCH', { responder: { mode: 'lead', leadMemberId: 'ghost' } });
    assert.equal(stranger.status, 400); assert.match(stranger.error, /member of this channel/);
  });
  await check('a lead removed from the roster falls back to everyone and is reported as missing', async () => {
    assert.equal((await bridge.api('/api/channels/rules', 'PATCH', { responder: { mode: 'lead', leadMemberId: 'iris' } })).success, true);
    await bridge.api('/api/channels/rules/members', 'POST', { remove: ['iris'] });
    await bridge.restart();
    const saved = (await bridge.api('/api/channels')).data.channels.find(channel => channel.id === 'rules');
    assert.deepEqual(saved.responder, { mode: 'lead', leadMemberId: 'iris' }, 'the saved lead is kept so the row can explain');
    assert.equal(responderStatus(saved).leadMissing, true);
    const before = fake.requests;
    const decision = await pick('rules', 'who owns the release notes?');
    assert.equal(decision.status, 200, decision.error);
    assert.equal(decision.data.rule, 'everyone'); assert.deepEqual(decision.data.memberIds, ['noah', 'eva']);
    assert.equal(decision.data.status.leadMissing, true);
    assert.equal(fake.requests, before, 'lead mode never calls the picker');
    record('lead mode, lead missing (no pick)', before);
    await bridge.api('/api/channels/rules/members', 'POST', { add: ['iris'] });
  });
  await check('lead mode routes un-mentioned messages to the lead and mentions to the named member', async () => {
    const before = fake.requests;
    const lead = await pick('rules', 'who owns the release notes?');
    assert.deepEqual(lead.data.memberIds, ['iris']); assert.equal(lead.data.rule, 'lead');
    assert.deepEqual(lead.data.responder, { mode: 'lead', rule: 'lead', memberId: 'iris' });
    const mentioned = await pick('rules', '@noah can you take this one');
    assert.deepEqual(mentioned.data.memberIds, ['noah']); assert.equal(mentioned.data.rule, 'mentions');
    const here = await pick('rules', '@here standup in five');
    assert.equal(here.data.rule, 'here'); assert.equal(here.data.memberIds.length, 3);
    assert.equal(fake.requests, before);
    record('lead mode: lead, @mention, @here (3 messages)', before);
  });
  await check('auto mode asks the provider once per un-mentioned message and never for mentions', async () => {
    assert.equal((await bridge.api('/api/channels/rules', 'PATCH', { responder: { mode: 'auto', leadMemberId: 'iris' } })).success, true);
    await bridge.api('/api/channels/sync', 'PUT', { messages: [{ id: 'm1', channelId: 'rules', role: 'user', body: 'The deploy script fails on arm64 builds', createdAt: new Date().toISOString() }] });
    assert.equal((await bridge.api('/api/responders/availability')).data.available, true);
    let before = fake.requests;
    fake.behaviour = 'member';
    const member = await pick('rules', 'can someone fix the arm64 build?');
    assert.equal(member.status, 200, member.error);
    assert.deepEqual(member.data.memberIds, ['noah']); assert.equal(member.data.rule, 'auto');
    assert.equal(member.data.responder.probability, 0.8); assert.equal(member.data.responder.memberId, 'noah');
    assert.equal(member.data.requests, 1); assert.equal(fake.requests, before + 1);
    record('auto: one member at 0.8', before);
    const sent = fake.bodies.at(-1);
    assert.equal(sent.model, 'gpt-fake'); assert.equal(sent.max_tokens, 80); assert.equal(sent.temperature, 0);
    assert.match(sent.messages[1].content, /Noah Reed, Backend engineer/); assert.match(sent.messages[1].content, /several/);
    assert.match(sent.messages[1].content, /arm64 builds/, 'the last lines are in the prompt');
    before = fake.requests; fake.behaviour = 'several';
    const several = await pick('rules', 'can someone fix the arm64 build?');
    assert.equal(several.data.rule, 'auto-everyone'); assert.deepEqual([...several.data.memberIds].sort(), [...roster].sort());
    assert.equal(fake.requests, before + 1); record('auto: "several" at 0.9', before);
    before = fake.requests; fake.behaviour = 'low';
    const low = await pick('rules', 'can someone fix the arm64 build?');
    assert.equal(low.data.rule, 'auto-fallback'); assert.deepEqual(low.data.memberIds, ['iris']); assert.equal(low.data.responder.reason, 'low confidence');
    assert.equal(fake.requests, before + 1); record('auto: 0.4, falls back to the lead', before);
    assert.equal((await bridge.api('/api/channels/rules', 'PATCH', { responder: { mode: 'auto', leadMemberId: '' } })).success, true);
    before = fake.requests;
    const lowNoLead = await pick('rules', 'can someone fix the arm64 build?');
    assert.equal(lowNoLead.data.rule, 'auto-fallback'); assert.deepEqual([...lowNoLead.data.memberIds].sort(), [...roster].sort());
    assert.equal(fake.requests, before + 1); record('auto: 0.4, no lead, falls back to everyone', before);
    before = fake.requests; fake.behaviour = 'junk';
    const junk = await pick('rules', 'can someone fix the arm64 build?');
    assert.equal(junk.data.rule, 'auto-fallback'); assert.equal(junk.data.responder.reason, 'invalid answer');
    record('auto: non-JSON answer', before);
    before = fake.requests; fake.behaviour = 'error';
    const failed = await pick('rules', 'can someone fix the arm64 build?');
    assert.equal(failed.data.rule, 'auto-fallback'); assert.equal(failed.data.responder.reason, 'http 500');
    record('auto: HTTP 500', before);
    before = fake.requests; fake.behaviour = 'member';
    const mentioned = await pick('rules', '@iris can you take this one');
    assert.deepEqual(mentioned.data.memberIds, ['iris']); assert.equal(mentioned.data.requests, 0);
    const here = await pick('rules', '@here standup');
    assert.equal(here.data.rule, 'here');
    assert.equal(fake.requests, before, 'mentioned messages never reach the picker');
    record('auto: @mention and @here (2 messages)', before);
    const nothing = await pick('rules', '');
    assert.equal(nothing.status, 400);
    assert.equal((await pick('missing', 'hello')).status, 404);
  });
  await check('a slow provider times out at 3 s and falls back', async () => {
    assert.equal((await bridge.api('/api/channels/rules', 'PATCH', { responder: { mode: 'auto', leadMemberId: 'iris' } })).success, true);
    const before = fake.requests; fake.behaviour = 'hang';
    const startedAt = Date.now();
    const slow = await pick('rules', 'can someone fix the arm64 build?');
    const elapsed = Date.now() - startedAt;
    assert.equal(slow.status, 200, slow.error);
    assert.equal(slow.data.rule, 'auto-fallback'); assert.deepEqual(slow.data.memberIds, ['iris']);
    assert.match(slow.data.responder.reason, /timeout after 3000 ms/);
    assert.ok(elapsed >= 2900 && elapsed < 6000, `fell back after ${elapsed} ms`);
    assert.equal(fake.requests, before + 1); record(`auto: timeout (${elapsed} ms)`, before);
    for (const res of fake.pending) { res.writeHead(200); res.end('{}'); } fake.pending.clear();
    fake.behaviour = 'member';
  });
  await check('a provider the bridge cannot call directly reports Auto unavailable and falls back without a request', async () => {
    await bridge.api('/api/provider-settings', 'POST', { defaultProvider: 'bedrock', providers: { bedrock: { enabled: true, model: 'anthropic.claude', region: 'us-east-1' } } });
    const availability = await bridge.api('/api/responders/availability');
    assert.equal(availability.data.available, false); assert.match(availability.data.reason, /Auto is unavailable with Amazon Bedrock/);
    const before = fake.requests;
    const decision = await pick('rules', 'can someone fix the arm64 build?');
    assert.equal(decision.data.available, false); assert.equal(decision.data.rule, 'auto-fallback');
    assert.deepEqual(decision.data.memberIds, ['iris']); assert.match(decision.data.responder.reason, /Amazon Bedrock/);
    assert.equal(decision.data.status.effectiveMode, 'lead'); assert.match(decision.data.status.autoUnavailable, /Amazon Bedrock/);
    assert.equal(fake.requests, before); record('auto: Bedrock (no direct call)', before);
    await bridge.api('/api/provider-settings', 'POST', { defaultProvider: 'autohandai' });
    const account = await bridge.api('/api/responders/availability');
    assert.equal(account.data.available, false); assert.match(account.data.reason, /API key/, 'account-only Autohand AI is not callable directly');
    await bridge.api('/api/provider-settings', 'POST', { defaultProvider: 'openai', providers: { openai: { enabled: true, apiKey: '', baseUrl: `${fakeOrigin}/v1`, model: 'gpt-fake' } } });
    assert.equal((await bridge.api('/api/responders/availability')).data.available, true, 'an empty key patch keeps the saved key');
  });
  await check('bridge-side purpose dispatch applies the same rule: mentions pick the recipients, otherwise everyone', async () => {
    const workspace = process.cwd();
    const member = id => ({ id, name: id, role: 'Engineer', projects: [{ path: workspace }], permissions: { builtInPolicies: { squad_create_channel: 'allow' } }, harness: { id: 'autohand' } });
    const actor = member('asq_lead'); const peer = member('asq_peer');
    const launch = (requestId, action) => ({ agentId: actor.id, agent: actor, squadMembers: [actor, peer], requestId, workspace, profile: 'Use the assigned workspace.', prompt: 'REQUEST:' + JSON.stringify(action) });
    const state = async () => (await bridge.api('/api/channels')).data;
    const before = fake.requests;
    const mentioned = await bridge.api('/api/chat', 'POST', launch('purpose-mentioned', { type: 'create_channel', name: 'mentioned-purpose', members: [peer.name], purpose: 'Please @asq_peer inspect the saved workspace.' }));
    assert.equal(mentioned.success, true, JSON.stringify(mentioned));
    assert.equal(mentioned.data.channelActions?.[0]?.status, 'created');
    const record1 = await until(async () => (await state()).agentChannelActions.find(a => a.id === mentioned.data.channelActions[0].id && a.deliveries?.every(d => d.status === 'completed')), 'mentioned purpose delivered');
    assert.deepEqual(record1.deliveries.map(d => d.memberId), [peer.id], 'only the mentioned member answers the purpose');
    assert.equal(record1.recipientRule, 'mentions');
    const root1 = (await state()).messages.find(m => m.id === record1.parentMessageId);
    assert.deepEqual(root1.targetMemberIds, [peer.id]);
    const everyone = await bridge.api('/api/chat', 'POST', launch('purpose-everyone', { type: 'create_channel', name: 'open-purpose', members: [peer.name], purpose: 'Inspect the saved workspace together.' }));
    assert.equal(everyone.success, true, JSON.stringify(everyone));
    const record2 = await until(async () => (await state()).agentChannelActions.find(a => a.id === everyone.data.channelActions[0].id && a.deliveries?.every(d => d.status === 'completed')), 'open purpose delivered');
    assert.deepEqual(record2.deliveries.map(d => d.memberId).sort(), [actor.id, peer.id].sort(), 'today\'s fan-out is kept');
    assert.equal(record2.recipientRule, 'everyone');
    assert.deepEqual((await state()).channels.find(c => c.id === record2.channelId).responder, { mode: 'everyone', leadMemberId: '' });
    assert.equal(fake.requests, before, 'bridge-side purposes never call the picker');
    record('bridge purposes: @mention and plain (2 purposes)', before);
  });
} finally {
  await bridge.close();
  for (const res of fake.pending) { res.writeHead(200); res.end('{}'); }
  await new Promise(resolve => fakeServer.close(resolve));
}
console.log('\nRequest counts at the fake provider:');
for (const row of counts) console.log(`  ${row.requests}  ${row.scenario}`);
console.log(`  ${fake.requests}  total`);
if (failures.length) { console.error(JSON.stringify(failures, null, 2)); process.exitCode = 1; }
else console.log('Responder checks passed (real local backend, fake OpenAI-compatible endpoint; no provider execution).');
