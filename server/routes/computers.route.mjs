// Where members can run (ADR-0282): this computer, other computers' Squads
// reached over SSH, the remote bridges members already use (ADR-0025),
// cloud providers to set one up with, and the account's other computers.
//
//   GET    /api/computers                 -> { thisComputer, ssh, bridges, providers }
//   GET    /api/computers/account         -> { available, reason, computers }
//   GET    /api/computers/ssh/keys        -> { keys: [{ name, path }] }
//   POST   /api/computers/ssh/test        -> { reachable, squad, message }
//   POST   /api/computers/ssh             -> { computer, test }
//   DELETE /api/computers/ssh/:id         -> { removed, localUrl }
import { hostname, platform } from 'node:os';
import { CLOUD_PROVIDERS } from '../../src/lib/cloud-computers.js';
import { createSshComputers } from '../computers/ssh.mjs';
import { registryFor } from './remote.route.mjs';
import { controller as mobileController } from './mobile.route.mjs';

export const name = 'computers';
const stores = new Map();
export function sshComputersFor(ctx) {
  const dir = ctx.squadStateDir;
  if (!stores.has(dir)) stores.set(dir, createSshComputers({ squadStateDir: dir, ...(ctx.sshPath ? { sshPath: ctx.sshPath } : {}), ...(ctx.homeDir ? { home: ctx.homeDir } : {}) }));
  return stores.get(dir);
}

export async function init(ctx) {
  if (!ctx.squadStateDir) return;
  // The forwards are child processes: they end with this bridge, never orphaned.
  const store = sshComputersFor(ctx);
  process.once('exit', () => { void store.close(); });
  try { await store.start(); }
  catch (error) { ctx.logEvent?.(ctx.SEVERITY?.WARN ?? 13, `SSH computers could not be restored: ${error.message}`, {}); }
}

/** Remote bridges members run on, one row per address, never a token. */
async function bridges(ctx) {
  const remotes = await registryFor(ctx).list().catch(() => []);
  const rows = new Map();
  for (const remote of Array.isArray(remotes) ? remotes : []) {
    if (!remote?.url) continue;
    const row = rows.get(remote.url) || { url: remote.url, label: remote.label || new URL(remote.url).host, members: [] };
    row.members.push(remote.memberId); rows.set(remote.url, row);
  }
  return [...rows.values()];
}

export async function handle(req, res, url, ctx) {
  if (url.pathname !== '/api/computers' && !url.pathname.startsWith('/api/computers/')) return false;
  const ok = data => ctx.json(res, 200, { success: true, data });
  try {
    const ssh = sshComputersFor(ctx);
    if (url.pathname === '/api/computers' && req.method === 'GET') {
      const [list, remote] = await Promise.all([ssh.list(), bridges(ctx)]);
      // An SSH computer's forward is the address a member's Runs on uses.
      const byUrl = new Map(list.map(row => [row.localUrl, row]));
      ok({ thisComputer: { name: hostname(), platform: platform() }, ssh: list.map(row => ({ ...row, members: remote.find(bridge => bridge.url === row.localUrl)?.members || [] })),
        bridges: remote.filter(bridge => !byUrl.has(bridge.url)), providers: CLOUD_PROVIDERS });
      return true;
    }
    if (url.pathname === '/api/computers/account' && req.method === 'GET') {
      if (!ctx.ownedHookScope) { ok({ available: false, reason: 'Sign in to see the other computers in your account.', computers: [] }); return true; }
      ok(await (await mobileController(ctx)).accountComputers()); return true;
    }
    if (url.pathname === '/api/computers/ssh/keys' && req.method === 'GET') { ok({ keys: await ssh.keys() }); return true; }
    if (url.pathname === '/api/computers/ssh/test' && req.method === 'POST') { ok(await ssh.test(await ctx.readBody(req))); return true; }
    if (url.pathname === '/api/computers/ssh' && req.method === 'POST') { ok(await ssh.add(await ctx.readBody(req))); return true; }
    const one = url.pathname.match(/^\/api\/computers\/ssh\/([0-9a-f-]{36})$/);
    if (one && req.method === 'DELETE') {
      const removed = await ssh.remove(one[1]);
      const users = (await bridges(ctx)).find(bridge => bridge.url === removed.localUrl)?.members || [];
      ok({ ...removed, members: users }); return true;
    }
    ctx.json(res, 404, { success: false, error: 'Computers route not found.' }); return true;
  } catch (error) {
    ctx.json(res, error.status && error.status < 600 ? error.status : 400, { success: false, error: error.message });
    return true;
  }
}
