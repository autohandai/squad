import { createHash } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';
import { createMobileService } from './service.mjs';
import { createMobileHTTP } from './http.mjs';
import { createMobileAdapter } from './adapter.mjs';
import { createMobileRelay } from './relay.mjs';
import { pairingURL, validateEndpoint } from './protocol.mjs';
import { assignMemberTask } from '../routes/work.route.mjs';
import { emitBridgeEvent } from '../events.mjs';
import { createCardStore } from './cards.mjs';

// Independent routes (ADR-0228): the same computer can listen on the local
// network, keep the Autohand relay connected, and serve a user-operated tunnel
// at once. `enabled` is the master switch that keeps pairings when off.
const configuration = z.object({
  enabled: z.boolean(), local: z.boolean(), relay: z.boolean(), tunnel: z.boolean(),
  endpoint: z.string().max(1000).default(''), port: z.number().int().min(0).max(65535).default(29323),
}).strict();
const legacyConfiguration = z.object({ enabled: z.boolean(), mode: z.enum(['local', 'tunnel', 'relay']), endpoint: z.string().max(1000).default(''), port: z.number().int().min(0).max(65535).default(29323) }).strict();
const defaults = { enabled: false, local: true, relay: true, tunnel: false, endpoint: '', port: 29323 };

/**
 * A saved 0.1 file had one exclusive `mode`. Upgrading keeps the local listener
 * and adds the relay for local and relay modes, so a phone paired on either
 * route reaches the computer and learns the other one without a new QR. A
 * user-operated tunnel stays exactly as chosen.
 */
export function migrateSavedConfiguration(value) {
  if (!value || typeof value !== 'object' || !('mode' in value)) return configuration.parse(value);
  const legacy = legacyConfiguration.parse(value);
  return configuration.parse({ enabled: legacy.enabled, local: legacy.mode !== 'tunnel', relay: legacy.mode !== 'tunnel', tunnel: legacy.mode === 'tunnel', endpoint: legacy.endpoint, port: legacy.port });
}
/** API callers that still send `{mode}` asked for exactly that one route. */
function requestedConfiguration(input) {
  if (!input || typeof input !== 'object' || !('mode' in input)) return configuration.parse(input);
  const legacy = legacyConfiguration.parse(input);
  return configuration.parse({ enabled: legacy.enabled, local: legacy.mode === 'local', relay: legacy.mode === 'relay', tunnel: legacy.mode === 'tunnel', endpoint: legacy.endpoint, port: legacy.port });
}
const localAddress = () => Object.values(networkInterfaces()).flat().find(row => row && row.family === 'IPv4' && !row.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(row.address))?.address || '';

