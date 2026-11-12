import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';
import { commandSchema, packetSchema, sealPacket, openPacket, confirmationCode, validateEndpoint } from './protocol.mjs';

const deviceSchema = z.object({ deviceID: z.uuid(), deviceName: z.string().trim().min(1).max(100), deviceKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/) }).strict();
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const deny = () => Object.assign(Error('This device is not connected. Pair it again in Squad.'), { status: 401 });

/** Owner-scoped device credentials. No native OS grants or general API proxy. */
export async function createMobileService({ directory, computerName, assertCurrent, execute, now = Date.now }) {
  const file = join(directory, 'mobile-devices.json');
  let state = await readPersistentJson(file, { version: 1, computerID: randomUUID(), devices: {}, receipts: {} });
  if (state.version !== 1 || !state.computerID || !state.devices || !state.receipts) throw Error('The paired-device store is unreadable. Existing data was preserved.');
  let offer = null, claim = null, approved = false, rejected = false, chain = Promise.resolve(), waiting = 0;
  const freshOffer = () => offer && offer.expiresAt > now() / 1000;
  const serial = fn => { const result = chain.then(fn); chain = result.catch(() => {}); return result; };
  async function save(next) { await writePersistentJson(file, next); state = next; }

  async function handle(input) {
    const packet = packetSchema.parse(input);
    if (packet.computerID !== state.computerID) throw deny();
    const device = packet.kind === 'device' ? state.devices[packet.peerID] : null;
    const key = packet.kind === 'pair'
      ? freshOffer() && packet.peerID === offer.pairingID && Buffer.from(offer.secret, 'base64')
      : device && Buffer.from(device.key, 'base64');
    if (!key) throw deny();
    let command;
    try { command = commandSchema.parse(openPacket(packet, key)); } catch { throw deny(); }
    const respond = body => sealPacket(body, key, { kind: packet.kind, computerID: packet.computerID, peerID: packet.peerID, requestID: packet.requestID });
    try {
      if (Math.abs(now() / 1000 - command.issuedAt) > 120) throw Error('Your phone’s clock is out of sync. Set its time automatically and retry.');
      await assertCurrent();
      const { parameters } = command;
      if (packet.kind === 'pair') {
        if (command.command === 'pair.claim') {
          const next = deviceSchema.parse(parameters);
          if (claim && digest(next) !== digest(claim)) throw Error('This code was already scanned by another device. Generate a new code.');
          if (rejected) throw Error('This connection was declined. Generate a new code.');
          claim ||= next;
        } else if (command.command !== 'pair.status') throw Error('Approve this phone on your computer first.');
        if (!claim || parameters.deviceID !== claim.deviceID) throw deny();
        return respond({ ok: true, data: { state: approved ? 'approved' : rejected ? 'rejected' : 'pending' } });
      }
      if (command.command === 'device.disconnect') {
        const next = structuredClone(state); delete next.devices[packet.peerID]; await save(next);
        return respond({ ok: true, data: { removed: true } });
      }
      if (!['snapshot', 'conversation', 'message', 'delegate', 'tasks', 'announcements', 'announcement.act'].includes(command.command)) throw Error('This action is unavailable from a phone.');
      if (!['message', 'delegate'].includes(command.command)) return respond({ ok: true, data: await execute(command.command, parameters, { deviceID: packet.peerID, requestID: packet.requestID }) });
      const receiptID = `${packet.peerID}:${packet.requestID}`, hash = digest({ command: command.command, parameters });
      const previous = state.receipts[receiptID];
      if (previous) {
        if (previous.hash !== hash) throw Error('This receipt belongs to a different message.');
        if (!previous.reply) throw Error('Delivery was interrupted and is unconfirmed. Check the conversation on your computer before sending another copy.');
        return respond(previous.reply);
      }
      if (Object.keys(state.receipts).length >= 10000) throw Error('This computer’s mobile receipt store is full. Messages are preserved; manage connections on your computer.');
      const accepted = structuredClone(state);
      accepted.receipts[receiptID] = { hash, acceptedAt: new Date(now()).toISOString() };
      await save(accepted);
      const data = await execute(command.command, parameters, { deviceID: packet.peerID, requestID: packet.requestID });
      const completed = structuredClone(state), reply = { ok: true, data };
      completed.receipts[receiptID].reply = reply;
      await save(completed);
      return respond(reply);
    } catch (failure) { return respond({ ok: false, error: failure instanceof z.ZodError ? 'This request is invalid. Update the Squad iOS app and retry.' : failure.message }); }
  }

  return {
    computerID: state.computerID,
    status: () => ({ computerID: state.computerID, computerName, devices: Object.entries(state.devices).map(([id, device]) => ({ id, name: device.name, pairedAt: device.pairedAt })),
      pending: freshOffer() && claim && !approved && !rejected ? { pairingID: offer.pairingID, deviceName: claim.deviceName, code: confirmationCode(offer, claim.deviceID, claim.deviceKey), expiresAt: offer.expiresAt } : null }),
    createOffer: endpoint => serial(async () => {
      await assertCurrent();
      if (Object.keys(state.devices).length >= 20) throw Error('Disconnect a phone before pairing another one.');
      offer = { version: 1, computerID: state.computerID, computerName, endpoint: validateEndpoint(endpoint), pairingID: randomUUID(), secret: randomBytes(32).toString('base64'), expiresAt: now() / 1000 + 600 };
      claim = null; approved = false; rejected = false;
      return { ...offer };
    }),
    approve: (pairingID, code) => serial(async () => {
      await assertCurrent();
      if (!freshOffer() || offer.pairingID !== pairingID || !claim || rejected || approved) throw Error('Generate a new pairing code.');
      const expected = Buffer.from(confirmationCode(offer, claim.deviceID, claim.deviceKey)), supplied = Buffer.from(String(code));
      if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) throw Error('The confirmation code does not match.');
      const next = structuredClone(state);
      next.devices[claim.deviceID] = { name: claim.deviceName, key: claim.deviceKey, pairedAt: new Date(now()).toISOString() };
      await save(next); approved = true;
      return { approved: true };
    }),
    reject: () => serial(async () => { rejected = true; }),
    revoke: deviceID => serial(async () => {
      await assertCurrent();
      const next = structuredClone(state); delete next.devices[deviceID]; await save(next);
      if (claim?.deviceID === deviceID) { offer = null; claim = null; }
      return { removed: true };
    }),
    packet: input => {
      if (waiting >= 16) return Promise.reject(Object.assign(Error('Try again in a moment.'), { status: 429 }));
      waiting++;
      return serial(() => handle(input)).finally(() => waiting--);
    },
  };
}
