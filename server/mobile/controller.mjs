import { createHash } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';
import { createMobileService } from './service.mjs';
import { createMobileHTTP } from './http.mjs';
import { createMobileAdapter } from './adapter.mjs';
import { createMobileRelay } from './relay.mjs';
import { createMobileICloud, resolveICloudHelper } from './icloud.mjs';
import { pairingURL, validateEndpoint } from './protocol.mjs';
import { squadApiUrl } from '../squad-cloud/client.mjs';
import { assignMemberTask } from '../routes/work.route.mjs';
import { emitBridgeEvent } from '../events.mjs';
import { createCardStore } from './cards.mjs';

// Independent routes (ADR-0228): the same computer can listen on the local
// network, keep the Autohand relay connected, and serve a user-operated tunnel
// at once. `enabled` is the master switch that keeps pairings when off.
// `icloud` (ADR-0255) defaults off, so every file saved before it parses
// unchanged and no computer starts the helper until the person asks.
const configuration = z.object({
  enabled: z.boolean(), local: z.boolean(), relay: z.boolean(), tunnel: z.boolean(), icloud: z.boolean().default(false),
  endpoint: z.string().max(1000).default(''), port: z.number().int().min(0).max(65535).default(29323),
  // Empty is Squad relay by Autohand; anything else is the person's own
  // Squad API deployment (ADR-0282).
  relayUrl: z.string().max(300).default(''),
}).strict();
const legacyConfiguration = z.object({ enabled: z.boolean(), mode: z.enum(['local', 'tunnel', 'relay']), endpoint: z.string().max(1000).default(''), port: z.number().int().min(0).max(65535).default(29323) }).strict();
const defaults = { enabled: false, local: true, relay: true, tunnel: false, icloud: false, endpoint: '', port: 29323, relayUrl: '' };
/** The relay phones use away from home: Squad's own unless the person chose another (ADR-0282). */
export const AUTOHAND_RELAY = Object.freeze({ name: 'Squad relay by Autohand', url: squadApiUrl() });
export function relayOrigin(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let origin;
  try { origin = squadApiUrl(text.replace(/\/+$/, '')); } catch { throw Error('Use the relay’s HTTPS address, like https://relay.example.com, with no path.'); }
  return origin === AUTOHAND_RELAY.url ? '' : origin;
}
export function relayDescription(config, live) {
  const custom = Boolean(config.relayUrl);
  const url = custom ? config.relayUrl : AUTOHAND_RELAY.url;
  return { name: custom ? new URL(url).host : AUTOHAND_RELAY.name, url, custom, connected: Boolean(live?.connected), latencyMs: live?.latencyMs ?? null, lastSeenAt: live?.lastSeenAt || '', error: live?.error || '' };
}

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
  let server = null, relay = null, icloud = null, error = '', transition = Promise.resolve(), adapter;
  // Phone preferences, kept apart from the connection config so changing one
  // never restarts the phone routes (ADR-0256 amendment).
  const preferencesFile = join(directory, 'preferences.json');
  const preferenceSchema = z.object({ confirmPhoneAdds: z.boolean().default(true) });
  let preferences = preferenceSchema.parse(await readPersistentJson(preferencesFile, {}).catch(() => ({})));
  // Resolved once: the nested helper exists only in a macOS app bundle.
  const icloudHelper = ctx.icloudHelperPath ?? resolveICloudHelper();
  const localEndpoint = () => server?.listening && config.local && localAddress() ? `http://${localAddress()}:${server.address().port}` : '';
  const tunnelEndpoint = () => server?.listening && config.tunnel && config.endpoint ? config.endpoint : '';
  /** Every route this computer serves right now, most direct first. */
  function routes() {
    const list = [];
    if (localEndpoint()) list.push({ kind: 'local', endpoint: localEndpoint(), connected: true });
    if (tunnelEndpoint()) list.push({ kind: 'tunnel', endpoint: tunnelEndpoint(), connected: true });
    const relayed = relay?.status();
    if (relayed?.endpoint) list.push({ kind: 'relay', endpoint: relayed.endpoint, connected: relayed.connected });
    // iCloud has no endpoint: the phone reaches it through its own CloudKit
    // container, after every other route (ADR-0255, squad-mobile ADR-0007).
    if (icloud?.status().connected) list.push({ kind: 'icloud', connected: true });
    return list;
  }
  const hasEndpoint = route => route.kind === 'local' || route.kind === 'tunnel';
  /** Routes for one approved phone; a relay route carries that phone's own grant. */
  function deviceRoutes(deviceID) {
    return routes().map(({ kind, endpoint }) => {
      if (kind === 'icloud') return { kind };
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
    afterRevoke: id => { icloud?.revoke(id); return relay?.revoke(id); },
  });
  const cards = await createCardStore({ directory });
  adapter = createMobileAdapter({ preferences: () => preferences, origin: ctx.ownedBrokerOrigin, computerID: service.computerID, version: ctx.packageMetadata.version, assignTask: assignMemberTask, announcements: ctx.announcements,
    rootDir: ctx.rootDir || '', cards, emit: name => emitBridgeEvent(name, {}) });
  const listening = () => routes().some(route => route.connected);
  async function close() {
    relay?.close(); relay = null;
    icloud?.close(); icloud = null;
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
      relay = createMobileRelay({ service, identity: ctx.mobileRelayIdentity, ownerScope: scope, computerName: hostname(), ...(value.relayUrl ? { baseUrl: value.relayUrl } : {}) });
      await relay.start();
    }
    // Never fails the other routes: a missing or unsigned helper only shows
    // as the iCloud row's state.
    if (value.icloud && icloudHelper) {
      icloud = createMobileICloud({ service, helperPath: icloudHelper, ...(ctx.icloudSpawn ? { spawnImpl: ctx.icloudSpawn } : {}) });
      icloud.start();
    }
  }
  try { await start(config); } catch (failure) { error = failure.message; }
  const status = () => {
    const list = routes();
    // `endpoint` stays for older callers: the route an older phone would get.
    const primary = list.find(route => route.kind === 'relay' && route.connected) || list.find(hasEndpoint) || list.find(route => route.endpoint);
    const icloudStatus = icloud?.status() || { available: Boolean(icloudHelper), state: 'off', detail: '', connected: false };
    return { ...service.status(), config, preferences, listening: listening(), routes: list, endpoint: primary?.endpoint || '', icloud: icloudStatus, relay: relayDescription(config, config.relay ? relay?.status() : null), error: error || relay?.status().error || '' };
  };
  return {
    status,
    configure: input => {
      const action = transition.then(async () => {
        const next = requestedConfiguration(input);
        if (next.enabled && !next.local && !next.relay && !next.tunnel) throw Error('Choose at least one way for phones to connect.');
        if (next.icloud && !icloudHelper) throw Error('This build of Squad cannot use iCloud for phones.');
        // A caller that doesn't mention the relay keeps the one chosen.
        next.relayUrl = input && typeof input === 'object' && 'relayUrl' in input ? relayOrigin(next.relayUrl) : config.relayUrl;
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
      // A QR needs an address; iCloud alone cannot pair (ADR-0255).
      const ready = routes().filter(route => route.connected && route.kind !== 'icloud');
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
      // The same offer for a phone on this Apple Account, published only on
      // this explicit click; it expires with the QR (ADR-0007).
      if (icloud?.status().connected) icloud.offer(offer);
      return { link: pairingURL(offer), expiresAt: offer.expiresAt, computerName: offer.computerName };
    },
    approve: async input => { const value = z.object({ pairingID: z.uuid(), code: z.string().regex(/^\d{6}$/) }).strict().parse(input); await service.approve(value.pairingID, value.code); icloud?.withdrawOffer(); return status(); },
    reject: async () => { await service.reject(); icloud?.withdrawOffer(); return status(); },
    /**
     * Other computers in this account, from the relay (ADR-0282). Needs the
     * relay on: it is the only place this account's computers are listed.
     */
    accountComputers: async () => {
      if (!config.enabled || !config.relay || !relay) return { available: false, reason: 'Turn on Reach from anywhere to see the other computers in your account.', computers: [] };
      try {
        const computers = await relay.accountComputers();
        return { available: true, reason: '', computers: computers.map(row => ({ ...row, thisComputer: row.computerID === service.computerID })) };
      } catch (failure) {
        return { available: false, reason: failure.status === 404 ? 'This relay can’t list your computers yet.' : failure.message, computers: [] };
      }
    },
    icloudMeasurements: () => icloud ? icloud.measurements() : { helper: null, requestAgeMs: { count: 0, p50: null, p95: null } },
    revoke: async id => { await service.revoke(z.uuid().parse(id)); return status(); },
    teamDecisions: () => ({ decisions: adapter.teamDecisions() }),
    claimTeam: async input => ({ claimed: await adapter.claimTeam(z.object({ receiptId: z.string().min(1).max(200) }).strict().parse(input).receiptId) }),
    settleTeam: async input => {
      const value = z.object({ receiptId: z.string().min(1).max(200), state: z.enum(['done', 'failed', 'declined']), result: z.string().max(300).optional(), runId: z.string().max(200).optional() }).strict().parse(input);
      await adapter.settleTeam(value);
      return { decisions: adapter.teamDecisions() };
    },
    preferences: async input => {
      preferences = preferenceSchema.parse({ ...preferences, ...z.object({ confirmPhoneAdds: z.boolean() }).partial().strict().parse(input) });
      await writePersistentJson(preferencesFile, preferences);
      return status();
    },
    // Marketplace adds a phone decided; the Squad window carries them out (ADR-0256).
    marketplaceRequests: () => ({ requests: adapter.marketplacePending() }),
    claimMarketplace: async input => ({ claimed: await adapter.claimMarketplace(z.object({ requestID: z.string().min(3).max(300) }).strict().parse(input).requestID) }),
    settleMarketplace: async input => {
      const value = z.object({ requestID: z.string().min(3).max(300), state: z.enum(['done', 'failed']), result: z.string().max(300).optional() }).strict().parse(input);
      return { request: await adapter.settleMarketplace(value), requests: adapter.marketplacePending() };
    },
    close,
  };
}
