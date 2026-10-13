import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

// Controlled model output, real SDK adapter, bridge routes and durable store.
// No fixture token or prompt reaches a provider.
const bridge = await startBridge({ prepare: async directory => {
  const entry = join(directory, 'fixture-sdk.mjs');
  await mkdir(join(directory, 'workspace'));
  await writeFile(entry, `
import { appendFileSync, existsSync } from 'node:fs';
const calls = ${JSON.stringify(join(directory, 'calls.jsonl'))};
export class AutohandSDK {
 constructor(options) { this.options = options; this.member = options.envVars.AUTOHAND_CLIENT_NAME.replace('autohand-squad-', ''); }
 async start() {}
 async *streamPrompt({ message }) {
  appendFileSync(calls, JSON.stringify({ member: this.member, message, cwd: this.options.cwd, profile: this.options.appendSystemPrompt }) + '\\n');
  if (message.includes('WAIT_FOR_RELEASE')) while (!existsSync(${JSON.stringify(join(directory, 'release'))})) await new Promise(resolve => setTimeout(resolve, 20));
  const action = message.match(/REQUEST:(.*)/)?.[1];
  yield { type: 'message_end', content: action ? 'Organising work.\\nSQUAD_ACTION: ' + action : 'Purpose received by ' + this.member + '.' };
 }
 async interrupt() {}
 async close() {}
}
`);
  return { AUTOHAND_AGENT_SDK_ENTRY: entry, AUTOHAND_AGENT_SDK_DIR: directory };
} });
const workspace = process.cwd();
const member = (id, policy = 'ask') => ({ id, name: id, role: 'Engineer', projects: [{ path: workspace }], permissions: { builtInPolicies: { squad_create_channel: policy } }, harness: { id: 'autohand' } });
const peer = member('asq_peer', 'allow');
const action = (name, extra = {}) => ({ type: 'create_channel', name, members: [peer.name], purpose: 'Inspect the saved workspace together.', ...extra });
const launch = (actor, requestId, command, extra = {}) => ({ agentId: actor.id, agent: actor, squadMembers: [actor, peer], requestId, workspace, profile: 'Use the assigned workspace and permissions.', prompt: 'REQUEST:' + JSON.stringify(command), ...extra });
const calls = async () => (await readFile(join(bridge.directory, 'calls.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const state = async () => (await bridge.api('/api/channels')).data;
let checks = 0;
let browser;
let gateway;
const checked = label => { checks++; console.log('PASS ' + label); };
try {
  const ask = member('asq_ask');
  const proposed = await bridge.api('/api/chat', 'POST', launch(ask, 'ask-request', action('approval-work')));
  assert.equal(proposed.success, true, JSON.stringify(proposed));
  assert.equal(proposed.data.channelActions?.[0]?.status, 'proposed', 'ask permission must produce a reviewable proposal through actual chat execution');
  assert.ok(!proposed.data.reply.includes('SQUAD_ACTION:'), 'private action is replaced by an honest result');
  assert.ok(!(await state()).channels.some(c => c.name === 'approval-work'));
  const proposalId = proposed.data.channelActions[0].id;
  await bridge.restart();
  assert.ok((await bridge.api('/api/channel-actions')).data.some(a => a.id === proposalId && a.status === 'proposed'));
  const approvals = await Promise.all(Array.from({ length: 5 }, () => bridge.api('/api/channel-actions/' + proposalId + '/approve', 'POST', {})));
  assert.ok(approvals.every(r => r.success), JSON.stringify(approvals));
  await until(async () => (await state()).agentChannelActions.find(a => a.id === proposalId)?.deliveries?.every(d => d.status === 'completed'), 'approved purpose delivered');
  const approved = (await state()).channels.find(c => c.name === 'approval-work');
  assert.deepEqual(approved.memberIds.sort(), [ask.id, peer.id].sort());
  assert.equal(approved.creatorId, ask.id); assert.equal(approved.visibility, 'public');
  assert.equal(approved.projects[0].path, workspace);
  assert.equal((await state()).messages.filter(m => m.channelId === approved.id && m.role === 'user').length, 1);
  assert.equal((await state()).messages.find(m => m.channelId === approved.id && m.role === 'user').agentId, ask.id, 'Purpose root must keep the actual member identity.');
  assert.equal((await calls()).filter(c => c.message.includes('Inspect the saved workspace together.') && !c.message.includes('REQUEST:')).length, 2);
  const oldPurposeState = await state();
  delete oldPurposeState.messages.find(message => message.channelId === approved.id && message.role === 'user').agentId;
  await writeFile(join(bridge.directory, 'squad', 'channels.json'), JSON.stringify(oldPurposeState));
  await bridge.restart();
  assert.equal((await state()).messages.find(message => message.channelId === approved.id && message.role === 'user').agentId, ask.id, 'Older purpose roots recover identity from their existing receipt.');
  assert.equal((await calls()).filter(c => c.message.includes('Inspect the saved workspace together.') && !c.message.includes('REQUEST:')).length, 2, 'Attribution recovery may not replay completed purpose work.');
  checked('ask proposal survives restart; concurrent approvals create once and execute purpose once per member');

  const allow = member('asq_allow', 'allow');
  const allowed = await bridge.api('/api/chat', 'POST', launch(allow, 'allow-request', action('allowed-work')));
  assert.equal(allowed.data.channelActions[0].status, 'created', JSON.stringify(allowed));
  await until(async () => (await state()).agentChannelActions.find(a => a.id === allowed.data.channelActions[0].id)?.deliveries?.every(d => d.status === 'completed'), 'allowed purpose delivered');
  const replay = await bridge.api('/api/chat', 'POST', launch(allow, 'allow-request', action('allowed-work')));
  assert.equal(replay.data.channelActions[0].id, allowed.data.channelActions[0].id);
  assert.equal((await state()).channels.filter(c => c.name === 'allowed-work').length, 1);
  assert.equal((await state()).messages.filter(m => m.channelId === allowed.data.channelActions[0].channelId && m.role === 'user').length, 1);
  checked('allow creates from trusted actor with durable retry deduplication');

  const blocked = await bridge.api('/api/chat', 'POST', launch(member('asq_block', 'block'), 'block-request', action('blocked-work')));
  assert.equal(blocked.data.channelActions[0].status, 'blocked');
  assert.ok(!(await state()).channels.some(c => c.name === 'blocked-work'));
  const forged = await bridge.api('/api/chat', 'POST', launch(allow, 'forged-request', action('forged-work', { actorId: ask.id, permission: 'allow' })));
  assert.equal(forged.data.channelActions[0].status, 'failed');
  const missing = await bridge.api('/api/chat', 'POST', launch(allow, 'missing-request', action('missing-work', { members: ['unknown-member'] })));
  assert.equal(missing.data.channelActions[0].status, 'failed');
  const escaped = await bridge.api('/api/chat', 'POST', launch(allow, 'workspace-request', action('escaped-work'), { workspace: dirname(process.cwd()) }));
  assert.equal(escaped.data.channelActions[0].status, 'failed');
  checked('block, forged action identity, unknown named member and undeclared workspace fail visibly');

  const hold = bridge.api('/api/chat', 'POST', launch(allow, 'revocation-request', action('revoked-work'), { prompt: 'WAIT_FOR_RELEASE\nREQUEST:' + JSON.stringify(action('revoked-work')) }));
  await until(async () => (await calls()).some(c => c.member === allow.id && c.message.includes('WAIT_FOR_RELEASE')), 'in-flight actor');
  assert.equal((await bridge.api('/api/members/' + allow.id + '/channel-access', 'PUT', { agent: member(allow.id, 'block') })).success, true);
  await writeFile(join(bridge.directory, 'release'), 'release');
  assert.equal((await hold).data.channelActions[0].status, 'blocked');
  assert.ok(!(await state()).channels.some(c => c.name === 'revoked-work'));
  checked('permission revocation is checked at commit, even with stale launch permissions');

  const pending = await bridge.api('/api/chat', 'POST', launch(ask, 'break-request', action('break-work')));
  await bridge.api('/api/members/' + ask.id + '/break', 'POST', { active: true });
  const refused = await bridge.api('/api/channel-actions/' + pending.data.channelActions[0].id + '/approve', 'POST', {});
  assert.equal(refused.status, 409); assert.ok(!(await state()).channels.some(c => c.name === 'break-work'));
  await bridge.api('/api/members/' + ask.id + '/break', 'POST', { active: false });
  const declined = await bridge.api('/api/channel-actions/' + pending.data.channelActions[0].id + '/decline', 'POST', {});
  assert.equal(declined.data.status, 'rejected');
  assert.equal((await bridge.api('/api/channel-actions/' + pending.data.channelActions[0].id + '/approve', 'POST', {})).status, 409);
  checked('break refusal and declined proposals cannot create a channel');

  // Old full snapshots may omit or fabricate action metadata; neither is authority.
  const before = await state();
  const mirrored = await bridge.api('/api/channels', 'PUT', { channels: before.channels, threads: before.threads, messages: before.messages, agentChannelActions: [], agentChannelAccess: {} });
  assert.equal(mirrored.success, true);
  assert.equal((await state()).agentChannelActions.length, before.agentChannelActions.length);
  await bridge.restart();
  assert.equal((await state()).agentChannelActions.length, before.agentChannelActions.length);
  checked('legacy snapshots and restarts preserve bridge-owned action receipts and permission authority');

  const streamingMember = member('asq_stream', 'allow');
  const source = (await bridge.api('/api/channels', 'POST', { name: 'source-work', memberIds: [streamingMember.id] })).data;
  const response = await fetch(bridge.origin + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(launch(streamingMember, 'stream-request', action('stream-work', { purpose: '' }), { channel: { ...source, threadId: 'source-thread', parentMessageId: 'source-root' } })) });
  assert.equal(response.status, 200);
  const sse = await response.text();
  const done = JSON.parse(sse.split('\n\n').find(block => block.startsWith('event: done\n')).split('\ndata: ')[1]);
  assert.equal(done.channelActions[0].status, 'created');
  assert.ok(!done.reply.includes('SQUAD_ACTION:'));
  assert.equal((sse.match(/event: done\n/g) || []).length, 1);
  checked('channel streaming uses the same permission path and returns one final receipt');

  const expired = await bridge.api('/api/chat', 'POST', launch(ask, 'expired-request', action('expired-work')));
  const saved = await state();
  saved.agentChannelActions.find(a => a.id === expired.data.channelActions[0].id).expiresAt = '2000-01-01T00:00:00Z';
  await writeFile(saved.path, JSON.stringify(saved));
  assert.equal((await bridge.api('/api/channel-actions/' + expired.data.channelActions[0].id + '/approve', 'POST', {})).status, 409);
  await bridge.api('/api/channel-actions/' + expired.data.channelActions[0].id + '/decline', 'POST', {});
  await bridge.api('/api/channels/' + allowed.data.channelActions[0].channelId, 'DELETE');
  const deletedReplay = await bridge.api('/api/chat', 'POST', launch(allow, 'allow-request', action('allowed-work')));
  assert.equal(deletedReplay.data.channelActions[0].status, 'failed');
  assert.ok(!(await state()).channels.some(c => c.name === 'allowed-work'));
  await bridge.api('/api/members/' + streamingMember.id + '/channel-access', 'PUT', { removed: true });
  const removed = await bridge.api('/api/chat', 'POST', launch(streamingMember, 'removed-request', action('removed-work')));
  assert.equal(removed.data.channelActions[0].status, 'failed');
  assert.ok(!(await state()).channels.some(c => c.name === 'removed-work'));
  checked('expired proposals, removed members and deleted-channel retries cannot create or revive channels');

  const interrupted = await state();
  const delivery = interrupted.agentChannelActions.find(a => a.id === proposalId).deliveries[0];
  delivery.status = 'running';
  interrupted.messages = interrupted.messages.filter(m => m.id !== delivery.id);
  const callCount = (await calls()).length;
  await writeFile(interrupted.path, JSON.stringify(interrupted));
  await bridge.restart();
  const recovered = await state();
  assert.equal(recovered.agentChannelActions.find(a => a.id === proposalId).deliveries[0].status, 'interrupted');
  assert.equal(recovered.messages.find(m => m.id === delivery.id).status, 'error');
  assert.equal((await calls()).length, callCount, 'an interrupted purpose is not replayed automatically');
  const intact = await readFile(recovered.path, 'utf8');
  await writeFile(recovered.path, '{broken');
  const damaged = await bridge.api('/api/chat', 'POST', launch(ask, 'corrupt-request', action('corrupt-work')));
  assert.equal(damaged.success, false);
  assert.equal(await readFile(recovered.path, 'utf8'), '{broken');
  await writeFile(recovered.path, intact);
  checked('interrupted delivery is visible without automatic replay; damaged persistence fails closed');

  gateway = await startBridge();
  const token = (await bridge.api('/api/remote/tokens', 'POST', { label: 'Reliability gateway' })).data;
  const configured = await gateway.api('/api/remote/members/' + streamingMember.id, 'PUT', { url: bridge.origin, token: token.token, label: 'Owner bridge' });
  assert.equal(configured.success, true, JSON.stringify(configured));
  const remoteAccess = await gateway.api('/api/members/' + streamingMember.id + '/channel-access', 'PUT', { agent: member(streamingMember.id, 'block') });
  assert.equal(remoteAccess.success, true, JSON.stringify(remoteAccess));
  assert.equal((await state()).agentChannelAccess[streamingMember.id].mode, 'block');
  assert.equal((await gateway.api('/api/channels')).data.agentChannelAccess[streamingMember.id], undefined);
  await bridge.api('/api/remote/tokens/' + token.id, 'DELETE');
  const revokedRemote = await gateway.api('/api/members/' + streamingMember.id + '/channel-access', 'PUT', { agent: streamingMember });
  assert.equal(revokedRemote.success, false);
  assert.equal((await state()).agentChannelAccess[streamingMember.id].mode, 'block');
  await gateway.close(); gateway = null;
  checked('remote settings save on the owning bridge; revoked proxy credentials cannot report a grant');

  if (process.argv.includes('--browser')) {
    const visible = await bridge.api('/api/chat', 'POST', launch(ask, 'browser-request', action('browser-proposal')));
    browser = await startBrowser();
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `if (!localStorage.getItem('reliability.seeded')) { localStorage.setItem('autohandSquad.v1.onboarding', JSON.stringify({version:1,status:'skipped'})); localStorage.setItem('autohandSquad.v1.agents', JSON.stringify(${JSON.stringify([ask, peer])})); localStorage.setItem('reliability.seeded','true'); }` });
    await browser.navigate(bridge.origin + '/squad');
    await until(() => browser.evaluate(`document.querySelector('section[aria-label="Channel proposals"]')?.textContent.includes('browser-proposal')`), 'persisted channel approval UI');
    // Current block takes effect even while the approval remains on screen.
    await bridge.api('/api/members/' + ask.id + '/channel-access', 'PUT', { agent: member(ask.id, 'block') });
    await browser.click('Approve channel');
    await until(() => browser.evaluate(`document.querySelector('section[aria-label="Channel proposals"] [role="alert"]')?.textContent.includes('blocked')`), 'approval revocation error');
    await browser.screenshot('.codex-artifacts/reliability/agent-channel-proposal.png');
    assert.ok(!(await state()).channels.some(c => c.name === 'browser-proposal'));
    await bridge.api('/api/members/' + ask.id + '/channel-access', 'PUT', { agent: ask });
    await browser.click('Approve channel');
    await until(() => browser.evaluate(`!document.querySelector('section[aria-label="Channel proposals"]')`), 'confirmed UI approval');
    const channelId = (await state()).agentChannelActions.find(a => a.id === visible.data.channelActions[0].id).channelId;
    await browser.navigate(bridge.origin + '/channels/' + channelId);
    await until(() => browser.evaluate(`document.querySelector('main h1')?.textContent.includes('browser-proposal')`), 'open approved channel');
    await until(() => browser.evaluate(`document.querySelector('main article')?.textContent.includes('opened this channel')`), 'purpose root rendered');
    assert.equal(await browser.evaluate(`document.querySelector('main article .font-semibold')?.textContent`), ask.name, 'Agent purpose must render under its author rather than the account holder.');
    await browser.screenshot('.codex-artifacts/reliability/agent-channel-approved.png');
    assert.deepEqual(browser.errors, []);
    checked('rendered persisted approval shows revoked permission, retries and opens the saved channel');
  }
  console.log(`${checks} agent channel action checks passed (controlled SDK; no live provider proof).`);
} catch (error) { console.error(bridge.logs.slice(-6000)); throw error; }
finally { await browser?.close(); await gateway?.close(); await bridge.close(); }
