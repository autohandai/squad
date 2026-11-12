import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { startMobileFixture } from './lib/mobile-fixture.mjs';
import { until } from './lib/reliability-browser.mjs';
import { sealPacket, openPacket } from '../server/mobile/protocol.mjs';
import { createRemoteRegistry } from '../server/remote/registry.mjs';

const { bridge, member } = await startMobileFixture();
try {
  const configured = await bridge.api('/api/mobile/config', 'PUT', { enabled: true, mode: 'local', endpoint: '', port: 0 });
  assert.equal(configured.success, true);
  // Keep the randomly selected fixture port across the host restart below.
  const port = Number(new URL(configured.data.endpoint).port);
  assert.equal((await bridge.api('/api/mobile/config', 'PUT', { enabled: true, mode: 'local', endpoint: '', port })).success, true);
  const created = await bridge.api('/api/mobile/pair', 'POST', {});
  assert.equal(created.success, true, created.error);
  const offer = JSON.parse(Buffer.from(new URL(created.data.link).searchParams.get('data'), 'base64url').toString());
  const endpoint = `http://127.0.0.1:${new URL(offer.endpoint).port}/v1/mobile`;
  const deviceID = randomUUID(), key = randomBytes(32), pairKey = Buffer.from(offer.secret, 'base64');
  async function request(command, parameters = {}, { pair = false, id = randomUUID() } = {}) {
    const secret = pair ? pairKey : key;
    const packet = sealPacket({ issuedAt: Date.now() / 1000, command, parameters }, secret,
      { kind: pair ? 'pair' : 'device', computerID: offer.computerID, peerID: pair ? offer.pairingID : deviceID, requestID: id }, 'request');
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(packet) });
    assert.equal(response.ok, true);
    return openPacket(await response.json(), secret, 'response');
  }
  await request('pair.claim', { deviceID, deviceName: 'Host integration iPhone', deviceKey: key.toString('base64') }, { pair: true });
  const pending = (await bridge.api('/api/mobile/status')).data.pending;
  assert.equal((await bridge.api('/api/mobile/approve', 'POST', { pairingID: offer.pairingID, code: pending.code })).success, true);
  const snapshot = await request('snapshot');
  assert.ok(snapshot.data.capabilities?.includes('delegate'), 'a paired phone must discover actual host delegation support');
  assert.ok(snapshot.data.capabilities.includes('tasks'));
  assert.ok(snapshot.data.account.id && snapshot.data.account.email);
  assert.equal('token' in snapshot.data.account, false);
  const parameters = { memberID: member.id, title: 'Check mobile delegation', detail: 'Use the same persisted task and member queue as Squad MCP.' }, id = randomUUID();
  const assigned = await request('delegate', parameters, { id });
  assert.equal(assigned.ok, true, assigned.error);
  assert.ok(assigned.data.taskID);
  assert.equal(assigned.data.assignee, member.id);
  assert.equal((await request('delegate', parameters, { id })).data.taskID, assigned.data.taskID);
  assert.equal((await request('delegate', { ...parameters, title: 'Different task' }, { id })).ok, false);
  await until(async () => (await request('tasks')).data?.tasks.find(task => task.id === assigned.data.taskID)?.status === 'completed', 'the delegated task completes through the real queue');
  const tasks = (await request('tasks')).data.tasks;
  assert.equal(tasks.filter(task => task.id === assigned.data.taskID).length, 1);
  assert.equal((await bridge.api('/api/work')).data.tasks.find(task => task.id === assigned.data.taskID).status, 'done');
  assert.equal((await request('computer.grant')).ok, false);
  await bridge.restart();
  const retry = await request('delegate', parameters, { id });
  assert.equal(retry.ok, true, retry.error);
  assert.equal(retry.data.taskID, assigned.data.taskID, 'task receipts survive a host restart');
  assert.equal((await bridge.api('/api/work')).data.tasks.length, 1);
  const remotes = createRemoteRegistry({ squadStateDir: bridge.dataRoot });
  await remotes.set(member.id, { url: 'https://another-computer.example.test', token: 'fixture-no-server', label: 'Separate computer', workspace: '/remote/project' });
  assert.equal((await request('snapshot')).data.members.find(row => row.id === member.id).executionMode, 'remoteComputer');
  const refused = await request('message', { memberID: member.id, text: 'Never execute on the wrong computer.' });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /another computer/);
  assert.equal((await request('delegate', { ...parameters, title: 'Never delegate on the wrong computer.' })).ok, false);
  assert.equal((await bridge.api(`/api/queues/${member.id}`)).data.items.length, 1, 'remote-assigned work must not enter the local queue');
  console.log('PASS phone host contract: discover capabilities/account, persist one canonical MCP task, run through the real queue, deduplicate across host restart, refuse OS-grant commands. Offline fixture engine only.');
} finally { await bridge.close(); }
