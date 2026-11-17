#!/usr/bin/env node
// Settings › Connectors in a real browser against a real bridge (ADR-0244).
// Everything outside Squad is a fixture on 127.0.0.1: an MCP Registry, a
// hosted MCP server behind OAuth (protected resource metadata, dynamic
// registration, PKCE, an authorize page that approves at once), a server that
// wants an API key, a legacy SSE server, and a Google-shaped sign-in. The
// browser's window.open is recorded instead of opening a tab; the check then
// follows the sign-in page the way the person's browser would.
//
// Proves: the catalogue lists Squad's Google connectors and the registry's
// servers with their marks; adding a hosted OAuth server signs in, checks the
// tools and turns it on with no command typed; a custom address finds the
// older SSE transport by itself; a pasted config adds a server; a wrong key
// shows a plain error with Edit as the fix, and fixing it works; Gmail asks
// for a Google client, signs in and shows the account; no secret reaches the
// page; the layout holds at phone width.
//
// CONNECTORS_SHOTS_DIR=<dir> saves screenshots (default: a temp folder).
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

const SECRETS = { key: 'sk-fixture-key-4242', bad: 'sk-wrong-key-0000', googleSecret: 'GOCSPX-fixture-9393' };
const shots = process.env.CONNECTORS_SHOTS_DIR || await mkdtemp(join(tmpdir(), 'squad-connectors-shots-'));
await mkdir(shots, { recursive: true });

