import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const packetSchema = z.object({ version: z.literal(1), kind: z.enum(['pair', 'device']), computerID: id, peerID: id, requestID: id, sealed: z.string().max(2_800_000) }).strict();
export const commandSchema = z.object({ issuedAt: z.number().finite(), command: z.string().min(1).max(60), parameters: z.record(z.string(), z.unknown()).default({}) }).strict();
const aad = (packet, direction) => Buffer.from(`autohand-squad.mobile/1/${direction}/${packet.kind}/${packet.computerID}/${packet.peerID}/${packet.requestID}`);

export function sealPacket(body, key, fields, direction = 'response') {
  if (key.length !== 32) throw Error('Invalid mobile key.');
  const packet = { version: 1, ...fields, sealed: '' };
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(packet, direction));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(body), 'utf8'), cipher.final()]);
  packet.sealed = Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64');
  return packetSchema.parse(packet);
}
export function openPacket(input, key, direction = 'request') {
  const packet = packetSchema.parse(input), bytes = Buffer.from(packet.sealed, 'base64');
  if (key.length !== 32 || bytes.length < 28 || bytes.length > 2_097_152) throw Error('Invalid mobile packet.');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAAD(aad(packet, direction)); decipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8'));
}
export function confirmationCode(offer, deviceID, deviceKey) {
  const bytes = createHmac('sha256', Buffer.from(offer.secret, 'base64'))
    .update(`${offer.computerID}:${offer.pairingID}:${deviceID}:${deviceKey}`).digest();
  return String(bytes.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}
export function validateEndpoint(input) {
  const url = new URL(input), host = url.hostname;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(host) || host.endsWith('.local')
    || (isIP(host) === 4 && (host.startsWith('10.') || host.startsWith('192.168.') || (host.startsWith('172.') && Number(host.split('.')[1]) >= 16 && Number(host.split('.')[1]) <= 31)));
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !(url.protocol === 'https:' || (url.protocol === 'http:' && local))) throw Error('Choose HTTPS or a local network address without a path, password or query.');
  return url.origin;
}
export const pairingURL = offer => `autohand-squad://pair?data=${Buffer.from(JSON.stringify(offer)).toString('base64url')}`;
