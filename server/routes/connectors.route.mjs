// Connectors route plug-in (ADR-0107, ADR-0244).
//
//   GET    /api/connectors                      -> { connectors (each with `health`), googleClient, runtimes }
//   POST   /api/connectors                      <- custom definition; `verify: true` tests it and turns it on when it works
//   POST   /api/connectors/check                <- unsaved definition -> { ok, transport, needsSignIn, tools, error }
//   POST   /api/connectors/import               <- { config: "<mcpServers JSON>" } -> { connectors }
//   GET    /api/connectors/catalog?search&cursor-> { items, nextCursor, source, notice? }
//   GET    /api/connectors/catalog/entry?name=|catalogId=
//   POST   /api/connectors/install              <- { name | catalogId, option, inputs } -> { connector, test, signIn? }
//   POST   /api/connectors/updates/check        -> { connectors }
//   PUT    /api/connectors/google-client        <- { clientId, clientSecret }; DELETE forgets it
//   GET    /api/connectors/oauth/callback       browser redirect target -> HTML page
//   POST   /api/connectors/runtime[/report]     runtime proxy only (header x-squad-connector-token)
//   GET|PUT|DELETE /api/connectors/:id
//   POST   /api/connectors/:id/test | enable | disable | rename | update | sign-out
//   POST|GET|DELETE /api/connectors/:id/sign-in
//
// Secrets (env values and headers marked secret, sign-in tokens, the
// Firecrawl key, the Google client secret) are masked in every response.
import { probeHttp, probeStdio } from '../connectors/probe.mjs';
import { boundedError } from '../connectors/framing.mjs';
import { connectorHealth } from '../connectors/health.mjs';
import { buildDefinition, compareVersions, listing, packageReference } from '../connectors/registry.mjs';
import { CLOUDFLARE_ENTRIES, COMPOSIO_REGISTRY_NAME, FEATURED, GOOGLE_ENTRIES, cloudflareEntry, cloudflareListing, googleEntry, googleListing } from '../connectors/catalog.mjs';
import { findExecutable, guiSafePath } from '../harness/discovery.mjs';

export const name = 'connectors';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const UPDATE_EVERY_MS = 6 * 60 * 60_000;

function squadConnection(ctx) {
  const tools = (ctx.team?.tools || []).map(({ name: toolName, description }) => ({ name: toolName, description }));
  return { id: 'autohand-squad', name: 'Autohand Squad', kind: 'managed', managed: true, enabled: true, available: tools.length > 0, tools, description: 'Team conversations, channels, memory, tasks and saved artifacts. Squad provides this connection to members on every engine; their permissions still apply.' };
}

let runtimeCache = null;
/** Which package runners exist here (checked at most once a minute). */
export function packageRuntimes() {
  if (runtimeCache && Date.now() - runtimeCache.at < 60_000) return runtimeCache.value;
  const value = Object.fromEntries(['npx', 'uvx', 'docker', 'dnx'].map((command) => [command, Boolean(findExecutable(command))]));
  runtimeCache = { at: Date.now(), value };
  return value;
}