// ------------------------------------------------------------------ fixtures
const issued = new Map(); // access token -> resource
const codes = new Map(); // code -> { challenge, redirect, resource }
const seen = { registrations: 0, tokenRequests: 0, googleScopes: '' };
let fixtureOrigin = '';
const tools = (names) => ({ tools: names.map((name) => ({ name, description: `${name} fixture tool`, inputSchema: { type: 'object' } })) });
function rpc(request, names) {
  if (request.method === 'initialize') return { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
  if (request.method === 'tools/list') return tools(names);
  return {};
}
const body = (req) => new Promise((resolveBody) => { let data = ''; req.on('data', (chunk) => { data += chunk; }); req.on('end', () => resolveBody(data)); });
const registryServers = () => [
  { name: 'com.notion/mcp', title: 'Notion', description: 'Fixture Notion workspace.', version: '1.0.1', remotes: [{ type: 'streamable-http', url: `${fixtureOrigin}/notion/mcp` }] },
  { name: 'io.example/keyed', title: 'Keyed Docs', description: 'Fixture server that wants an API key.', version: '2.0.0', remotes: [{ type: 'streamable-http', url: `${fixtureOrigin}/keyed/mcp`, headers: [{ name: 'Authorization', description: 'Your Keyed Docs API key.', isRequired: true, isSecret: true }] }] },
  { name: 'io.example/floating', title: 'Floating', description: 'Unpinned package: never offered.', version: '1.0.0', packages: [{ registryType: 'npm', identifier: 'floating-mcp', version: 'latest', transport: { type: 'stdio' } }] },
];
const sseClients = new Map();
const fixture = createServer(async (req, res) => {
  const url = new URL(req.url, fixtureOrigin);
  const json = (status, value, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(value)); };
  // The MCP Registry.
  if (url.pathname === '/registry/v0/servers') {
    const search = (url.searchParams.get('search') || '').toLowerCase();
    const servers = registryServers().filter((server) => !search || `${server.name} ${server.title} ${server.description}`.toLowerCase().includes(search));
    return json(200, { servers: servers.map((server) => ({ server })), metadata: { count: servers.length } });
  }
  const lookup = url.pathname.match(/^\/registry\/v0\/servers\/(.+)\/versions\/latest$/);
  if (lookup) {
    const server = registryServers().find((item) => item.name === decodeURIComponent(lookup[1]));
    return server ? json(200, { server }) : json(404, { error: 'not found' });
  }
  // OAuth for the hosted Notion fixture and the Google-shaped sign-in.
  if (url.pathname === '/.well-known/oauth-protected-resource/notion/mcp') return json(200, { resource: `${fixtureOrigin}/notion/mcp`, authorization_servers: [fixtureOrigin], scopes_supported: ['read'] });
  if (url.pathname === '/.well-known/oauth-authorization-server') return json(200, { issuer: fixtureOrigin, authorization_endpoint: `${fixtureOrigin}/authorize`, token_endpoint: `${fixtureOrigin}/token`, registration_endpoint: `${fixtureOrigin}/register`, revocation_endpoint: `${fixtureOrigin}/revoke`, code_challenge_methods_supported: ['S256'] });
  if (url.pathname === '/register' && req.method === 'POST') { seen.registrations += 1; const input = JSON.parse(await body(req)); return json(201, { client_id: `client-${seen.registrations}`, redirect_uris: input.redirect_uris }); }
  if (url.pathname === '/authorize' || url.pathname === '/o/oauth2/v2/auth') {
    // Approves at once, like a person clicking Allow.
    const code = randomBytes(8).toString('hex');
    if (url.pathname.startsWith('/o/')) seen.googleScopes = url.searchParams.get('scope') || '';
    codes.set(code, { challenge: url.searchParams.get('code_challenge'), redirect: url.searchParams.get('redirect_uri'), resource: url.searchParams.get('resource') || 'google' });
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', code); back.searchParams.set('state', url.searchParams.get('state'));
    res.writeHead(302, { location: back.toString() }); return res.end();
  }
  if ((url.pathname === '/token' && req.method === 'POST') || url.pathname === '/token-google') {
    seen.tokenRequests += 1;
    const form = new URLSearchParams(await body(req));
    if (form.get('grant_type') === 'refresh_token') { const token = `at-${randomBytes(6).toString('hex')}`; issued.set(token, 'refresh'); return json(200, { access_token: token, expires_in: 3600 }); }
    const entry = codes.get(form.get('code'));
    codes.delete(form.get('code'));
    const verifier = form.get('code_verifier') || '';
    if (!entry || createHash('sha256').update(verifier).digest('base64url') !== entry.challenge || form.get('redirect_uri') !== entry.redirect) return json(400, { error: 'invalid_grant' });
    const token = `at-${randomBytes(6).toString('hex')}`;
    issued.set(token, entry.resource);
    const idToken = `e30.${Buffer.from(JSON.stringify({ email: 'person@example.com' })).toString('base64url')}.sig`;
    return json(200, { access_token: token, refresh_token: `rt-${randomBytes(6).toString('hex')}`, expires_in: 3600, ...(entry.resource === 'google' ? { id_token: idToken } : {}) });
  }
  if (url.pathname === '/revoke') { res.writeHead(200); return res.end(); }
  // MCP servers.
  if (url.pathname === '/notion/mcp' || url.pathname === '/keyed/mcp' || url.pathname === '/plain/mcp') {
    const auth = String(req.headers.authorization || '');
    if (url.pathname === '/notion/mcp' && !issued.has(auth.replace(/^Bearer /, ''))) return json(401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer resource_metadata="${fixtureOrigin}/.well-known/oauth-protected-resource/notion/mcp"` });
    if (url.pathname === '/keyed/mcp' && auth !== `Bearer ${SECRETS.key}`) return json(401, { error: 'invalid api key' });
    if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
    const request = JSON.parse(await body(req));
    if (request.id === undefined) { res.writeHead(202); return res.end(); }
    const names = url.pathname === '/notion/mcp' ? ['notion_search', 'notion_fetch'] : url.pathname === '/keyed/mcp' ? ['docs_search'] : ['plain_echo'];
    return json(200, { jsonrpc: '2.0', id: request.id, result: rpc(request, names) });
  }
  if (url.pathname === '/legacy/sse' && req.method === 'GET') {
    const id = String(sseClients.size + 1);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(`event: endpoint\ndata: /legacy/messages?sid=${id}\n\n`);
    sseClients.set(id, res); req.on('close', () => sseClients.delete(id)); return undefined;
  }
  if (url.pathname === '/legacy/sse') return json(405, { error: 'use GET' });
  if (url.pathname === '/legacy/messages' && req.method === 'POST') {
    const request = JSON.parse(await body(req)); const client = sseClients.get(url.searchParams.get('sid'));
    res.writeHead(202); res.end();
    if (client && request.id !== undefined) client.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: rpc(request, ['legacy_lookup']) })}\n\n`);
    return undefined;
  }
  return json(404, { error: 'fixture route not found' });
});
await new Promise((resolveListen) => fixture.listen(0, '127.0.0.1', resolveListen));
fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`;

// --------------------------------------------------------------------- check
const bridge = await startBridge({
  prepare: async (directory) => ({
    AUTOHAND_SQUAD_MCP_REGISTRY_URL: `${fixtureOrigin}/registry/v0/servers`,
    AUTOHAND_SQUAD_GOOGLE_OAUTH_BASE: fixtureOrigin,
    AUTOHAND_SQUAD_VAULT_KEY_SOURCE: 'file',
    AUTOHAND_SQUAD_VAULT_KEY_FILE: join(directory, 'vault.key'),
    AUTOHAND_SQUAD_GOOGLE_CLIENT_ID: '',
  }),
});
let browser;
const step = (label) => console.log(`- ${label}`);
try {
  browser = await startBrowser();
  const { evaluate } = browser;
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('autohandSquad.v1.onboarding', '{"version":1,"status":"skipped","lastStep":"skipped"}');
    window.__opened = [];
    window.open = (url) => { window.__opened.push(String(url)); return null; };
  ` });
  const text = () => evaluate('document.body.innerText');
  const noSecrets = async (label) => { const page = await evaluate('document.documentElement.outerHTML'); for (const [name, secret] of Object.entries(SECRETS)) assert.ok(!page.includes(secret), `${label}: the ${name} secret is not in the page`); };
  const clickIn = (scope, label) => evaluate(`(() => { const root = ${scope}; const button = [...root.querySelectorAll('button')].find((item) => (item.innerText.trim() === ${JSON.stringify(label)} || item.getAttribute('aria-label') === ${JSON.stringify(label)}) && item.getBoundingClientRect().width && !item.disabled); if (!button) throw new Error('Missing button ' + ${JSON.stringify(label)}); button.click(); return true; })()`);
  // Target each dialog by name: a closing dialog stays in the page for its exit animation.
  const installDialog = "document.querySelector('[data-testid=connector-install-dialog]')";
  const customDialog = "document.querySelector('[data-testid=custom-connector-dialog]')";
  const followSignIn = async () => {
    const url = await until(() => evaluate('window.__opened.at(-1) || ""'), 'sign-in page opened');
    await evaluate('window.__opened.length = 0');
    // The person's browser: the provider's page redirects to Squad's callback.
    const approve = await fetch(url, { redirect: 'manual' });
    const callback = approve.headers.get('location');
    assert.ok(callback.startsWith(`${bridge.origin}/api/connectors/oauth/callback?`), callback);
    const page = await (await fetch(callback)).text();
    assert.match(page, /Signed in to/);
    return { url, page };
  };
  const row = (name) => `[...document.querySelectorAll('[data-testid=connector-row]')].find((item) => item.querySelector('p')?.textContent === ${JSON.stringify(name)})`;
  const health = (name) => evaluate(`${row(name)}?.dataset.health || ''`);

  await browser.navigate(`${bridge.origin}/settings/connectors`);
  await until(() => evaluate(`document.querySelectorAll('[data-testid=catalog-row]').length >= 4`), 'catalogue rows', 60000);
  step('catalogue');
  const catalogue = await evaluate(`[...document.querySelectorAll('[data-testid=catalog-row]')].map((item) => ({ name: item.dataset.catalogName, title: item.querySelector('.font-medium').textContent, logo: item.querySelector('[data-connector-logo]').dataset.connectorLogo }))`);
  assert.deepEqual(catalogue.slice(0, 3).map((item) => item.title), ['Gmail', 'Google Drive', 'Google Calendar'], 'Squad\'s Google connectors lead');
  assert.deepEqual(catalogue.slice(0, 3).map((item) => item.logo), ['gmail', 'googledrive', 'googlecalendar'], 'with their brand marks');
  assert.ok(catalogue.some((item) => item.name === 'com.notion/mcp' && item.title === 'Notion' && item.logo === 'notion'), 'the featured Notion entry uses Squad\'s wording and mark');
  assert.ok(!catalogue.some((item) => item.name === 'io.example/floating'), 'an unpinned package is never offered');
  assert.match(await text(), /Custom connector/);
  await browser.screenshot(join(shots, 'connectors-catalogue-1280.png'));

  step('search');
  await browser.fill('input[aria-label="Search connectors"]', 'keyed');
  await until(async () => (await evaluate(`[...document.querySelectorAll('[data-testid=catalog-row]')].map((item) => item.dataset.catalogName).join(',')`)) === 'io.example/keyed', 'search narrows to the keyed server');
  await browser.fill('input[aria-label="Search connectors"]', '');
  await until(() => evaluate(`!!document.querySelector('[data-catalog-name="com.notion/mcp"]')`), 'full catalogue again');

  step('hosted OAuth install');
  await clickIn('document', 'Add Notion');
  await until(() => evaluate(`${installDialog}?.innerText.includes('Hosted') || ${installDialog}?.innerText.includes('own server')`), 'install dialog');
  assert.ok(!(await evaluate(`${installDialog}.querySelector('input')`)), 'a hosted OAuth server asks nothing');
  await browser.screenshot(join(shots, 'connectors-install-notion.png'));
  await clickIn(installDialog, 'Add');
  await until(() => evaluate(`!!document.querySelector('[data-testid=connector-signin-waiting]')`), 'waiting for sign-in');
  await browser.screenshot(join(shots, 'connectors-signin-waiting.png'));
  const signedIn = await followSignIn();
  assert.match(new URL(signedIn.url).searchParams.get('code_challenge_method'), /S256/);
  assert.equal(new URL(signedIn.url).searchParams.get('resource'), `${fixtureOrigin}/notion/mcp`);
  await until(() => evaluate(`${installDialog}?.innerText.includes('Notion is ready')`), 'Notion ready', 30000);
  assert.match(await evaluate(`${installDialog}.innerText`), /2 tools/);
  await clickIn(installDialog, 'Done');
  await until(async () => (await health('Notion')) === 'ready', 'Notion row ready');
  assert.equal(await evaluate(`${row('Notion')}.querySelector('[role=switch]').getAttribute('aria-checked')`), 'true', 'a connector that passes its check is on');
  assert.ok(await evaluate(`!!document.querySelector('[data-catalog-name="com.notion/mcp"] [aria-label="Notion added"]')`), 'the catalogue marks it added');

  step('custom address with transport detection');
  await clickIn('document', 'Add a custom connector');
  await until(() => evaluate(`!!document.querySelector('[data-testid=custom-connector-dialog]')`), 'custom dialog');
  await browser.fill('#custom-connector-name', 'Legacy lookup');
  await browser.fill('#custom-connector-url', `${fixtureOrigin}/legacy/sse`);
  await clickIn(customDialog, 'Check');
  await until(() => evaluate(`document.querySelector('[data-testid=custom-connector-check]')?.innerText || ''`), 'check result', 30000);
  assert.match(await evaluate(`document.querySelector('[data-testid=custom-connector-check]').innerText`), /Works · SSE · 1 tool \(legacy_lookup\)/);
  await browser.screenshot(join(shots, 'connectors-custom-address.png'));
  await clickIn(customDialog, 'Add');
  await until(async () => (await health('Legacy lookup')) === 'ready', 'legacy server ready', 30000);

  step('pasted config');
  await clickIn('document', 'Add a custom connector');
  await until(() => evaluate(`!!document.querySelector('[data-testid=custom-connector-dialog]')`), 'custom dialog');
  await evaluate(`[...document.querySelectorAll('[role=tab]')].find((tab) => tab.textContent === 'Paste config').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await until(() => evaluate(`!!document.querySelector('#custom-connector-config')`), 'paste tab');
  await browser.fill('#custom-connector-config', JSON.stringify({ mcpServers: { 'Plain echo': { url: `${fixtureOrigin}/plain/mcp` } } }));
  await clickIn(customDialog, 'Add');
  await until(async () => (await health('Plain echo')) === 'ready', 'pasted server ready', 30000);

  step('a wrong key, then the fix');
  await clickIn('document', 'Add Keyed Docs');
  await until(() => evaluate(`!!document.querySelector('#install-Authorization')`), 'key input');
  await browser.fill('#install-Authorization', SECRETS.bad);
  assert.equal(await evaluate(`document.querySelector('#install-Authorization').type`), 'password', 'a secret input is masked');
  await until(() => evaluate(`[...${installDialog}.querySelectorAll('button')].some((item) => item.innerText.trim() === 'Add' && !item.disabled)`), 'Add enabled');
  await clickIn(installDialog, 'Add');
  await until(() => evaluate(`${installDialog}?.innerText.includes("isn't ready yet")`), 'install error', 30000);
  assert.match(await evaluate(`${installDialog}.innerText`), /refused the key or token/);
  await clickIn(installDialog, 'Done');
  await until(async () => (await health('Keyed Docs')) === 'failing', 'failing row');
  assert.equal(await evaluate(`${row('Keyed Docs')}.querySelector('[role=switch]').getAttribute('aria-checked')`), 'false', 'a failing connector stays off');
  await browser.screenshot(join(shots, 'connectors-failing-row.png'));
  await clickIn(row('Keyed Docs'), 'Edit');
  await until(() => evaluate(`!!document.querySelector('[data-testid=custom-connector-dialog]')`), 'edit dialog');
  assert.match(await evaluate(`document.querySelector('input[aria-label="Header 1 value"]').placeholder`), /Stored \(…0000\)/, 'the stored key shows only its hint');
  await browser.fill('input[aria-label="Header 1 value"]', `Bearer ${SECRETS.key}`);
  await clickIn(customDialog, 'Save');
  await until(async () => (await health('Keyed Docs')) === 'ready', 'fixed row ready', 30000);
  await until(async () => (await evaluate(`${row('Keyed Docs')}.querySelector('[role=switch]').getAttribute('aria-checked')`)) === 'true', 'a fixed connector goes on');
  await until(() => evaluate(`!${customDialog}`), 'edit dialog gone');
  await noSecrets('after editing the key');

  step('Gmail through Squad\'s Google connector');
  await clickIn('document', 'Add Gmail');
  await until(() => evaluate(`!!document.querySelector('[data-testid=connector-install-dialog]')`), 'Gmail dialog');
  await evaluate(`[...${installDialog}.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Squad connector').click()`);
  await until(() => evaluate(`!!document.querySelector('#google-client-id')`), 'Google client fields');
  await browser.fill('#google-client-id', '1234-fixture.apps.googleusercontent.com');
  await browser.fill('#google-client-secret', SECRETS.googleSecret);
  await browser.screenshot(join(shots, 'connectors-gmail-client.png'));
  await clickIn(installDialog, 'Add');
  await until(() => evaluate(`!!document.querySelector('[data-testid=connector-signin-waiting]')`), 'waiting for Google sign-in');
  const google = await followSignIn();
  const authorize = new URL(google.url);
  assert.equal(authorize.searchParams.get('access_type'), 'offline'); assert.equal(authorize.searchParams.get('client_id'), '1234-fixture.apps.googleusercontent.com');
  assert.equal(seen.googleScopes, 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose');
  await until(() => evaluate(`${installDialog}?.innerText.includes('Gmail is ready')`), 'Gmail ready', 30000);
  assert.match(await evaluate(`${installDialog}.innerText`), /4 tools · signed in as person@example\.com/);
  await clickIn(installDialog, 'Done');
  await until(async () => (await health('Gmail')) === 'ready', 'Gmail row ready');
  assert.match(await evaluate(`${row('Gmail')}.innerText`), /person@example\.com/);
  await until(() => evaluate(`!${installDialog}`), 'Gmail dialog gone');
  await noSecrets('after Google sign-in');

  step('rename keeps the connector');
  const before = await evaluate(`${row('Plain echo')}.dataset.connectorId`);
  const listed = await bridge.api('/api/connectors');
  assert.ok(listed.data.connectors.some((item) => item.id === before));
  await bridge.api(`/api/connectors/${before}/rename`, 'POST', { name: 'Echo' });
  assert.equal((await bridge.api(`/api/connectors/${before}`)).data.serverName, `squad-connector-${before}`);

  step('screenshots and phone width');
  await browser.navigate(`${bridge.origin}/settings/connectors`);
  await until(async () => (await health('Notion')) === 'ready', 'list after reload', 30000);
  await browser.screenshot(join(shots, 'connectors-list-1280.png'));
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await until(() => evaluate(`document.querySelectorAll('[data-testid=connector-row]').length >= 5`), 'rows at phone width');
  await new Promise((resolveLater) => setTimeout(resolveLater, 400));
  assert.ok(await evaluate(`document.scrollingElement.scrollWidth <= window.innerWidth + 1`), 'no horizontal scroll at 390 px');
  await browser.screenshot(join(shots, 'connectors-list-390.png'));
  await noSecrets('final page');
  assert.deepEqual(browser.errors, [], `no page errors: ${browser.errors.join(' | ')}`);
  console.log(`check-connectors-browser passed: catalogue with Squad's Google connectors and registry marks, search, hosted OAuth install with no typing (${seen.registrations} registrations), SSE detected for a custom address, pasted config, wrong key -> Edit -> ready, Gmail with a Google client and account shown, rename keeps the server name, phone width. Screenshots: ${shots}`);
} catch (error) {
  if (browser) await browser.screenshot(join(shots, 'connectors-failure.png')).catch(() => {});
  console.error(bridge.logs.slice(-3000));
  throw error;
} finally {
  await browser?.close();
  await bridge.close();
  for (const client of sseClients.values()) client.end();
  await new Promise((resolveClose) => fixture.close(resolveClose));
}
