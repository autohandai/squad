import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { startMobileFixture } from './lib/mobile-fixture.mjs';
import { until } from './lib/reliability-browser.mjs';
import { sealPacket, openPacket } from '../server/mobile/protocol.mjs';
import { createRemoteRegistry } from '../server/remote/registry.mjs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { migrateSavedConfiguration } from '../server/mobile/controller.mjs';
import { join } from 'node:path';
import { primaryRoute, routeKey } from '../src/lib/model-routing.js';

// A saved 0.1 exclusive mode upgrades to independent routes (ADR-0228).
assert.deepEqual(migrateSavedConfiguration({ enabled: true, mode: 'local', endpoint: '', port: 29323 }), { enabled: true, local: true, relay: true, tunnel: false, endpoint: '', port: 29323 }, 'a local pairing gains the relay without a new QR');
assert.deepEqual(migrateSavedConfiguration({ enabled: true, mode: 'relay', endpoint: '', port: 29323 }), { enabled: true, local: true, relay: true, tunnel: false, endpoint: '', port: 29323 }, 'a relay computer listens locally again so phones paired there reconnect');
assert.deepEqual(migrateSavedConfiguration({ enabled: false, mode: 'tunnel', endpoint: 'https://t.example.test', port: 4000 }), { enabled: false, local: false, relay: false, tunnel: true, endpoint: 'https://t.example.test', port: 4000 }, 'a user-operated tunnel stays exactly as chosen');
const current = { enabled: true, local: false, relay: true, tunnel: false, endpoint: '', port: 29323 };
assert.deepEqual(migrateSavedConfiguration(current), current, 'a saved choice of independent routes is kept as is');

const { bridge, member, announcementCalls } = await startMobileFixture({ announcements: [{ id: 'fixture-update', title: 'Fixture update', ctaUrl: 'javascript:alert(1)' }] });
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
  // Routes (ADR-0228): advertised only inside the device's encrypted reply,
  // naming what this computer serves now. The legacy `{mode}` request above
  // asked for exactly one route, so no relay is advertised or started.
  assert.equal(offer.routes, undefined, 'a single-route QR adds no extra routes');
  assert.deepEqual(snapshot.data.routes.map(route => route.kind), ['local']);
  assert.equal(snapshot.data.routes[0].endpoint, offer.endpoint);
  const routesConfig = await bridge.api('/api/mobile/config', 'PUT', { enabled: true, local: true, relay: false, tunnel: true, endpoint: 'https://phone-tunnel.example.test', port });
  assert.equal(routesConfig.success, true, routesConfig.error);
  assert.deepEqual(routesConfig.data.config, { enabled: true, local: true, relay: false, tunnel: true, endpoint: 'https://phone-tunnel.example.test', port });
  assert.deepEqual((await request('snapshot')).data.routes, [{ kind: 'local', endpoint: offer.endpoint }, { kind: 'tunnel', endpoint: 'https://phone-tunnel.example.test' }], 'local and a user-operated tunnel serve at once');
  assert.equal((await bridge.api('/api/mobile/config', 'PUT', { enabled: true, local: false, relay: false, tunnel: false, endpoint: '', port })).success, false, 'connections on need at least one route');
  assert.equal((await bridge.api('/api/mobile/config', 'PUT', { enabled: true, local: true, relay: false, tunnel: false, endpoint: '', port })).success, true);
  // Which engine answers (ADR-0222): the saved primary while healthy; while it
  // cools down, the reason, retry time and the fallback answering instead.
  const engineOf = async () => (await request('snapshot')).data.members.find(row => row.id === member.id).engine;
  assert.deepEqual(await engineOf(), { primary: 'Codex' }, 'a healthy member reports only its primary engine');
  const findState = async directory => { for (const entry of await readdir(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isFile() && entry.name === 'mobile-devices.json') return directory; if (entry.isDirectory() && !['node_modules', '.git'].includes(entry.name)) { const found = await findState(path).catch(() => null); if (found) return found; } } return null; };
  // The phone host keeps devices in <dataset>/state/mobile/<id>; the router's
  // health file lives in <dataset>/state.
  const mobileDir = await findState(bridge.directory); assert.ok(mobileDir, 'phone host state found');
  const stateDir = mobileDir.slice(0, mobileDir.lastIndexOf('/state/') + '/state'.length);
  const until5 = Date.now() + 5 * 60_000;
  await writeFile(join(stateDir, 'model-routing-health.json'), JSON.stringify({ version: 1, members: { [member.id]: { routes: { [routeKey(primaryRoute({ agent: member }))]: { blockedUntil: until5, reason: 'quota' } }, updatedAt: Date.now() } } }));
  let engine = await engineOf();
  assert.equal(engine.primary, 'Codex'); assert.equal(engine.reason, 'quota'); assert.equal(engine.inUse, null, 'no fallback configured: nothing answers instead');
  assert.equal(Date.parse(engine.retryAt), until5);
  const withFallback = await bridge.api(`/api/members/${member.id}/channel-access`, 'PUT', { agent: { ...member, modelRouting: { fallbacks: [{ harness: { id: 'claude', model: '', effort: '' } }], allowAgentChanges: false } }, profile: '', profilePatch: {} });
  assert.equal(withFallback.success, true, withFallback.error);
  engine = await engineOf();
  assert.equal(engine.inUse, 'Claude Code', 'the phone hears which fallback is answering');
  await bridge.api(`/api/members/${member.id}/model-routing/reset`, 'POST', {});
  assert.deepEqual(await engineOf(), { primary: 'Codex' }, 'Switch back returns the phone to the primary');
  const news = await request('announcements', { appVersion: '0.2.0' });
  assert.equal(news.ok, true, news.error);
  assert.equal(news.data.announcements[0].ctaUrl, '', 'phone announcements keep desktop URL sanitization');
  const targeted = new URL(announcementCalls.at(-1).url, 'http://fixture.test');
  assert.equal(targeted.searchParams.get('platform'), 'ios');
  assert.equal(targeted.searchParams.get('appVersion'), '0.2.0');
  assert.equal((await request('announcement.act', { id: 'fixture-update', action: 'seen', step: 2 })).data.ok, true);
  assert.equal(JSON.parse(announcementCalls.at(-1).body).lastStep, 2);
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
  // An installed 0.1 file with an exclusive mode is migrated on start and
  // rewritten; paired phones keep working (tunnel listens on loopback).
  await writeFile(join(mobileDir, 'config.json'), JSON.stringify({ enabled: true, mode: 'tunnel', endpoint: 'https://phone-tunnel.example.test', port }));
  await bridge.restart();
  const migrated = (await bridge.api('/api/mobile/status')).data;
  assert.deepEqual(migrated.config, { enabled: true, local: false, relay: false, tunnel: true, endpoint: 'https://phone-tunnel.example.test', port });
  assert.equal('mode' in JSON.parse(await readFile(join(mobileDir, 'config.json'), 'utf8')), false, 'the migrated choice is saved');
  assert.deepEqual((await request('snapshot')).data.routes, [{ kind: 'tunnel', endpoint: 'https://phone-tunnel.example.test' }]);
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
  console.log('PASS phone host contract: migrate a 0.1 exclusive mode, serve local + tunnel at once and advertise only live routes in the encrypted snapshot, discover capabilities/account, report the engine answering (primary, cooling reason, fallback in use, switch back), persist one canonical MCP task, run through the real queue, deduplicate across host restart, refuse OS-grant commands. Offline fixture engine only.');
} finally { await bridge.close(); }
