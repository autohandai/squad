#!/usr/bin/env node
// ADR-0255: the iCloud route. A fake helper process plays Squad iCloud.app
// over the same newline-delimited JSON; the real mobile service answers. No
// Apple Account, no CloudKit, no network. When a built helper exists on this
// Mac (scripts/build-icloud-helper.mjs, unentitled), it is also run for real
// to prove it reports "unentitled" instead of being killed.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createMobileService } from '../server/mobile/service.mjs';
import { sealPacket, openPacket } from '../server/mobile/protocol.mjs';
import { createMobileICloud, resolveICloudHelper, ICLOUD_HELPER_EXECUTABLE } from '../server/mobile/icloud.mjs';
import { migrateSavedConfiguration } from '../server/mobile/controller.mjs';
import { helperEntitlements, helperInfoPlist, helperExists, ICLOUD_HELPER } from './build-icloud-helper.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < deadline, label); await pause(5); }
}

/** A helper process: what the bridge writes, and a way to speak as the helper. */
function fakeHelper() {
  const spawned = [];
  const spawnImpl = (path, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough();
    child.received = [];
    let buffer = '';
    child.stdin.on('data', chunk => { buffer += chunk; let index; while ((index = buffer.indexOf('\n')) >= 0) { child.received.push(JSON.parse(buffer.slice(0, index))); buffer = buffer.slice(index + 1); } });
    child.say = message => child.stdout.write(`${JSON.stringify(message)}\n`);
    child.kill = () => child.emit('exit', 0);
    child.path = path; child.options = options;
    spawned.push(child);
    return child;
  };
  return { spawnImpl, spawned };
}

// 1. Configuration: off by default, and every file saved before it parses.
assert.equal(migrateSavedConfiguration({ enabled: true, local: true, relay: true, tunnel: false, endpoint: '', port: 29323 }).icloud, false, 'a saved 0.1.22 config has iCloud off');
assert.equal(migrateSavedConfiguration({ enabled: true, mode: 'relay', endpoint: '', port: 29323 }).icloud, false, 'a legacy {mode} config has iCloud off');
assert.equal(migrateSavedConfiguration({ enabled: true, local: true, relay: true, tunnel: false, icloud: true, endpoint: '', port: 29323 }).icloud, true);

// 2. Where the helper is looked for.
assert.equal(resolveICloudHelper({ platform: 'linux', exists: () => true }), '', 'never off macOS');
assert.equal(resolveICloudHelper({ platform: 'darwin', env: {}, execPath: '/A/Autohand Squad.app/Contents/MacOS/node', exists: path => path === `/A/Autohand Squad.app/Contents/Helpers/${ICLOUD_HELPER_EXECUTABLE}` }),
  `/A/Autohand Squad.app/Contents/Helpers/${ICLOUD_HELPER_EXECUTABLE}`, 'the nested helper beside the bundled node');
assert.equal(resolveICloudHelper({ platform: 'darwin', env: {}, execPath: '/usr/local/bin/node', exists: () => false }), '', 'a dev checkout has none');
assert.equal(resolveICloudHelper({ platform: 'darwin', env: { AUTOHAND_SQUAD_ICLOUD_HELPER: '/x/helper' }, execPath: '/usr/local/bin/node', exists: path => path === '/x/helper' }), '/x/helper');

// 3. Entitlements come from the profile and never exceed it.
const profile = (overrides = {}) => ({ TeamIdentifier: ['ABCDE12345'], Entitlements: {
  'com.apple.application-identifier': 'ABCDE12345.ai.autohand.squad.icloud', 'com.apple.developer.team-identifier': 'ABCDE12345',
  'com.apple.developer.icloud-container-identifiers': ['iCloud.ai.autohand.squad'], 'com.apple.developer.icloud-services': '*',
  'com.apple.developer.aps-environment': 'production', ...overrides } });
const developerID = helperEntitlements(profile());
assert.equal(developerID['com.apple.developer.icloud-container-environment'], 'Production', 'Developer ID talks to Production');
assert.deepEqual(developerID['com.apple.developer.icloud-container-identifiers'], ['iCloud.ai.autohand.squad']);
assert.equal(developerID['com.apple.developer.aps-environment'], 'production');
assert.equal(helperEntitlements(profile({ 'get-task-allow': true }))['com.apple.developer.icloud-container-environment'], 'Development');
assert.throws(() => helperEntitlements(profile({ 'com.apple.application-identifier': 'ABCDE12345.ai.autohand.squad' })), /not ai\.autohand\.squad\.icloud/, 'the main app\'s profile is refused');
assert.throws(() => helperEntitlements(profile({ 'com.apple.developer.icloud-container-identifiers': ['iCloud.other'] })), /does not include iCloud\.ai\.autohand\.squad/);
assert.throws(() => helperEntitlements(profile({ 'com.apple.developer.icloud-services': ['CloudDocuments'] })), /CloudKit/);
const info = helperInfoPlist('9.9.9');
for (const expected of [`<string>${ICLOUD_HELPER.bundleId}</string>`, '<key>LSUIElement</key><true/>', `<string>${ICLOUD_HELPER.executable}</string>`]) assert.ok(info.includes(expected), expected);

