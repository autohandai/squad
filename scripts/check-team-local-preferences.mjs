import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOwnershipBroker } from '../server/ownership/broker.mjs';
import { createIdentityService, ownerKey } from '../server/ownership/identity.mjs';
import { ensureDataset } from '../server/ownership/datasets.mjs';
import { writePersistentJson } from '../server/persistent-json.mjs';
import { until } from './lib/reliability-browser.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-team-notifications-'));
const serviceRoot = join(directory, 'squad'), configPath = join(directory, 'config.json');
const provider = createServer((req, res) => {
  const person = req.headers.authorization === 'Bearer fixture-bob' ? 'bob' : 'alice';
  const data = req.url === '/v1/profile'
    ? { success: true, profile: { id: person, email: `${person}@example.test`, name: person, status: 'active' } }
    : { success: true, accounts: [{ account: { id: 'shared-team', name: 'Shared team', type: 'team', accessMode: 'full' }, role: 'owner', permissions: ['resources:operate'] }] };
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data));
});
await new Promise(ready => provider.listen(0, '127.0.0.1', ready));
const issuer = `http://127.0.0.1:${provider.address().port}`, owner = { issuer, kind: 'team', id: 'shared-team' };
let broker;
process.env.AUTOHAND_SQUAD_NATIVE_NOTIFICATIONS = 'macos'; // Fixture must never send OS banners.
process.env.AUTOHAND_SQUAD_COMPUTER_USE = 'bundled';
process.env.AUTOHAND_SQUAD_COMPUTER_USE_RUNTIME_DIR = directory; // No native engine or OS probes.
try {
  const paths = await ensureDataset(serviceRoot, ownerKey(owner));
  const oldPath = join(paths.dataRoot, 'notifications.json');
  await writePersistentJson(oldPath, { version: 1, settings: { channelDefault: 'muted' }, items: [{ id: 'old-team-feed', at: new Date().toISOString(), title: 'Earlier team notification' }] });
  const oldBytes = await readFile(oldPath, 'utf8');
  const oldGrantsPath = join(paths.dataRoot, 'computer-use-grants.json');
  await writePersistentJson(oldGrantsPath, {version:1,members:{eva:{scope:'control'}}});
  const oldGrantBytes = await readFile(oldGrantsPath, 'utf8');
  const nativeFixtureKey = 'd'.repeat(64);
  await writeFile(join(serviceRoot, 'native-grant-token'), nativeFixtureKey, {mode:0o600});
  await writePersistentJson(configPath, { auth: { token: 'fixture-alice' } });
  broker = createOwnershipBroker({ rootDir: process.cwd(), serviceRoot, configPath, identity: createIdentityService({ serviceRoot, configPath, origin: issuer }), port: 0 });
  const origin = await broker.listen();
  let context;
  const request = async (path, method = 'GET', body, extraHeaders = {}) => {
    const response = await fetch(origin + path, { method, headers: { 'content-type': 'application/json', 'x-squad-context': context?.generation || '', ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json(); assert(response.ok && result.success, `${method} ${path}: ${JSON.stringify(result)}`); return result.data;
  };
  async function selectAs(person) {
    await writePersistentJson(configPath, { auth: { token: `fixture-${person}` } });
    await until(async () => { const result = await (await fetch(origin + '/api/ownership/context')).json(); if (result.data.state === 'ready' && result.data.actor?.id === person) { context = result.data; return true; } return false; }, `${person} verified`, 60000);
    context = await request('/api/ownership/select', 'POST', { owner, expectedGeneration: context.generation });
    await until(async () => { const result = await fetch(origin + '/api/notifications/settings', { headers: { 'x-squad-context': context.generation } }); return result.ok; }, `${person} private notification runtime`, 60000);
  }
  await selectAs('alice');
  assert.equal((await request('/api/notifications/settings')).settings.channelDefault, 'mentions', 'unattributed old team preferences are not silently adopted by the first human');
  assert.equal((await request('/api/notifications')).items.length, 0, 'old shared team feed stays outside private feeds');
  const channel = await request('/api/channels', 'POST', { id: 'team-notification-room', name: 'Team room' });
  await request(`/api/notifications/channels/${channel.id}`, 'PATCH', { mode: 'muted', hidden: true });
  await request('/api/notifications/settings', 'PUT', { channelDefault: 'all' });
  await request('/api/members/eva/channel-access', 'PUT', { agent: { id: 'eva', name: 'Eva', role: 'Reviewer' }, profile: '', profilePatch: {} });
  assert.equal((await request('/api/computer-use/status?memberId=eva')).grant.scope, 'none', 'an unattributed old team Computer Use grant is not inherited');
  await request('/api/status/snapshot', 'POST', {members:[{id:'eva',name:'Eva',role:'Reviewer'}],jobs:[]});
  await request('/api/computer-use/grant', 'POST', {memberId:'eva',scope:'observe'}, {'x-squad-native-grant':nativeFixtureKey});
  await request(`/api/channels/${channel.id}/members`, 'POST', { add: ['eva'] });
  const at = new Date().toISOString();
  await request('/api/channels/sync', 'PUT', { messages: { [channel.id]: [{ id: 'alice-post', role: 'agent', agentId: 'eva', body: 'The team review is ready.', status: 'complete', createdAt: at, updatedAt: at }] } });
  // This channel is explicitly muted; use an independent testable lifecycle event
  // for the private feed without unmuting the saved channel override.
  await request('/api/events', 'POST', { name: 'handoff.pending', memberId: 'eva', toMemberId: 'eva', preview: 'Alice private notification receipt' });
  await until(async () => (await request('/api/notifications')).items.length > 0, 'first actor private feed');
  await selectAs('bob');
  const bob = (await request('/api/notifications/settings')).settings;
  assert.equal(bob.channelDefault, 'mentions', 'a second human has their own defaults in the same team dataset');
  assert.equal(bob.channelOverrides[channel.id], undefined, 'a teammate cannot hide or mute this human\'s conversation');
  assert.equal((await request('/api/notifications')).items.length, 0, 'a second actor never inherits the first actor\'s feed');
  assert.equal((await request('/api/computer-use/status?memberId=eva')).grant.scope, 'none', 'a second actor never inherits the first actor\'s Computer Use grant');
  await request('/api/computer-use/grant', 'POST', {memberId:'eva',scope:'control'}, {'x-squad-native-grant':nativeFixtureKey});
  assert((await request('/api/channels')).channels.some(item => item.id === channel.id), 'the saved team conversation is still shared');
  await request('/api/notifications/settings', 'PUT', { channelDefault: 'muted' });
  await selectAs('alice');
  const alice = (await request('/api/notifications/settings')).settings;
  assert.equal(alice.channelDefault, 'all', 'returning to the first verified actor restores only their preference');
  assert.deepEqual(alice.channelOverrides[channel.id], { mode: 'muted', hidden: true });
  assert((await request('/api/notifications')).items.length > 0, 'the first actor\'s feed is retained for their return');
  assert.equal((await request('/api/computer-use/status?memberId=eva')).grant.scope, 'observe', 'returning to the first actor restores only their confirmed observe scope');
  assert.equal(await readFile(oldGrantsPath, 'utf8'), oldGrantBytes, 'the unattributed old team grant file remains untouched');
  assert.equal(await readFile(oldPath, 'utf8'), oldBytes, 'the original team file remains untouched for explicit recovery');
  console.log('PASS: actual broker workers isolate same-team notification preferences/feed and Computer Use grants by verified actor, preserve shared channels and retain unattributed old files.');
} finally { await broker?.close(); await new Promise(done => provider.close(done)); await rm(directory, { recursive: true, force: true }); }
