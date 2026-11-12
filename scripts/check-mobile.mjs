import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createMobileService } from '../server/mobile/service.mjs';
import { sealPacket, openPacket } from '../server/mobile/protocol.mjs';
import { QueueStore } from '../server/queues/store.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-mobile-'));
let current = true, executions = 0;
try {
  const queue = new QueueStore({ squadStateDir: directory });
  const queued = { agentId: 'eva', text: 'Hello', workspace: '/fixture', clientRequestId: 'mobile_repeat_one' };
  const original = await queue.enqueue(queued);
  const duplicate = await queue.enqueue(queued);
  assert.equal(duplicate.id, original.id, 'a retried phone message must keep its queue receipt');
  const restarted = new QueueStore({ squadStateDir: directory });
  assert.equal((await restarted.enqueue(queued)).id, original.id, 'idempotency survives a host restart');
  await assert.rejects(restarted.enqueue({ ...queued, text: 'Changed' }), /different message/);
  const service = await createMobileService({ directory, computerName: 'Fixture Mac', assertCurrent: async () => { if (!current) throw Error('Account changed.'); },
    execute: async (command, parameters) => { executions++; return { command, text: parameters.text }; } });
  const offer = await service.createOffer('http://127.0.0.1:29323');
  const key = randomBytes(32), deviceID = randomUUID(), pairingKey = Buffer.from(offer.secret, 'base64');
  const request = (kind, peerID, key, command, parameters = {}, requestID = randomUUID()) => {
    const packet = sealPacket({ issuedAt: Date.now() / 1000, command, parameters }, key,
      { kind, peerID, computerID: offer.computerID, requestID }, 'request');
    return service.packet(packet).then(response => openPacket(response, key, 'response'));
  };
  assert.equal((await request('pair', offer.pairingID, pairingKey, 'pair.claim', { deviceID, deviceName: 'Fixture iPhone', deviceKey: key.toString('base64') })).data.state, 'pending');
  await assert.rejects(request('device', deviceID, key, 'snapshot'));
  const state = service.status();
  assert.equal(state.pending.deviceName, 'Fixture iPhone');
  await assert.rejects(service.approve(offer.pairingID, '000000' === state.pending.code ? '000001' : '000000'));
  await service.approve(offer.pairingID, state.pending.code);
  assert.equal((await request('pair', offer.pairingID, pairingKey, 'pair.status', { deviceID })).data.state, 'approved');
  const id = randomUUID();
  const responses = await Promise.all([request('device', deviceID, key, 'message', { text: 'Hello' }, id), request('device', deviceID, key, 'message', { text: 'Hello' }, id)]);
  assert.deepEqual(responses[0], responses[1]); assert.equal(executions, 1);
  assert.equal((await request('device', deviceID, key, 'message', { text: 'Different' }, id)).ok, false);
  current = false;
  assert.equal((await request('device', deviceID, key, 'snapshot')).ok, false);
  current = true;
  await service.revoke(deviceID);
  await assert.rejects(request('device', deviceID, key, 'snapshot'));
  console.log('PASS mobile pairing requires local approval; keys authenticate every packet, retries deduplicate, account changes and revocation deny access.');
} finally { await rm(directory, { recursive: true, force: true }); }
