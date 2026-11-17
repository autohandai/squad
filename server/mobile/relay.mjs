import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { connectWebSocket } from '../../relay/ws.mjs';
import { createSquadApi, squadApiUrl } from '../squad-cloud/client.mjs';
import { packetSchema } from './protocol.mjs';

const readySchema = z.object({ type: z.literal('relay.ready'), protocolVersion: z.literal(1), computerID: z.string(), leaseUntil: z.number().finite() }).strict();
const incomingSchema = z.object({ type: z.literal('packet'), id: z.uuid(), packet: packetSchema }).strict();
const credentialSchema = z.object({ token: z.string().min(1), actorID: z.string().min(1), teamID: z.string().optional() });

/** Outbound-only transport. Account credentials never enter a QR or phone packet. */
export function createMobileRelay({ service, identity, ownerScope, baseUrl = squadApiUrl(), fetchImpl = fetch, connect = connectWebSocket }) {
  const origin = squadApiUrl(baseUrl), abort = new AbortController();
  let stopped = false, socket = null, session = null, roomID = '', lastPong = 0, leaseUntil = 0;
  let error = '', retry = null, attempt = 0, connecting = null, heartbeat = null, renewal = null;
  // Grants and revocations run one at a time so a late grant can never
  // re-add a route for a phone that was just revoked.
  let devices = Promise.resolve(), grantsSupported = true;
  const inOrder = fn => { const result = devices.then(fn); devices = result.catch(() => {}); return result; };
  function current() {
    if (stopped) throw Error('Phone connections are off.');
    return credentialSchema.parse(identity());
  }
  async function api() {
    const credential = current(), fingerprint = createHash('sha256').update(credential.token).digest('hex');
    if (!session || session.fingerprint !== fingerprint || session.expiresAt < Date.now() + 60_000) {
      const exchanged = z.object({ token: z.string().regex(/^ss_[a-f0-9]{64}$/), expiresAt: z.iso.datetime() }).parse(await createSquadApi({ baseUrl: origin, fetchImpl, signal: abort.signal }).request('/v1/auth/exchange', {
        method: 'POST', body: { identityToken: credential.token, deviceName: 'Squad phone relay' },
      }));
      current();
      session = { token: exchanged.token, expiresAt: Date.parse(exchanged.expiresAt), fingerprint };
    }
    const token = session.token;
    const authenticated = (url, init) => {
      const active = current();
      if (active.token !== credential.token) throw Error('The account changed. Reconnect the phone connection.');
      const headers = new Headers(init.headers); headers.set('x-autohand-identity', active.token);
      return fetchImpl(url, { ...init, headers });
    };
    return { credential, token, client: createSquadApi({ baseUrl: origin, fetchImpl: authenticated, token, signal: abort.signal }) };
  }
  const control = async (path, method = 'POST', body) => {
    const { client } = await api();
    try { return await client.request(`/v1/mobile-relays/${roomID}${path}`, { method, body }); }
    catch (failure) { if (failure.status === 401) session = null; throw failure; }
  };
  /**
   * Give every approved device a standing relay route (ADR-0228), including
   * phones first approved on the local network. The relay stores only the
   * token's SHA-256; the phone receives the token in its encrypted snapshot.
   * An older relay without grants answers 404 and simply gets none.
   */
  const grant = () => inOrder(async () => {
    if (stopped || !roomID || !grantsSupported) return;
    const room = roomID, rows = service.relayGrants(room);
    const minted = rows.filter(row => !row.token).map(row => ({ deviceID: row.deviceID, token: randomBytes(32).toString('hex') }));
    const all = [...rows.filter(row => row.token), ...minted];
    if (!all.length) return;
    try { await control('/devices/grants', 'POST', { grants: all.map(row => ({ deviceID: row.deviceID, hash: createHash('sha256').update(row.token).digest('hex') })) }); }
    catch (failure) { if (failure.status === 404) { grantsSupported = false; return; } throw failure; }
    if (minted.length && room === roomID) await service.saveRelayGrants(room, minted);
  });
  function disconnected() {
    leaseUntil = 0;
    if (stopped || retry) return;
    error = 'The relay is reconnecting. Keep this computer awake and connected.';
    retry = setTimeout(() => { retry = null; void open().catch(() => {}); }, Math.min(60_000, 1000 * 2 ** Math.min(attempt++, 6)));
    retry.unref?.();
  }
  async function open() {
    if (connecting) return connecting;
    connecting = (async () => {
      const { client, credential, token } = await api();
      const registration = z.object({ roomID: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await client.request('/v1/mobile-relays', {
        method: 'POST', body: { computerID: service.computerID, actorID: credential.actorID, ownerScope, ...(credential.teamID ? { teamID: credential.teamID } : {}) },
      }));
      current(); roomID = registration.roomID;
      await inOrder(() => control('/devices/sync', 'POST', { deviceIDs: service.status().devices.map(device => device.id) }));
      await grant().catch(() => { /* Retried on the next connection or approval. */ });
      if (current().token !== credential.token) throw Error('The account changed. Reconnect the phone connection.');
      const next = await connect(`${origin}/v1/mobile-relays/${roomID}/host`, { headers: { authorization: `Bearer ${token}`, 'x-autohand-identity': credential.token } });
      if (stopped) { next.close(); throw Error('Phone connections are off.'); }
      socket = next;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { next.close(); reject(Error('The relay did not confirm this computer.')); }, 10_000);
        const fail = () => { clearTimeout(timer); reject(Error('The relay connection ended.')); };
        next.once('close', fail);
        next.on('error', () => { next.close(); });
        next.on('pong', () => { if (socket === next) lastPong = Date.now(); });
        next.on('message', text => {
          if (stopped || socket !== next) return;
          try {
            const parsed = JSON.parse(text);
            if (parsed.type === 'relay.ready') {
              const ready = readySchema.parse(parsed);
              if (ready.computerID !== service.computerID || ready.leaseUntil <= Date.now()) throw Error('The relay identified a different computer.');
              leaseUntil = ready.leaseUntil; lastPong = Date.now(); attempt = 0; error = '';
              clearTimeout(timer); next.off('close', fail); resolve(); return;
            }
            const input = incomingSchema.parse(parsed);
            void service.packet(input.packet, 'relay').then(packet => {
              if (!stopped && socket === next && next.open) next.send({ type: 'packet.reply', id: input.id, packet });
            }).catch(failure => {
              if (!stopped && socket === next && next.open) next.send({ type: 'packet.error', id: input.id, status: [400, 401, 403, 409, 429].includes(failure.status) ? failure.status : 503 });
            });
          } catch { next.close(1008, 'Invalid relay message.'); }
        });
        next.on('close', () => { if (socket === next) { socket = null; disconnected(); } });
      });
    })().catch(failure => { if (failure.status === 401) session = null; disconnected(); throw failure; }).finally(() => { connecting = null; });
    return connecting;
  }
  return {
    async start() {
      try { await open(); } catch { /* Saved opt-in remains retryable while offline. */ }
      heartbeat = setInterval(() => {
        if (!socket) return;
        try {
          current();
          if (Date.now() - lastPong > 45_000 || leaseUntil <= Date.now()) socket.close();
          else socket.ping();
        } catch { socket.close(); }
      }, 20_000); heartbeat.unref?.();
      renewal = setInterval(() => {
        const renewing = socket;
        if (!renewing) return;
        void control('/lease').then(value => {
          if (stopped || socket !== renewing) return;
          const lease = z.object({ renewed: z.boolean(), leaseUntil: z.number().finite() }).parse(value);
          if (!lease.renewed) renewing.close(); else leaseUntil = lease.leaseUntil;
        }).catch(() => { if (!stopped && socket === renewing) renewing.close(); });
      }, 5 * 60_000); renewal.unref?.();
    },
    status: () => ({ connected: Boolean(socket?.open && leaseUntil > Date.now() && Date.now() - lastPong <= 45_000), endpoint: roomID ? `${origin}/mobile/${roomID}` : '', roomID, error }),
    grant,
    async offer(metadata) {
      if (!socket?.open || leaseUntil <= Date.now()) throw Error('Wait for the relay to connect before pairing a phone.');
      return z.object({ endpoint: z.string(), relayToken: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await control('/offers', 'POST', { pairingID: metadata.pairingID, expiresAt: metadata.expiresAt }));
    },
    approve: ({ pairingID, deviceID }) => control(`/offers/${pairingID}/approve`, 'POST', { deviceID }),
    async revoke(deviceID) {
      // Local credential removal is authoritative even while cloud is offline.
      // Reconnect synchronizes the retained device IDs before accepting packets.
      const revoking = socket;
      await inOrder(() => control(`/devices/${deviceID}`, 'DELETE')).catch(() => { if (socket === revoking) revoking?.close(); });
    },
    close() {
      stopped = true; abort.abort(); clearTimeout(retry); clearInterval(heartbeat); clearInterval(renewal);
      socket?.close(); socket = null; leaseUntil = 0;
    },
  };
}
