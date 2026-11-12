import { createHash } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';
import { createMobileService } from './service.mjs';
import { createMobileHTTP } from './http.mjs';
import { createMobileAdapter } from './adapter.mjs';
import { pairingURL, validateEndpoint } from './protocol.mjs';
import { assignMemberTask } from '../routes/work.route.mjs';

const configuration = z.object({ enabled: z.boolean(), mode: z.enum(['local', 'tunnel']), endpoint: z.string().max(1000).default(''), port: z.number().int().min(0).max(65535).default(29323) }).strict();
const localAddress = () => Object.values(networkInterfaces()).flat().find(row => row && row.family === 'IPv4' && !row.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(row.address))?.address || '';

export async function createMobileController(ctx) {
  if (!ctx.ownedHookScope || !ctx.ownedBrokerOrigin) throw Error('Sign in and select a Squad before connecting a phone.');
  const scope = createHash('sha256').update(ctx.ownedHookScope).digest('hex');
  const directory = join(ctx.squadStateDir, 'mobile', scope), file = join(directory, 'config.json');
  let config = configuration.parse(await readPersistentJson(file, { enabled: false, mode: 'local', endpoint: '', port: 29323 }));
  let server = null, error = '', transition = Promise.resolve(), adapter;
  const service = await createMobileService({ directory, computerName: hostname(), assertCurrent: () => adapter.assertCurrent(), execute: (...args) => adapter.execute(...args) });
  adapter = createMobileAdapter({ origin: ctx.ownedBrokerOrigin, computerID: service.computerID, version: ctx.packageMetadata.version, assignTask: assignMemberTask, announcements: ctx.announcements });
  const endpoint = () => config.mode === 'tunnel' ? config.endpoint : localAddress() && `http://${localAddress()}:${server?.address()?.port || config.port}`;
  async function close() {
    const previous = server; server = null;
    if (previous) await new Promise(resolve => { previous.close(resolve); previous.closeAllConnections(); });
  }
  async function start(value) {
    if (!value.enabled) return;
    if (value.mode === 'tunnel') validateEndpoint(value.endpoint);
    const next = createMobileHTTP(service);
    await new Promise((resolve, reject) => {
      next.once('error', reject);
      next.listen(value.port, value.mode === 'local' ? '0.0.0.0' : '127.0.0.1', () => { next.off('error', reject); resolve(); });
    });
    next.on('error', failure => { error = failure.message; });
    server = next;
  }
  try { await start(config); } catch (failure) { error = failure.message; }
  const status = () => ({ ...service.status(), config, listening: Boolean(server?.listening), endpoint: endpoint() || '', error });
  return {
    status,
    configure: input => {
      const action = transition.then(async () => {
        const next = configuration.parse(input);
        if (next.mode === 'tunnel') next.endpoint = validateEndpoint(next.endpoint);
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
      if (!server?.listening || !endpoint()) throw Error('Enable a connection and choose a reachable address first.');
      const offer = await service.createOffer(endpoint()), link = pairingURL(offer);
      return { link, expiresAt: offer.expiresAt, computerName: offer.computerName };
    },
    approve: async input => { const value = z.object({ pairingID: z.uuid(), code: z.string().regex(/^\d{6}$/) }).strict().parse(input); await service.approve(value.pairingID, value.code); return status(); },
    reject: async () => { await service.reject(); return status(); },
    revoke: async id => { await service.revoke(z.uuid().parse(id)); return status(); },
    close,
  };
}
