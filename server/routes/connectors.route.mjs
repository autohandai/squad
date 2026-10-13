// Connectors route plug-in (docs/integration/connectors.md, ADR-0107).
//
//   GET    /api/connectors               -> { connectors: [public records] }
//   POST   /api/connectors               <- { name, kind, command, args, env } | { name, kind: "url", url, transport, headers }; saved off
//   GET    /api/connectors/:id
//   PUT    /api/connectors/:id           <- same fields; a secret sent back empty keeps the stored value; built-in takes { apiKey }
//   DELETE /api/connectors/:id
//   POST   /api/connectors/:id/test      -> { ok, tools, framing|transport, error, credits?, keyChecked }
//   POST   /api/connectors/:id/enable, /disable
//
// Secrets (env values and headers that look like secrets, the Firecrawl key)
// are masked in every response. The store is ctx.connectors, created by
// server.mjs beside Computer Use so member provisioning can read it too.
import { probeHttp, probeStdio } from '../connectors/probe.mjs';
import { boundedError } from '../connectors/framing.mjs';

export const name = 'connectors';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

async function firecrawlCredits(baseUrl, apiKey) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v2/team/credit-usage`, { method: 'GET', headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json || json.success === false) throw new Error(String(json?.error || `Firecrawl answered ${response.status}`).slice(0, 200));
  const credits = json.data?.remainingCredits ?? json.remainingCredits;
  return typeof credits === 'number' ? credits : null;
}

export async function testConnector(ctx, id) {
  const store = ctx.connectors;
  const spec = await store.spec(id, { firecrawlBaseUrl: ctx.firecrawlBaseUrl || '' });
  let result;
  if (spec.kind === 'stdio') result = await probeStdio({ command: spec.command, args: spec.args, env: spec.env, cwd: ctx.squadStateDir });
  else result = await probeHttp({ url: spec.url, transport: spec.transport, headers: spec.headers });
  if (spec.builtin && result.ok) {
    // Handshake-only when no key is set; a real (free) Firecrawl request when one is.
    const apiKey = spec.env.FIRECRAWL_API_KEY;
    if (apiKey) {
      try { const credits = await firecrawlCredits(spec.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev', apiKey); result = { ...result, keyChecked: true, ...(credits === null ? {} : { credits }) }; }
      catch (failure) { result = { ok: false, error: boundedError(`The server starts, but Firecrawl rejected the key: ${failure.message}`), tools: result.tools, keyChecked: true }; }
    } else result = { ...result, keyChecked: false };
  }
  const connector = await store.recordTest(id, result);
  return { ...connector.lastTest, framing: result.framing, transport: result.transport, connector };
}

export async function handle(req, res, url, ctx) {
  if (url.pathname !== '/api/connectors' && !url.pathname.startsWith('/api/connectors/')) return false;
  try {
    const store = ctx.connectors;
    if (!store) throw fail('Connectors are not available in this runtime.', 503);
    if (url.pathname === '/api/connectors' && req.method === 'GET') {
      ctx.json(res, 200, { success: true, data: { connectors: await store.list() } });
      return true;
    }
    if (url.pathname === '/api/connectors' && req.method === 'POST') {
      ctx.json(res, 201, { success: true, data: await store.create(await ctx.readBody(req)) });
      return true;
    }
    const match = url.pathname.match(/^\/api\/connectors\/([A-Za-z0-9_-]{1,64})(?:\/(test|enable|disable))?$/);
    if (!match) throw fail('Connector route not found.', 404);
    const [, id, action] = match;
    if (!action && req.method === 'GET') { ctx.json(res, 200, { success: true, data: await store.get(id) }); return true; }
    if (!action && req.method === 'PUT') { ctx.json(res, 200, { success: true, data: await store.update(id, await ctx.readBody(req)) }); return true; }
    if (!action && req.method === 'DELETE') { ctx.json(res, 200, { success: true, data: await store.remove(id) }); return true; }
    if (action === 'test' && req.method === 'POST') { ctx.json(res, 200, { success: true, data: await testConnector(ctx, id) }); return true; }
    if ((action === 'enable' || action === 'disable') && req.method === 'POST') {
      const connector = await store.setEnabled(id, action === 'enable');
      ctx.emit?.('connectors.changed', { id, enabled: connector.enabled });
      ctx.json(res, 200, { success: true, data: connector });
      return true;
    }
    throw fail('Connector route not found.', 404);
  } catch (failure) {
    ctx.json(res, failure.status || 500, { success: false, error: boundedError(failure, 400) });
  }
  return true;
}
