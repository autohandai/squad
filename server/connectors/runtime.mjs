// The bridge side of connector launches (ADR-0244). Provisioning asks for
// launcher entries: one `node runtime-proxy.mjs` per enabled connector with a
// per-member token. The proxy trades that token for the real definition at
// start, so a member's config file carries no connector secret, and the
// bridge can refuse a member that lost access or a connector that was turned
// off since the config was written.
//
// Tokens live in memory only: a bridge restart invalidates every token and
// the next turn writes fresh ones, which is when an engine starts its MCP
// servers anyway. A token is stable per member while the bridge runs so a
// warm engine session keeps its launch key (ADR-0030).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { findExecutable, guiSafePath } from '../harness/discovery.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function createConnectorRuntime({ store, oauth, bridgeUrl, rootDir, nodePath = process.execPath, firecrawlBaseUrl = '' }) {
  const byMember = new Map(); // memberId -> { token, ids:Set }
  const byToken = new Map(); // token -> memberId
  const proxyPath = join(rootDir, 'server', 'connectors', 'runtime-proxy.mjs');
  const runtimeUrl = () => new URL('/api/connectors/runtime', typeof bridgeUrl === 'function' ? bridgeUrl() : bridgeUrl).toString();

  function grant(memberId, ids) {
    let entry = byMember.get(memberId);
    if (!entry) {
      entry = { token: randomBytes(32).toString('hex'), ids: new Set() };
      byMember.set(memberId, entry);
      byToken.set(entry.token, memberId);
    }
    entry.ids = new Set(ids);
    return entry.token;
  }

  /**
   * Launcher specs for a member's enabled connectors (`specs` from
   * store.enabledSpecs, already filtered by the member's permission). They
   * keep each connector's server name and order; only the command changes.
   */
  function launchers(memberId, specs) {
    if (!specs.length) { revokeMember(memberId); return []; }
    const token = grant(memberId, specs.map((spec) => spec.id));
    return specs.map((spec) => ({
      id: spec.id, name: spec.name, serverName: spec.serverName, builtin: spec.builtin, google: spec.google || '',
      kind: 'stdio', command: nodePath, args: [proxyPath], framing: 'newline',
      env: { AUTOHAND_SQUAD_CONNECTOR_URL: runtimeUrl(), AUTOHAND_SQUAD_CONNECTOR_TOKEN: token, AUTOHAND_SQUAD_CONNECTOR_ID: spec.id },
    }));
  }

  function memberFor(token) {
    const supplied = Buffer.from(String(token || ''));
    for (const [candidate, memberId] of byToken) {
      const expected = Buffer.from(candidate);
      if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return memberId;
    }
    return null;
  }

  async function authorize(token, id) {
    const memberId = memberFor(token);
    if (!memberId) throw fail('This connector session ended. Squad starts a new one on the member\'s next turn.', 401);
    if (!byMember.get(memberId)?.ids.has(id)) throw fail('This member isn\'t allowed to use this connector any more.', 403);
    const enabled = await store.enabledIds();
    if (!enabled.includes(id)) throw fail('This connector was turned off in Settings › Connectors.', 403);
    return memberId;
  }

  /** What the proxy needs: the definition with secrets, or a fresh access token. */
  async function resolve(token, input) {
    const id = String(input?.id || '');
    await authorize(token, id);
    const stale = input?.stale === true;
    if (input?.want === 'access-token') return oauth.fresh(id, { stale });
    if (input?.want !== 'launch') throw fail('Unknown runtime request.');
    const spec = await store.spec(id, { firecrawlBaseUrl });
    if (spec.kind === 'stdio') {
      // Engines started from the desktop app may have a short PATH: resolve
      // npx/uvx/docker here, where Squad already knows the usual tool folders.
      spec.env = { PATH: guiSafePath(), ...spec.env };
      if (!/[\\/]/.test(spec.command)) spec.command = findExecutable(spec.command) || spec.command;
    }
    if (spec.kind === 'url' && spec.oauth) {
      const { accessToken } = await oauth.fresh(id, { stale });
      spec.headers = { ...Object.fromEntries(Object.entries(spec.headers).filter(([key]) => key.toLowerCase() !== 'authorization')), Authorization: `Bearer ${accessToken}` };
    }
    return spec;
  }

  async function report(token, input) {
    const id = String(input?.id || '');
    await authorize(token, id);
    const type = ['started', 'crash', 'error', 'recovered'].includes(input?.type) ? input.type : 'error';
    if (type === 'started' || type === 'recovered') {
      const current = await store.get(id).catch(() => null);
      // Only write when there is something to clear: starts are frequent.
      if (!current?.runtime?.lastError && type === 'started' && current?.runtime?.lastStartAt) return { ok: true };
    }
    await store.recordRuntime(id, { type, detail: input?.detail });
    return { ok: true };
  }

  function revokeMember(memberId) {
    const entry = byMember.get(memberId);
    if (!entry) return;
    byMember.delete(memberId);
    byToken.delete(entry.token);
  }

  return { launchers, resolve, report, revokeMember, close: () => { byMember.clear(); byToken.clear(); } };
}
