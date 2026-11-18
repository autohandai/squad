import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { packetSchema } from './protocol.mjs';

/**
 * The iCloud route (ADR-0255, squad-mobile ADR-0007). Squad iCloud.app owns
 * CloudKit; this side owns the keys. The helper hands over each request
 * packet unopened, `service.packet` answers it exactly as for the local and
 * relay routes (same receipts, same refusals), and the reply goes back
 * through the helper. Off unless the person turned it on.
 */
export const ICLOUD_HELPER_EXECUTABLE = join('Squad iCloud.app', 'Contents', 'MacOS', 'Squad iCloud');

/** The helper nested in the installed app: Contents/MacOS/node → Contents/Helpers. */
export function resolveICloudHelper({ env = process.env, execPath = process.execPath, platform = process.platform, exists = existsSync } = {}) {
  if (platform !== 'darwin') return '';
  const candidates = [env.AUTOHAND_SQUAD_ICLOUD_HELPER, join(dirname(execPath), '..', 'Helpers', ICLOUD_HELPER_EXECUTABLE)].filter(Boolean);
  return candidates.find(path => exists(path)) || '';
}

const statusSchema = z.object({ op: z.literal('status'), state: z.string().max(40), detail: z.string().max(500) });
const packetInSchema = z.object({ op: z.literal('packet.in'), id: z.string().min(1).max(200), packet: packetSchema, ageMs: z.number().int().optional() });
const statsSchema = z.object({ op: z.literal('stats') }).passthrough();
const errorSchema = z.object({ op: z.literal('error'), detail: z.string().max(2000).optional() });
const REFUSALS = [400, 401, 403, 409, 429];

export function createMobileICloud({ service, helperPath, spawnImpl = spawn, log = () => {}, restartDelay = attempt => Math.min(60_000, 1000 * 2 ** attempt) }) {
  let child = null, stopped = false, state = helperPath ? 'starting' : 'unavailable', detail = helperPath ? 'Starting iCloud…' : 'This build of Squad has no iCloud helper.';
  let attempt = 0, retry = null, stats = null, offerID = '';
  const ages = [];
  const send = message => { if (child?.stdin?.writable) child.stdin.write(`${JSON.stringify(message)}\n`); };

  async function answer(input) {
    const peerID = input.packet.peerID;
    try {
      const packet = await service.packet(input.packet, 'icloud');
      send({ op: 'packet.out', inReplyTo: input.id, peerID, packet });
    } catch (failure) {
      // The HTTP route's status code, as a record the phone can read.
      send({ op: 'packet.out', inReplyTo: input.id, peerID, status: REFUSALS.includes(failure.status) ? failure.status : 503 });
    }
  }

  function receive(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message?.op === 'status') {
      const parsed = statusSchema.safeParse(message);
      if (!parsed.success) return;
      state = parsed.data.state; detail = parsed.data.detail;
      if (state === 'ready') attempt = 0;
    } else if (message?.op === 'packet.in') {
      const parsed = packetInSchema.safeParse(message);
      // A record the service cannot even parse is refused like a bad HTTP body.
      if (!parsed.success) { if (typeof message.id === 'string' && typeof message.packet?.peerID === 'string') send({ op: 'packet.out', inReplyTo: message.id, peerID: message.packet.peerID, status: 400 }); return; }
      if (parsed.data.ageMs !== undefined) { ages.push(parsed.data.ageMs); if (ages.length > 200) ages.shift(); }
      void answer(parsed.data);
    } else if (message?.op === 'stats') {
      if (statsSchema.safeParse(message).success) { const { op: _op, ...rest } = message; stats = rest; }
    } else if (message?.op === 'error') {
      const parsed = errorSchema.safeParse(message);
      if (parsed.success) log(`iCloud helper: ${parsed.data.detail || 'error'}`);
    }
  }

  function start() {
    if (stopped || !helperPath) return;
    const next = spawnImpl(helperPath, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    child = next;
    createInterface({ input: next.stdout }).on('line', receive);
    next.on('error', failure => { state = 'error'; detail = failure.message; });
    next.on('exit', () => {
      if (child !== next) return;
      child = null;
      // A helper that is not signed for iCloud will not become signed by
      // restarting; everything else (a crash, an update) is retried.
      if (stopped || state === 'unentitled') return;
      state = 'starting'; detail = 'Restarting iCloud…';
      retry = setTimeout(() => { retry = null; start(); }, restartDelay(attempt++));
      retry.unref?.();
    });
    next.stdin.on('error', () => {});
    send({ op: 'start', computerID: service.computerID });
  }

  return {
    start,
    /** `ready` is the only state in which the route is advertised to phones. */
    status: () => ({ available: Boolean(helperPath), state, detail, connected: state === 'ready' }),
    /** For phase 1 measurements: what the helper counted, and how old requests were when read. */
    measurements: () => {
      send({ op: 'stats' });
      const sorted = [...ages].sort((a, b) => a - b), pick = q => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
      return { helper: stats, requestAgeMs: { count: sorted.length, p50: pick(0.5), p95: pick(0.95) } };
    },
    poll: () => send({ op: 'poll' }),
    /** Publishes the QR's offer for a phone on the same Apple Account (ADR-0007, pairing without a QR). */
    offer: offer => { offerID = offer.pairingID; send({ op: 'offer.publish', offer }); },
    withdrawOffer: () => { if (offerID) send({ op: 'offer.withdraw' }); offerID = ''; },
    revoke: peerID => send({ op: 'revoke', peerID }),
    close() {
      stopped = true; clearTimeout(retry);
      const previous = child; child = null;
      if (previous) { try { previous.stdin.end(`${JSON.stringify({ op: 'stop' })}\n`); } catch { /* already gone */ } setTimeout(() => previous.kill(), 2000).unref?.(); }
      state = 'off'; detail = 'iCloud is off.';
    },
  };
}