export async function createMobileController(ctx) {
  if (!ctx.ownedHookScope || !ctx.ownedBrokerOrigin) throw Error('Sign in and select a Squad before connecting a phone.');
  const scope = createHash('sha256').update(ctx.ownedHookScope).digest('hex');
  const directory = join(ctx.squadStateDir, 'mobile', scope), file = join(directory, 'config.json');
  const saved = await readPersistentJson(file, defaults);
  let config = migrateSavedConfiguration(saved);
  if (saved !== defaults && 'mode' in saved) await writePersistentJson(file, config);
  let server = null, relay = null, error = '', transition = Promise.resolve(), adapter;
  const localEndpoint = () => server?.listening && config.local && localAddress() ? `http://${localAddress()}:${server.address().port}` : '';
  const tunnelEndpoint = () => server?.listening && config.tunnel && config.endpoint ? config.endpoint : '';
  /** Every route this computer serves right now, most direct first. */
  function routes() {
    const list = [];
    if (localEndpoint()) list.push({ kind: 'local', endpoint: localEndpoint(), connected: true });
    if (tunnelEndpoint()) list.push({ kind: 'tunnel', endpoint: tunnelEndpoint(), connected: true });
    const relayed = relay?.status();
    if (relayed?.endpoint) list.push({ kind: 'relay', endpoint: relayed.endpoint, connected: relayed.connected });
    return list;
  }
  /** Routes for one approved phone; a relay route carries that phone's own grant. */
  function deviceRoutes(deviceID) {
    return routes().map(({ kind, endpoint }) => {
      if (kind !== 'relay') return { kind, endpoint };
      const token = relay?.status().roomID ? service.relayGrant(deviceID, relay.status().roomID) : undefined;
      return { kind, endpoint, ...(token ? { relayToken: token } : {}) };
    });
  }
  const service = await createMobileService({ directory, computerName: hostname(), assertCurrent: () => adapter.assertCurrent(), execute: (...args) => adapter.execute(...args),
    routes: async deviceID => deviceRoutes(deviceID),
    beforeApprove: async input => {
      if (!input.relay) return;
      // A phone approved while the relay is down still gets a standing relay
      // grant when it reconnects, as long as it can reach this computer now.
      if (relay?.status().connected) return relay.approve(input);
      if (!server?.listening) throw Error('Reconnect the relay before approving this phone.');
    },
    afterApprove: () => { void relay?.grant().catch(() => {}); },
    afterRevoke: id => relay?.revoke(id),
  });
  const cards = await createCardStore({ directory });
  adapter = createMobileAdapter({ origin: ctx.ownedBrokerOrigin, computerID: service.computerID, version: ctx.packageMetadata.version, assignTask: assignMemberTask, announcements: ctx.announcements,
    rootDir: ctx.rootDir || '', cards, emit: name => emitBridgeEvent(name, {}) });
  const listening = () => routes().some(route => route.connected);
  async function close() {
    relay?.close(); relay = null;
    const previous = server; server = null;
    if (previous) await new Promise(resolve => { previous.close(resolve); previous.closeAllConnections(); });
  }
  async function start(value) {
    if (!value.enabled) return;
    if (value.local || value.tunnel) {
      if (value.tunnel) validateEndpoint(value.endpoint);
      const next = createMobileHTTP(service);
      await new Promise((resolve, reject) => {
        next.once('error', reject);
        // A tunnel alone forwards to loopback; the local route needs the LAN.
        next.listen(value.port, value.local ? '0.0.0.0' : '127.0.0.1', () => { next.off('error', reject); resolve(); });
      });
      next.on('error', failure => { error = failure.message; });
      server = next;
    }
    if (value.relay) {
      if (!ctx.mobileRelayIdentity) throw Error('Update Squad to connect this computer through the relay.');
      relay = createMobileRelay({ service, identity: ctx.mobileRelayIdentity, ownerScope: scope });
      await relay.start();
    }
  }
  try { await start(config); } catch (failure) { error = failure.message; }
  const status = () => {
    const list = routes();
    // `endpoint` stays for older callers: the route an older phone would get.
    const primary = list.find(route => route.kind === 'relay' && route.connected) || list.find(route => route.kind !== 'relay') || list[0];
    return { ...service.status(), config, listening: listening(), routes: list, endpoint: primary?.endpoint || '', error: error || relay?.status().error || '' };
  };
  return {
    status,
    configure: input => {
      const action = transition.then(async () => {
        const next = requestedConfiguration(input);
        if (next.enabled && !next.local && !next.relay && !next.tunnel) throw Error('Choose at least one way for phones to connect.');
        if (next.tunnel) {
          next.endpoint = validateEndpoint(next.endpoint);
          if (new URL(next.endpoint).pathname !== '/') throw Error('Use your tunnel’s HTTPS origin without a path.');
        }
        const previous = config;
        await close();
        try {
          await start(next); await writePersistentJson(file, next); config = next; error = '';
          await service.reject();
        } catch (failure) {
          await close();
          try { await start(previous); } catch (restore) { error = restore.message; }
          throw failure;
        }
        return status();
      });
      transition = action.catch(() => {}); return action;
    },
    offer: async () => {
      await transition;
      const ready = routes().filter(route => route.connected);
      if (!ready.length) throw Error('Enable a connection and wait for it to connect first.');
      const relayReady = ready.some(route => route.kind === 'relay');
      const offer = await service.createOffer(async metadata => {
        const relayed = relayReady ? await relay.offer(metadata) : null;
        const direct = ready.filter(route => route.kind !== 'relay').map(({ kind, endpoint }) => ({ kind, endpoint }));
        // Older phones read only `endpoint`: give them the route that works
        // away from home when there is one. `routes` adds only the other
        // direct routes, which keeps the QR small enough to scan comfortably.
        return relayed ? { ...relayed, routes: direct } : { endpoint: direct[0].endpoint, routes: direct.slice(1) };
      });
      return { link: pairingURL(offer), expiresAt: offer.expiresAt, computerName: offer.computerName };
    },
    approve: async input => { const value = z.object({ pairingID: z.uuid(), code: z.string().regex(/^\d{6}$/) }).strict().parse(input); await service.approve(value.pairingID, value.code); return status(); },
    reject: async () => { await service.reject(); return status(); },
    revoke: async id => { await service.revoke(z.uuid().parse(id)); return status(); },
    teamDecisions: () => ({ decisions: adapter.teamDecisions() }),
    claimTeam: async input => ({ claimed: await adapter.claimTeam(z.object({ receiptId: z.string().min(1).max(200) }).strict().parse(input).receiptId) }),
    settleTeam: async input => {
      const value = z.object({ receiptId: z.string().min(1).max(200), state: z.enum(['done', 'failed', 'declined']), result: z.string().max(300).optional(), runId: z.string().max(200).optional() }).strict().parse(input);
      await adapter.settleTeam(value);
      return { decisions: adapter.teamDecisions() };
    },
    close,
  };
}