// 4. The route end to end through the real service.
const directory = await mkdtemp(join(tmpdir(), 'squad-mobile-icloud-'));
try {
  const service = await createMobileService({ directory, computerName: 'Fixture Mac', assertCurrent: async () => {}, execute: async (command, parameters) => ({ command, text: parameters.text, at: randomUUID() }) });
  const offer = await service.createOffer('http://127.0.0.1:29323');
  const key = randomBytes(32), deviceID = randomUUID(), pairingKey = Buffer.from(offer.secret, 'base64');
  const seal = (kind, peerID, sealKey, command, parameters = {}, requestID = randomUUID()) => sealPacket({ issuedAt: Date.now() / 1000, command, parameters }, sealKey, { kind, peerID, computerID: offer.computerID, requestID }, 'request');
  await service.packet(seal('pair', offer.pairingID, pairingKey, 'pair.claim', { deviceID, deviceName: 'Fixture iPhone', deviceKey: key.toString('base64') }));
  await service.approve(offer.pairingID, service.status().pending.code);

  const { spawnImpl, spawned } = fakeHelper();
  const icloud = createMobileICloud({ service, helperPath: '/fake/Squad iCloud', spawnImpl, restartDelay: () => 1 });
  assert.equal(icloud.status().connected, false, 'not advertised before the helper says ready');
  icloud.start();
  const helper = spawned[0];
  await until(() => helper.received.length, 'the bridge starts the helper');
  assert.deepEqual(helper.received[0], { op: 'start', computerID: service.computerID });
  assert.deepEqual(helper.options.stdio, ['pipe', 'pipe', 'ignore']);
  helper.say({ op: 'status', state: 'ready', detail: 'iCloud is ready.' });
  await until(() => icloud.status().connected, 'ready is reported');

  const outs = () => helper.received.filter(message => message.op === 'packet.out');
  const requestID = randomUUID(), message = seal('device', deviceID, key, 'message', { text: 'From iCloud' }, requestID);
  helper.say({ op: 'packet.in', id: 'record-1', packet: message, ageMs: 1200 });
  await until(() => outs().length === 1, 'the reply goes back through the helper');
  const reply = outs()[0];
  assert.equal(reply.inReplyTo, 'record-1'); assert.equal(reply.peerID, deviceID);
  const opened = openPacket(reply.packet, key, 'response');
  assert.equal(opened.ok, true); assert.equal(opened.data.text, 'From iCloud');
  assert.equal(service.status().devices[0].lastSeenVia, 'icloud', 'the Mac shows the phone came through iCloud');

  // The same packet read twice (token reset, crash before delete) gets the stored receipt.
  helper.say({ op: 'packet.in', id: 'record-1-again', packet: message });
  await until(() => outs().length === 2, 'a re-read request is answered');
  assert.deepEqual(openPacket(outs()[1].packet, key, 'response'), opened, 'never run twice');

  // An unknown device is refused with the HTTP route's status, not a reply.
  helper.say({ op: 'packet.in', id: 'record-2', packet: seal('device', randomUUID(), randomBytes(32), 'snapshot') });
  await until(() => outs().length === 3, 'a refusal is written back');
  assert.deepEqual({ ...outs()[2] }, { op: 'packet.out', inReplyTo: 'record-2', peerID: outs()[2].peerID, status: 401 });
  // A record that is not a packet at all.
  helper.say({ op: 'packet.in', id: 'record-3', packet: { peerID: 'x', sealed: 1 } });
  await until(() => outs().length === 4, 'garbage is refused');
  assert.equal(outs()[3].status, 400);

  // Measurements for phase 1 come from what was actually observed.
  assert.deepEqual(icloud.measurements().requestAgeMs, { count: 1, p50: 1200, p95: 1200 });
  assert.equal(helper.received.at(-1).op, 'stats');

  // Revoking a phone deletes its records; offers are published on request only.
  icloud.revoke(deviceID);
  icloud.offer({ ...offer, pairingID: 'p-1' });
  icloud.withdrawOffer();
  assert.deepEqual(helper.received.slice(-3).map(item => item.op), ['revoke', 'offer.publish', 'offer.withdraw']);

  // States the person can act on.
  helper.say({ op: 'status', state: 'quotaExceeded', detail: 'Your iCloud storage is full.' });
  await until(() => icloud.status().state === 'quotaExceeded', 'quota is reported');
  assert.equal(icloud.status().connected, false, 'a full iCloud is not advertised to phones');

  // A crash restarts; an unsigned build does not loop.
  helper.kill();
  await until(() => spawned.length === 2, 'a crashed helper is restarted');
  spawned[1].say({ op: 'status', state: 'unentitled', detail: 'This build of Squad is not signed for iCloud.' });
  await until(() => icloud.status().state === 'unentitled', 'unentitled is reported');
  spawned[1].kill();
  await pause(30);
  assert.equal(spawned.length, 2, 'an unentitled helper is not restarted');
  icloud.close();
  assert.equal(icloud.status().state, 'off');

  // No helper at all: nothing is spawned and the state says why.
  const missing = createMobileICloud({ service, helperPath: '', spawnImpl: () => assert.fail('nothing to spawn') });
  missing.start();
  assert.equal(missing.status().available, false);

  // 5. The real helper, if built on this Mac: unentitled, alive, polite.
  if (process.platform === 'darwin' && helperExists()) {
    const real = createMobileICloud({ service, helperPath: join(process.cwd(), 'src-tauri', 'helpers', ICLOUD_HELPER_EXECUTABLE) });
    real.start();
    await until(() => real.status().state !== 'starting', 'the real helper reports a state');
    const state = real.status().state;
    real.close();
    assert.ok(['unentitled', 'ready', 'noAccount', 'starting'].includes(state), `real helper state: ${state}`);
    console.log(`Real helper reported "${state}".`);
  }
  console.log('PASS iCloud route: off by default, packets answered by the real service with receipts and refusals, states reported, helper entitlements bound to its profile.');
} finally { await rm(directory, { recursive: true, force: true }); }