async function firecrawlCredits(baseUrl, apiKey) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v2/team/credit-usage`, { method: 'GET', headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json || json.success === false) throw new Error(String(json?.error || `Firecrawl answered ${response.status}`).slice(0, 200));
  const credits = json.data?.remainingCredits ?? json.remainingCredits;
  return typeof credits === 'number' ? credits : null;
}

/** A command's child gets the GUI-safe PATH so npx, uvx and docker are found from the desktop app. */
function stdioEnv(env) {
  return { PATH: guiSafePath(), ...env };
}

async function probeDefinition(ctx, spec) {
  if (spec.kind === 'stdio') return probeStdio({ command: spec.command, args: spec.args, env: stdioEnv(spec.env), cwd: ctx.squadStateDir, timeoutMs: ctx.connectorProbeTimeoutMs || 90_000 });
  let result = await probeHttp({ url: spec.url, transport: spec.transport, headers: spec.headers });
  // Transport detection: a server that refuses Streamable HTTP may be an older SSE server.
  if (!result.ok && spec.transport !== 'sse' && /^HTTP (400|404|405)/.test(result.error || '') && !spec.fixedTransport) {
    const sse = await probeHttp({ url: spec.url, transport: 'sse', headers: spec.headers, timeoutMs: 10_000 });
    if (sse.ok) result = sse;
  }
  return result;
}

export async function testConnector(ctx, id) {
  const store = ctx.connectors;
  const before = await store.get(id);
  let spec = await store.spec(id, { firecrawlBaseUrl: ctx.firecrawlBaseUrl || '' });
  let result;
  if (spec.kind === 'url' && before.oauth) {
    if (before.oauth.status !== 'signed-in') result = { ok: false, needsSignIn: true, error: `Sign in to ${before.name} first.` };
    else {
      try {
        const { accessToken } = await ctx.connectorOAuth.fresh(id);
        spec = { ...spec, headers: { ...spec.headers, Authorization: `Bearer ${accessToken}` } };
      } catch (error) { result = { ok: false, error: error.message, needsSignIn: error.status === 401 }; }
    }
  }
  if (!result) result = await probeDefinition(ctx, spec);
  if (spec.kind === 'url' && !result.ok && /^HTTP 401/.test(result.error || '') && !before.oauth) {
    // A server that asks for sign-in rather than a key: remember it so the row offers Sign in.
    const found = await ctx.connectorOAuth.discover(spec.url, spec.headers).catch(() => ({ required: false }));
    if (found.required) {
      await store.setOAuth(id, {}, (next) => { next.mode = 'dcr'; next.status = 'signed-out'; });
      result = { ok: false, needsSignIn: true, error: `${before.name} asks you to sign in.` };
    }
  }
  if (spec.google && result.ok) {
    // The server answers without a sign-in; prove the sign-in is usable too.
    try { await ctx.connectorOAuth.fresh(id); }
    catch (error) { result = { ok: false, needsSignIn: error.status === 401, error: error.message, tools: result.tools }; }
  }
  if (spec.builtin && result.ok) {
    // Handshake-only when no key is set; a real (free) Firecrawl request when one is.
    const apiKey = spec.env.FIRECRAWL_API_KEY;
    if (apiKey) {
      try { const credits = await firecrawlCredits(spec.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev', apiKey); result = { ...result, keyChecked: true, ...(credits === null ? {} : { credits }) }; }
      catch (failure) { result = { ok: false, error: boundedError(`The server starts, but Firecrawl rejected the key: ${failure.message}`), tools: result.tools, keyChecked: true }; }
    } else result = { ...result, keyChecked: false };
  }
  if (result.ok) await store.recordRuntime(id, { type: 'recovered' }).catch(() => {});
  const connector = await store.recordTest(id, result);
  return { ...connector.lastTest, framing: result.framing, transport: result.transport, connector: await decorate(ctx, connector) };
}

// The Google client a release build staged, or the environment's (ADR-0248).
// Only its id ever reaches the page.
function buildGoogleClientId(ctx) {
  return ctx.connectorBuildClients ? ctx.connectorBuildClients.google?.clientId || '' : String(process.env.AUTOHAND_SQUAD_GOOGLE_CLIENT_ID || '').trim();
}

async function decorate(ctx, connector, googleClientReady) {
  const ready = googleClientReady ?? (Boolean(await Promise.resolve(ctx.connectors.googleClientPublic?.()).catch(() => null)) || Boolean(buildGoogleClientId(ctx)));
  const signingIn = ctx.connectorOAuth?.progress(connector.id)?.waiting === true;
  return { ...connector, health: connectorHealth(connector, { googleClientReady: ready, signingIn }) };
}

async function listAll(ctx) {
  const googleClient = await Promise.resolve(ctx.connectors.googleClientPublic?.()).catch(() => null);
  const ready = Boolean(googleClient) || Boolean(buildGoogleClientId(ctx));
  const list = await ctx.connectors.list();
  return { connectors: [squadConnection(ctx), ...await Promise.all(list.map((item) => decorate(ctx, item, ready)))], googleClient: googleClient || (buildGoogleClientId(ctx) ? { clientId: buildGoogleClientId(ctx), provided: 'build' } : null), runtimes: packageRuntimes() };
}

/** Test a newly saved connector and turn it on when it works (or needs only a sign-in). */
async function verifyAndEnable(ctx, id) {
  const test = await testConnector(ctx, id);
  let connector = test.connector;
  if (test.ok) connector = await decorate(ctx, await ctx.connectors.setEnabled(id, true));
  ctx.emit?.('connectors.changed', { id });
  return { connector, test: { ok: test.ok, tools: test.tools, error: test.error, needsSignIn: test.needsSignIn === true } };
}

/** After a sign-in finishes, test the connector and turn it on if it now works. */
async function afterSignIn(ctx, id) {
  try { await verifyAndEnable(ctx, id); } catch (error) { ctx.log?.(`connector ${id} check after sign-in failed: ${error.message}`); }
}

/** Parse a pasted MCP config: { mcpServers | servers | context_servers }, one server, or a bare map. */
export function configServers(text) {
  let parsed;
  try { parsed = JSON.parse(String(text || '').trim()); } catch { throw fail('That isn\'t valid JSON. Paste the "mcpServers" block from the server\'s instructions.'); }
  if (!record(parsed)) throw fail('Paste a JSON object.');
  const map = ['mcpServers', 'servers', 'context_servers'].map((key) => parsed[key]).find(record);
  const entries = map ? Object.entries(map)
    : (typeof parsed.command === 'string' || typeof parsed.url === 'string') ? [[parsed.name || 'Custom', parsed]]
      : Object.entries(parsed).filter(([, value]) => record(value));
  const servers = entries.filter(([, value]) => record(value)).slice(0, 20).map(([key, value]) => {
    const label = String(key).slice(0, 80) || 'Custom';
    const url = value.url || value.serverUrl || value.httpUrl;
    if (typeof url === 'string') {
      const type = String(value.type || value.transport || '').toLowerCase();
      return { name: label, kind: 'url', url, transport: type === 'sse' ? 'sse' : 'http', headers: Object.entries(record(value.headers) ? value.headers : {}).map(([headerKey, headerValue]) => ({ key: headerKey, value: String(headerValue) })) };
    }
    if (typeof value.command === 'string') {
      return { name: label, kind: 'stdio', command: value.command, args: Array.isArray(value.args) ? value.args.map(String) : [], env: Object.entries(record(value.env) ? value.env : {}).map(([envKey, envValue]) => ({ key: envKey, value: String(envValue) })) };
    }
    throw fail(`${label} has neither a command nor a url.`);
  });
  if (!servers.length) throw fail('No MCP servers found in that config.');
  return servers;
}

async function catalogue(ctx, url) {
  const search = String(url.searchParams.get('search') || '').trim();
  const cursor = String(url.searchParams.get('cursor') || '');
  const installed = await ctx.connectors.list();
  const runtimes = packageRuntimes();
  const googleReady = Boolean(await Promise.resolve(ctx.connectors.googleClientPublic?.()).catch(() => null)) || Boolean(buildGoogleClientId(ctx));
  const google = !cursor ? GOOGLE_ENTRIES.filter((entry) => !search || `${entry.title} ${entry.description} google`.toLowerCase().includes(search.toLowerCase())).map((entry) => googleListing(entry, { installed, googleClientReady: googleReady })) : [];
  let page;
  try { page = await ctx.connectorRegistry.browse({ search, cursor, installed, runtimes }); }
  catch (error) { page = { items: [], nextCursor: null, source: 'offline', notice: error.message }; }
  void checkUpdates(ctx, { onlyIfDue: true }).catch(() => {});
  // Cloudflare's official servers (ADR-0270) after Google's, before the registry.
  const cloudflare = !cursor ? CLOUDFLARE_ENTRIES.filter((entry) => !search || `${entry.title} ${entry.description} cloudflare`.toLowerCase().includes(search.toLowerCase())).map((entry) => cloudflareListing(entry, { installed })) : [];
  return { ...page, items: [...google, ...cloudflare, ...page.items] };
}

let lastUpdateCheck = 0;
/** Compare registry-installed packages with the registry's latest version. */
export async function checkUpdates(ctx, { onlyIfDue = false } = {}) {
  if (onlyIfDue && Date.now() - lastUpdateCheck < UPDATE_EVERY_MS) return [];
  lastUpdateCheck = Date.now();
  const list = await ctx.connectors.list();
  const out = [];
  for (const item of list.filter((entry) => entry.registry?.name && entry.kind === 'stdio')) {
    try {
      const server = await ctx.connectorRegistry.server(item.registry.name);
      const latest = compareVersions(server.version, item.registry.version) > 0 ? server.version : '';
      out.push(await ctx.connectors.setUpdateInfo(item.id, { latest }));
    } catch (error) { ctx.log?.(`connector update check for ${item.id}: ${error.message}`); }
  }
  return out;
}

/**
 * Move a registry package connector to the registry's latest version. The
 * new version is tested first; the connector is saved only if it works, so
 * an update can't break a working connector.
 */
async function updateConnector(ctx, id) {
  const store = ctx.connectors;
  const current = await store.get(id);
  if (!current.registry?.name || current.kind !== 'stdio') throw fail('Only connectors installed from the MCP Registry as a package can be updated here.');
  const server = await ctx.connectorRegistry.server(current.registry.name);
  if (compareVersions(server.version, current.registry.version) <= 0) { await store.setUpdateInfo(id, { latest: '' }); return { updated: false, connector: await decorate(ctx, await store.get(id)), message: `${current.name} is up to date.` }; }
  const index = Number(String(current.registry.option || '').split(':')[1]);
  const pkg = server.packages[index];
  if (!pkg) throw fail('The registry no longer lists this package. Remove the connector and add it again.');
  // The version is the only thing that changes: the package reference in the arguments.
  const base = pkg.registryType === 'oci' ? pkg.identifier.split('@')[0].replace(/:[^/:]+$/, '') : pkg.identifier;
  const previous = pkg.registryType === 'oci' ? null : `${base}${pkg.registryType === 'pypi' ? '==' : '@'}${current.registry.version}`;
  const position = current.args.findIndex((arg) => (previous ? arg === previous : arg.startsWith(`${base}:`) || arg.startsWith(`${base}@`)));
  if (position < 0) throw fail('This connector was edited by hand, so Squad won\'t change its version. Remove it and add it again to update.');
  const args = [...current.args];
  args[position] = packageReference(pkg);
  const spec = await store.spec(id);
  const trialArgs = [...spec.args];
  trialArgs[position] = args[position];
  const trial = await probeDefinition(ctx, { ...spec, args: trialArgs });
  if (!trial.ok) return { updated: false, connector: await decorate(ctx, current), message: `Version ${server.version} didn't start, so ${current.name} stays on ${current.registry.version}: ${trial.error}` };
  await store.applyUpdate(id, { args, version: server.version });
  await store.recordTest(id, trial);
  ctx.emit?.('connectors.changed', { id });
  return { updated: true, connector: await decorate(ctx, await store.get(id)), message: `${current.name} now runs ${server.version}.` };
}

async function install(ctx, input) {
  const store = ctx.connectors;
  const catalogId = String(input?.catalogId || '');
  const option = String(input?.option || '');
  const google = googleEntry(catalogId);
  const cloudflare = cloudflareEntry(catalogId);
  let result;
  if (cloudflare) {
    // A hosted Cloudflare server: sign in with Cloudflare through MCP OAuth (ADR-0270).
    const definition = { name: cloudflare.title, kind: 'url', url: cloudflare.url, transport: 'http', headers: [], description: cloudflare.description };
    const found = await ctx.connectorOAuth.discover(definition.url, {}).catch(() => ({ required: false }));
    definition.oauthRequired = found.required === true;
    result = await store.install(definition, { catalogId: cloudflare.id });
    if (definition.oauthRequired && !result.connector.oauth) await store.setOAuth(result.connector.id, {}, (next) => { next.mode = 'dcr'; next.status = 'signed-out'; });
  } else if (google && option === 'google') {
    result = await store.install({ kind: 'google', product: google.product, name: google.title, description: google.description }, { catalogId });
  } else {
    const registryName = google && option === 'composio' ? COMPOSIO_REGISTRY_NAME : String(input?.name || '');
    const server = await ctx.connectorRegistry.lookup(registryName);
    const rows = listing(server, { runtimes: packageRuntimes() });
    const optionId = google ? rows?.options.find((entry) => entry.kind === 'remote')?.id : option;
    const chosen = rows?.options.find((entry) => entry.id === optionId);
    if (!chosen) throw fail('That install option isn\'t available for this connector.');
    if (!chosen.available) throw fail(`${chosen.needs} isn't installed on this computer. Install it, or choose another way to run ${server.title || 'this connector'}.`, 409);
    const featured = FEATURED.find((entry) => entry.registryName === server.name);
    const definition = buildDefinition(server, optionId, record(input?.inputs) ? input.inputs : {}, { title: featured?.title || '' });
    if (definition.kind === 'url') {
      const plainHeaders = Object.fromEntries(definition.headers.map((pair) => [pair.key, pair.value]));
      const found = await ctx.connectorOAuth.discover(definition.url, plainHeaders).catch(() => ({ required: false }));
      definition.oauthRequired = found.required === true;
    }
    result = await store.install(definition, { catalogId: featured?.id || (google ? 'composio' : '') });
    if (definition.oauthRequired && !result.connector.oauth) await store.setOAuth(result.connector.id, {}, (next) => { next.mode = 'dcr'; next.status = 'signed-out'; });
  }
  const connector = await store.get(result.connector.id);
  if (connector.oauth && connector.oauth.status !== 'signed-in') {
    let signIn = null, signInError = '';
    try { signIn = await ctx.connectorOAuth.start(connector.id); } catch (error) { signInError = error.message; }
    ctx.emit?.('connectors.changed', { id: connector.id });
    return { connector: await decorate(ctx, await store.get(connector.id)), test: null, signIn, signInError, reinstalled: result.reinstalled };
  }
  const verified = await verifyAndEnable(ctx, connector.id);
  return { ...verified, reinstalled: result.reinstalled };
}

/** Test an unsaved definition: transport, whether it wants sign-in, and its tools. */
async function check(ctx, input) {
  if (!record(input)) throw fail('A connector definition is required.');
  if (input.kind === 'url') {
    let parsed;
    try { parsed = new URL(String(input.url || '')); } catch { throw fail('Enter a valid http or https address.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw fail('Connector addresses must start with http:// or https://.');
    if (parsed.username || parsed.password) throw fail('Put credentials in a header, never in the address.');
    const headers = Object.fromEntries((Array.isArray(input.headers) ? input.headers : []).filter((pair) => record(pair) && pair.key).map((pair) => [String(pair.key), String(pair.value || '')]));
    const result = await probeDefinition(ctx, { kind: 'url', url: parsed.toString(), transport: input.transport === 'sse' ? 'sse' : 'http', headers, fixedTransport: input.fixedTransport === true });
    if (!result.ok && /^HTTP 401/.test(result.error || '')) {
      const found = await ctx.connectorOAuth.discover(parsed.toString(), headers).catch(() => ({ required: false }));
      if (found.required) return { ok: false, needsSignIn: true, transport: 'http', tools: [], error: '' };
    }
    return { ok: result.ok, transport: result.transport || input.transport || 'http', tools: result.tools || [], error: result.error || '', needsSignIn: false };
  }
  const command = String(input.command || '').trim();
  if (!command) throw fail('Enter the command to run.');
  const env = Object.fromEntries((Array.isArray(input.env) ? input.env : []).filter((pair) => record(pair) && pair.key).map((pair) => [String(pair.key), String(pair.value || '')]));
  const args = Array.isArray(input.args) ? input.args.map(String) : String(input.args || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const result = await probeDefinition(ctx, { kind: 'stdio', command, args, env });
  return { ok: result.ok, framing: result.framing, tools: result.tools || [], error: result.error || '', needsSignIn: false };
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function callbackPage(res, status, title, detail) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="referrer" content="no-referrer"><style>:root{color-scheme:light dark}body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:Canvas;color:CanvasText}main{max-width:420px;padding:24px}h1{font-size:18px;font-weight:600;margin:0 0 8px}p{margin:0;opacity:.72}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></main></body></html>`;
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
  res.end(body);
}

export async function handle(req, res, url, ctx) {
  if (url.pathname !== '/api/connectors' && !url.pathname.startsWith('/api/connectors/')) return false;
  const path = url.pathname;
  try {
    const store = ctx.connectors;
    if (!store) throw fail('Connectors are not available in this runtime.', 503);
    const ok = (data, status = 200) => ctx.json(res, status, { success: true, data });

    // The runtime proxy: authenticated by its per-member token, never by the browser context.
    if (path === '/api/connectors/runtime' || path === '/api/connectors/runtime/report') {
      if (req.method !== 'POST') throw fail('Connector route not found.', 404);
      const token = String(req.headers['x-squad-connector-token'] || '');
      const body = await ctx.readBody(req);
      ok(path.endsWith('/report') ? await ctx.connectorRuntime.report(token, body) : await ctx.connectorRuntime.resolve(token, body));
      return true;
    }
    if (path === '/api/connectors/oauth/callback' && req.method === 'GET') {
      const params = url.searchParams;
      try {
        const connector = await ctx.connectorOAuth.finish({ state: params.get('state'), code: params.get('code'), error: params.get('error'), errorDescription: params.get('error_description') });
        void afterSignIn(ctx, connector.id);
        callbackPage(res, 200, `Signed in to ${connector.name}`, 'You can close this tab and go back to Squad. Squad is checking the connection now.');
      } catch (error) {
        callbackPage(res, error.status && error.status < 500 ? error.status : 502, 'Sign-in didn\'t finish', boundedError(error, 300));
      }
      return true;
    }
    if (path === '/api/connectors' && req.method === 'GET') { ok(await listAll(ctx)); return true; }
    if (path === '/api/connectors' && req.method === 'POST') {
      const body = await ctx.readBody(req);
      const created = await store.create(body);
      if (body?.verify === true) { ok(await verifyAndEnable(ctx, created.id), 201); return true; }
      ok(await decorate(ctx, created), 201);
      return true;
    }
    if (path === '/api/connectors/check' && req.method === 'POST') { ok(await check(ctx, await ctx.readBody(req))); return true; }
    if (path === '/api/connectors/import' && req.method === 'POST') {
      const body = await ctx.readBody(req);
      const servers = configServers(body?.config);
      const created = [];
      for (const server of servers) created.push(await store.create({ ...server, name: server.name }));
      const verified = [];
      for (const connector of created) verified.push((await verifyAndEnable(ctx, connector.id)).connector);
      ok({ connectors: verified }, 201);
      return true;
    }
    if (path === '/api/connectors/catalog' && req.method === 'GET') { ok(await catalogue(ctx, url)); return true; }
    if (path === '/api/connectors/catalog/entry' && req.method === 'GET') {
      const google = googleEntry(String(url.searchParams.get('catalogId') || ''));
      const installed = await store.list();
      if (google) { ok(googleListing(google, { installed, googleClientReady: Boolean(await store.googleClientPublic()) || Boolean(buildGoogleClientId(ctx)) })); return true; }
      const server = await ctx.connectorRegistry.lookup(String(url.searchParams.get('name') || ''));
      const row = listing(server, { installed, runtimes: packageRuntimes(), featured: FEATURED.find((entry) => entry.registryName === server.name) || null });
      if (!row) throw fail('Squad can\'t install this server: the registry lists no package or address it can run.', 422);
      ok(row);
      return true;
    }
    if (path === '/api/connectors/install' && req.method === 'POST') { ok(await install(ctx, await ctx.readBody(req)), 201); return true; }
    if (path === '/api/connectors/updates/check' && req.method === 'POST') { await checkUpdates(ctx); ok(await listAll(ctx)); return true; }
    if (path === '/api/connectors/google-client') {
      if (req.method === 'PUT') { ok(await store.setGoogleClient(await ctx.readBody(req))); return true; }
      if (req.method === 'DELETE') { await store.setGoogleClient(null); ok(null); return true; }
      if (req.method === 'GET') { ok(await store.googleClientPublic()); return true; }
    }

    const match = path.match(/^\/api\/connectors\/([A-Za-z0-9_-]{1,64})(?:\/(test|enable|disable|rename|update|sign-in|sign-out))?$/);
    if (!match) throw fail('Connector route not found.', 404);
    const [, id, action] = match;
    if (id === 'autohand-squad') {
      if (!action && req.method === 'GET') { ok(squadConnection(ctx)); return true; }
      throw fail('Squad manages this built-in connection. Set each member’s permissions to control what they can do.', 403);
    }
    if (!action && req.method === 'GET') { ok(await decorate(ctx, await store.get(id))); return true; }
    if (!action && req.method === 'PUT') {
      const before = await store.oauthState(id).catch(() => null);
      const updated = await store.update(id, await ctx.readBody(req));
      // A new address drops the old sign-in; hand its tokens back to the old server.
      if (before?.tokens?.accessToken && before.item.url !== updated.url) void ctx.connectorOAuth.revoke(before.oauth, before.tokens);
      ctx.emit?.('connectors.changed', { id });
      ok(await decorate(ctx, updated));
      return true;
    }
    if (!action && req.method === 'DELETE') {
      ctx.connectorOAuth?.cancel(id);
      const removed = await store.remove(id);
      // Revoke the sign-in at the provider too, without holding up the removal.
      const revoked = removed.oauth && removed.tokens ? await Promise.race([ctx.connectorOAuth.revoke(removed.oauth, removed.tokens), new Promise((resolveLater) => setTimeout(() => resolveLater(false), 5000))]) : false;
      ctx.emit?.('connectors.changed', { id, removed: true });
      ok({ id, revoked });
      return true;
    }
    if (action === 'test' && req.method === 'POST') { ok(await testConnector(ctx, id)); return true; }
    if ((action === 'enable' || action === 'disable') && req.method === 'POST') {
      const connector = await store.setEnabled(id, action === 'enable');
      ctx.emit?.('connectors.changed', { id, enabled: connector.enabled });
      ok(await decorate(ctx, connector));
      return true;
    }
    if (action === 'rename' && req.method === 'POST') { ok(await decorate(ctx, await store.rename(id, (await ctx.readBody(req))?.name))); return true; }
    if (action === 'update' && req.method === 'POST') { ok(await updateConnector(ctx, id)); return true; }
    if (action === 'sign-in') {
      if (req.method === 'POST') { const started = await ctx.connectorOAuth.start(id); ok({ ...started, connector: await decorate(ctx, await store.get(id)) }); return true; }
      if (req.method === 'GET') { ok({ ...ctx.connectorOAuth.progress(id), connector: await decorate(ctx, await store.get(id)) }); return true; }
      if (req.method === 'DELETE') { ctx.connectorOAuth.cancel(id); ok(await decorate(ctx, await store.get(id))); return true; }
    }
    if (action === 'sign-out' && req.method === 'POST') {
      const { connector, revoked } = await ctx.connectorOAuth.signOut(id);
      ctx.emit?.('connectors.changed', { id });
      ok({ connector: await decorate(ctx, connector), revoked });
      return true;
    }
    throw fail('Connector route not found.', 404);
  } catch (failure) {
    if (!res.headersSent) ctx.json(res, failure.status || 500, { success: false, error: boundedError(failure, 400), ...(failure.code ? { code: failure.code } : {}) });
  }
  return true;
}
