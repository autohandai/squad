#!/usr/bin/env node
// Connector sign-in (ADR-0244): oauth.mjs over a real connector store (temp
// dir, test keyring) against a fixture authorization server and MCP
// resources on 127.0.0.1. Covers discovery (RFC 9728 hint and well-known,
// RFC 8414), dynamic registration (RFC 7591), PKCE S256, single-use state,
// refresh single-flight and failure handling, the device grant (RFC 8628),
// Squad's Google sign-in and revocation (RFC 7009). Nothing reaches the
// network and the person's keychain is never touched.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createConnectorOAuth, internalHost, safeEndpoint } from '../server/connectors/oauth.mjs';
import { createConnectorStore } from '../server/connectors/store.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const directory = await mkdtemp(join(tmpdir(), 'squad-connector-oauth-'));
const key = randomBytes(32);
const keyring = { load: async () => ({ key, source: 'test' }), source: () => 'test', sources: ['test'], forget() {} };
const b64url = (value) => Buffer.from(value).toString('base64url');
const sha = (value) => createHash('sha256').update(value).digest('base64url');

// ------------------------------------------------------------------ fixture
const seen = { registrations: [], tokenForms: [], tokenAuth: [], revoked: [], refreshes: 0, deviceStarts: 0 };
const clients = new Map(); // client_id -> { redirectUris, secret, method }
const codes = new Map(); // code -> authorize params
const issued = new Set(); // every token text the fixture handed out
const refreshPlan = []; // per refresh request: 'ok' | 'drop' | { status, body } ; empty = 'ok'
const devicePlans = []; // per device sign-in: list of token-poll answers
const deviceCodes = new Map();
let refreshDelayMs = 0, counter = 0, revocationStatus = 200;
const readBody = (req) => new Promise((r) => { let data = ''; req.on('data', (c) => { data += c; }); req.on('end', () => r(data)); });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  const path = url.pathname;
  const body = req.method === 'POST' ? await readBody(req) : '';
  const json = (status, value, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(value)); };
  const bearer = String(req.headers.authorization || '');
  const tokenOk = bearer.startsWith('Bearer at-') && issued.has(bearer.slice(7));
  // MCP resources
  if (path.startsWith('/mcp/') && req.method === 'POST') {
    const name = path.slice(5);
    if (name === 'open' || tokenOk) return json(200, { jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fixture' } } });
    if (['hinted', 'device', 'device-b', 'nodcr', 'nos256'].includes(name)) {
      const issuer = { nodcr: 'nodcr', nos256: 'nos256' }[name] || 'as';
      return json(401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer error="invalid_token", resource_metadata="${origin}/meta/${name}?as=${issuer}", scope="mcp:read mcp:write"` });
    }
    if (name === 'scopes') return json(401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer resource_metadata="${origin}/meta/scopes?as=as"` });
    return json(401, { error: 'unauthorized' }); // plain, keyed: no hint and no metadata
  }
  if (path.startsWith('/meta/')) {
    const resource = `${origin}/mcp/${path.slice(6)}`;
    return json(200, { resource, authorization_servers: [`${origin}/${url.searchParams.get('as')}`], scopes_supported: ['read', 'write'], bearer_methods_supported: ['header'] });
  }
  if (path === '/.well-known/oauth-protected-resource/mcp/open') return json(200, { resource: `${origin}/mcp/open`, authorization_servers: [`${origin}/as`] });
  const metadata = path.match(/^\/\.well-known\/oauth-authorization-server\/(as|nodcr|nos256)$/);
  if (metadata) {
    const issuer = `${origin}/${metadata[1]}`;
    return json(200, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${origin}/as/token`,
      ...(metadata[1] === 'nodcr' ? {} : { registration_endpoint: `${origin}/as/register` }),
      revocation_endpoint: `${origin}/as/revoke`,
      device_authorization_endpoint: `${origin}/as/device`,
      code_challenge_methods_supported: metadata[1] === 'nos256' ? ['plain'] : ['S256'],
    });
  }
  if (path === '/as/register' && req.method === 'POST') {
    const input = JSON.parse(body);
    seen.registrations.push(input);
    const clientId = `client-${++counter}`;
    // The second registration answers with a confidential client to exercise Basic auth.
    const confidential = seen.registrations.length === 2;
    clients.set(clientId, { redirectUris: input.redirect_uris, secret: confidential ? `client-secret-${counter}` : '', method: confidential ? 'client_secret_basic' : 'none' });
    return json(201, { client_id: clientId, ...(confidential ? { client_secret: `client-secret-${counter}`, token_endpoint_auth_method: 'client_secret_basic' } : {}) });
  }
  if ((path === '/as/token' || path === '/google/token') && req.method === 'POST') {
    const form = Object.fromEntries(new URLSearchParams(body));
    seen.tokenForms.push(form);
    seen.tokenAuth.push(req.headers.authorization || '');
    const mint = (extra = {}) => {
      const access = `at-${++counter}-${randomBytes(6).toString('hex')}`, refresh = `rt-${counter}-${randomBytes(6).toString('hex')}`;
      issued.add(access); issued.add(refresh);
      return json(200, { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600, ...extra });
    };
    if (form.grant_type === 'authorization_code') {
      const entry = codes.get(form.code);
      codes.delete(form.code);
      if (!entry) return json(400, { error: 'invalid_grant', error_description: 'unknown code' });
      if (sha(form.code_verifier || '') !== entry.code_challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE verifier mismatch' });
      if (form.redirect_uri !== entry.redirect_uri) return json(400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      if (path === '/google/token') {
        if (form.client_secret !== 'google-secret' || form.client_id !== entry.client_id) return json(401, { error: 'invalid_client' });
        return mint({ id_token: `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify({ email: 'ana@example.com', sub: '1' }))}.` });
      }
      const client = clients.get(form.client_id || Buffer.from(String(req.headers.authorization || '').slice(6), 'base64').toString().split(':')[0]);
      if (!client) return json(401, { error: 'invalid_client' });
      if (client.method === 'client_secret_basic' && req.headers.authorization !== `Basic ${Buffer.from(`${entry.client_id}:${client.secret}`).toString('base64')}`) return json(401, { error: 'invalid_client' });
      if (form.resource !== entry.resource) return json(400, { error: 'invalid_target' });
      return mint();
    }
    if (form.grant_type === 'refresh_token') {
      seen.refreshes += 1;
      if (refreshDelayMs) await new Promise((r) => setTimeout(r, refreshDelayMs));
      const step = refreshPlan.shift() || 'ok';
      if (step === 'drop') { req.socket.destroy(); return undefined; }
      if (step !== 'ok') return json(step.status, step.body || {});
      if (!issued.has(form.refresh_token)) return json(400, { error: 'invalid_grant' });
      issued.delete(form.refresh_token); // rotation: the old refresh token is spent
      return mint();
    }
    if (form.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
      const plan = deviceCodes.get(form.device_code);
      const step = plan?.shift();
      if (step === 'ok') return mint();
      return json(400, { error: step || 'expired_token' });
    }
    return json(400, { error: 'unsupported_grant_type' });
  }
  if (path === '/as/device' && req.method === 'POST') {
    seen.deviceStarts += 1;
    const deviceCode = `dc-${++counter}`;
    deviceCodes.set(deviceCode, devicePlans.shift() || []);
    return json(200, { device_code: deviceCode, user_code: `WXYZ-${counter}`, verification_uri: `${origin}/device`, expires_in: 600, interval: 1 });
  }
  if ((path === '/as/revoke' || path === '/google/revoke') && req.method === 'POST') {
    seen.revoked.push(Object.fromEntries(new URLSearchParams(body)).token);
    return json(revocationStatus, {});
  }
  return json(404, { error: 'not found' });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// ------------------------------------------------------------------- set up
let clock = Date.now();
let callback = 'http://127.0.0.1:4555/api/connectors/oauth/callback';
let googleClient = null;
const events = [], sleeps = [];
const store = createConnectorStore({ stateDir: join(directory, 'state'), rootDir: root, keyring, now: () => clock });
const oauth = createConnectorOAuth({
  store, now: () => clock, callbackUrl: () => callback,
  googleClient: async () => googleClient,
  googleEndpoints: { issuer: `${origin}/google`, authorization: `${origin}/google/auth`, token: `${origin}/google/token`, revocation: `${origin}/google/revoke` },
  deviceApps: [{ id: 'fixture', issuer: `${origin}/as`, resource: `${origin}/mcp/device`, clientId: 'device-client', deviceEndpoint: `${origin}/as/device`, tokenEndpoint: `${origin}/as/token`, scopes: ['repo', 'read:user'] }],
  emit: (event) => events.push(event),
  sleep: (ms) => { sleeps.push(ms); return new Promise((r) => setTimeout(r, 5)); },
});
const fileText = () => readFile(store.file, 'utf8');
/** What the browser does after the person approves: the server mints a code for those parameters. */
function approve(link) {
  const params = Object.fromEntries(new URL(link).searchParams);
  const code = `code-${randomBytes(8).toString('hex')}`;
  codes.set(code, params);
  return { code, state: params.state, params };
}
async function signIn(id) {
  const started = await oauth.start(id);
  const { code, state } = approve(started.url);
  return oauth.finish({ state, code });
}
const tokensOf = async (id) => (await store.secrets(id)).oauth || {};
const covered = [];

try {
  // ---------------------------------------------------------------- discover
  const hinted = await oauth.discover(`${origin}/mcp/hinted`);
  assert.deepEqual([hinted.required, hinted.reachable, hinted.challenge.scope], [true, true, 'mcp:read mcp:write'], '401 with resource_metadata hint: sign-in');
  assert.equal(hinted.challenge.resourceMetadata, `${origin}/meta/hinted?as=as`);
  assert.deepEqual(await oauth.discover(`${origin}/mcp/plain`), { required: false, needsKey: true, reachable: true }, '401 without metadata: a key, not sign-in');
  assert.deepEqual(await oauth.discover(`${origin}/mcp/keyed`, { Authorization: 'Bearer user-key' }), { required: false, rejectedKey: true, reachable: true });
  assert.equal((await oauth.discover(`${origin}/mcp/hinted`, { authorization: 'Bearer user-key' })).rejectedKey, true, 'even when the server could sign in, a typed key is what was refused');
  assert.deepEqual(await oauth.discover(`${origin}/mcp/open`), { required: true, reachable: true }, '200 with well-known resource metadata: sign-in');
  assert.deepEqual(await oauth.discover(`${origin}/mcp/open`, { 'X-Api-Key': 'k' }), { required: false, reachable: true }, '200 with the person\'s header: no sign-in');
  assert.deepEqual(await oauth.discover('http://127.0.0.1:1/mcp'), { required: false, reachable: false });
  covered.push('discover');

  // ------------------------------------------------------------------- start
  const linear = await store.create({ name: 'Fixture Linear', kind: 'url', url: `${origin}/mcp/hinted`, headers: [{ name: 'X-Team', value: 'core' }] });
  const first = await oauth.start(linear.id);
  assert.equal(first.mode, 'browser');
  assert.equal(seen.registrations.length, 1);
  assert.deepEqual(seen.registrations[0].redirect_uris, [callback]);
  assert.equal(seen.registrations[0].token_endpoint_auth_method, 'none');
  assert.deepEqual(seen.registrations[0].grant_types, ['authorization_code', 'refresh_token']);
  const link = new URL(first.url);
  assert.equal(link.origin + link.pathname, `${origin}/as/authorize`);
  const params = Object.fromEntries(link.searchParams);
  assert.deepEqual([params.response_type, params.client_id, params.redirect_uri, params.code_challenge_method, params.resource, params.scope], ['code', 'client-1', callback, 'S256', `${origin}/mcp/hinted`, 'mcp:read mcp:write']);
  assert.match(params.code_challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.match(params.state, /^[A-Za-z0-9_-]{32}$/);
  const second = await oauth.start(linear.id);
  assert.equal(seen.registrations.length, 1, 'the registration is reused for the same callback');
  assert.equal(new URL(second.url).searchParams.get('client_id'), 'client-1');
  assert.notEqual(new URL(second.url).searchParams.get('state'), params.state);
  assert.equal(oauth.pendingCount(), 1, 'a new start replaces the connector\'s earlier pending sign-in');
  await assert.rejects(oauth.finish({ state: params.state, code: 'whatever' }), (error) => error.status === 410, 'the replaced state is dead');
  callback = 'http://127.0.0.1:4556/api/connectors/oauth/callback';
  const third = await oauth.start(linear.id);
  assert.equal(seen.registrations.length, 2, 'a different callback URL registers again');
  assert.deepEqual(seen.registrations[1].redirect_uris, [callback]);
  assert.equal(new URL(third.url).searchParams.get('client_id'), 'client-2');
  const scoped = await store.create({ name: 'Scoped', kind: 'url', url: `${origin}/mcp/scopes` });
  assert.equal(new URL((await oauth.start(scoped.id)).url).searchParams.get('scope'), 'read write', 'without a challenge scope, the resource\'s scopes_supported');
  const noDcr = await store.create({ name: 'No DCR', kind: 'url', url: `${origin}/mcp/nodcr` });
  await assert.rejects(oauth.start(noDcr.id), (error) => error.status === 409 && /doesn't let new apps sign in by themselves/.test(error.message));
  const noS256 = await store.create({ name: 'No S256', kind: 'url', url: `${origin}/mcp/nos256` });
  await assert.rejects(oauth.start(noS256.id), (error) => error.status === 502 && /doesn't support PKCE/.test(error.message));
  const local = await store.create({ name: 'Local', kind: 'stdio', command: 'node', args: ['x.js'] });
  await assert.rejects(oauth.start(local.id), /nothing to sign in to/);
  covered.push('start');

  // ------------------------------------------------------------------ finish
  const approved = approve(third.url);
  const wrongVerifier = await oauth.start(scoped.id); // a different connector's pending sign-in stays intact
  const signedIn = await oauth.finish({ state: approved.state, code: approved.code });
  assert.equal(signedIn.oauth.status, 'signed-in');
  const form = seen.tokenForms.at(-1);
  assert.equal(form.grant_type, 'authorization_code');
  assert.equal(form.redirect_uri, callback);
  assert.equal(sha(form.code_verifier), approved.params.code_challenge, 'the verifier matches the S256 challenge');
  assert.equal(form.client_id, undefined, 'a client_secret_basic client authenticates with a header');
  assert.match(seen.tokenAuth.at(-1), /^Basic /);
  const tokens = await tokensOf(linear.id);
  assert.match(tokens.accessToken, /^at-/); assert.match(tokens.refreshToken, /^rt-/);
  assert.equal(tokens.clientSecret, 'client-secret-2');
  let text = await fileText();
  for (const secret of [tokens.accessToken, tokens.refreshToken, tokens.clientSecret]) assert.ok(!text.includes(secret), 'connectors.json holds no token or client secret in clear');
  assert.ok(JSON.parse(text).connectors.find((item) => item.id === linear.id).sealed, 'the record carries a sealed blob');
  assert.equal((await store.get(linear.id)).oauth.status, 'signed-in');
  assert.ok(!JSON.stringify(await store.get(linear.id)).includes(tokens.accessToken), 'the public record carries no token');
  assert.deepEqual(events.at(-1), { id: linear.id, outcome: 'signed-in' });
  await assert.rejects(oauth.finish({ state: approved.state, code: approved.code }), (error) => error.status === 410, 'a replayed state is refused');
  await assert.rejects(oauth.finish({ state: 'forged-state', code: 'x' }), (error) => error.status === 410, 'a forged state is refused');
  await assert.rejects(oauth.finish({ state: '', code: 'x' }), (error) => error.status === 410);
  // The token endpoint refuses a code redeemed with the wrong verifier.
  const tampered = approve(wrongVerifier.url);
  codes.get(tampered.code).code_challenge = sha('someone-else');
  await assert.rejects(oauth.finish({ state: tampered.state, code: tampered.code }), (error) => error.status === 502 && /PKCE verifier mismatch/.test(error.message));
  const cancelled = await oauth.start(scoped.id);
  await assert.rejects(oauth.finish({ state: new URL(cancelled.url).searchParams.get('state'), error: 'access_denied' }), (error) => error.message === 'Sign-in was cancelled.' && error.status === 400);
  assert.equal((await store.get(scoped.id)).oauth.lastError, 'Sign-in was cancelled.');
  covered.push('finish');

  // An address edited while a sign-in is open: the old server's tokens are never stored.
  const racing = await store.create({ name: 'Racing', kind: 'url', url: `${origin}/mcp/hinted` });
  const pendingRace = await oauth.start(racing.id);
  await store.update(racing.id, { url: `${origin}/mcp/hinted?moved=1` });
  const raced = approve(pendingRace.url);
  await assert.rejects(oauth.finish({ state: raced.state, code: raced.code }), (error) => error.status === 409 && /changed while signing in/.test(error.message));
  assert.equal((await tokensOf(racing.id)).accessToken, undefined, 'no tokens stored for the edited connector');
  assert.notEqual((await store.get(racing.id)).oauth?.status, 'signed-in');
  for (let waited = 0; waited < 40 && !seen.revoked.length; waited += 1) await new Promise((r) => setTimeout(r, 25));
  assert.ok(seen.revoked.length >= 1, 'the tokens granted for the old address are handed back');
  const revokedBefore = seen.revoked.length;
  // A header edit retires a pending sign-in too.
  const racing2 = await oauth.start(racing.id);
  await store.update(racing.id, { headers: [{ name: 'X-Team', value: 'other' }] });
  const raced2 = approve(racing2.url);
  await assert.rejects(oauth.finish({ state: raced2.state, code: raced2.code }), (error) => error.status === 409);
  covered.push('edit race');

  // ------------------------------------------------------------------- fresh
  const before = await tokensOf(linear.id);
  let refreshes = seen.refreshes;
  assert.deepEqual(await oauth.fresh(linear.id), { accessToken: before.accessToken, expiresAt: Math.floor(clock / 1000) + 3600 });
  assert.equal(seen.refreshes, refreshes, 'no refresh far from expiry');
  clock += (3600 - 30) * 1000;
  const renewed = await oauth.fresh(linear.id);
  assert.equal(seen.refreshes, refreshes + 1, 'a refresh within 60 s of expiry');
  assert.notEqual(renewed.accessToken, before.accessToken);
  let after = await tokensOf(linear.id);
  assert.equal(after.accessToken, renewed.accessToken);
  assert.notEqual(after.refreshToken, before.refreshToken, 'the rotated refresh token is stored');
  assert.equal(seen.tokenForms.at(-1).refresh_token, before.refreshToken);
  assert.equal(seen.tokenForms.at(-1).resource, `${origin}/mcp/hinted`);
  assert.ok(!(await fileText()).includes(after.refreshToken));
  refreshes = seen.refreshes;
  const forced = await oauth.fresh(linear.id, { stale: true });
  assert.equal(seen.refreshes, refreshes + 1, 'stale forces a refresh');
  assert.notEqual(forced.accessToken, renewed.accessToken);
  // Single flight: two callers, one token request (rotating servers revoke the old refresh token on use).
  refreshes = seen.refreshes;
  refreshDelayMs = 150;
  const [one, two] = await Promise.all([oauth.fresh(linear.id, { stale: true }), oauth.fresh(linear.id, { stale: true })]);
  refreshDelayMs = 0;
  assert.equal(seen.refreshes, refreshes + 1, 'two concurrent fresh calls make one token request');
  assert.equal(one.accessToken, two.accessToken);
  assert.equal((await store.get(linear.id)).oauth.status, 'signed-in');
  // One 503 is retried once within the same call, which then renews.
  clock += (3600 - 30) * 1000;
  const current = await tokensOf(linear.id);
  refreshPlan.push({ status: 503, body: { error: 'temporarily_unavailable' } });
  refreshes = seen.refreshes;
  const recovered = await oauth.fresh(linear.id);
  assert.notEqual(recovered.accessToken, current.accessToken, 'a single 503 is retried and the call renews');
  assert.equal(seen.refreshes, refreshes + 2);
  assert.equal((await store.get(linear.id)).oauth.status, 'signed-in');
  // Two 503s while the token still works: keep the old one.
  clock += (3600 - 30) * 1000;
  const stillValid = await tokensOf(linear.id);
  refreshPlan.push({ status: 503 }, { status: 503 });
  assert.equal((await oauth.fresh(linear.id)).accessToken, stillValid.accessToken, 'a busy server keeps the still-valid token');
  assert.equal((await store.get(linear.id)).oauth.status, 'signed-in');
  // 503s when the server already refused the token: a plain retry-later error, sign-in kept.
  refreshPlan.push({ status: 503 }, { status: 503 });
  await assert.rejects(oauth.fresh(linear.id, { stale: true }), (error) => error.status === 503 && /try again on the next request/.test(error.message));
  assert.equal((await store.get(linear.id)).oauth.status, 'signed-in');
  assert.ok((await tokensOf(linear.id)).refreshToken, 'tokens survive a temporary failure');
  // A network failure with a still-valid token (still 30 s from expiry): the old token, after one retry.
  const valid = await tokensOf(linear.id);
  refreshPlan.push('drop', 'drop');
  sleeps.length = 0;
  assert.equal((await oauth.fresh(linear.id)).accessToken, valid.accessToken);
  assert.deepEqual(sleeps, [1000], 'one pause between the two attempts');
  assert.equal(refreshPlan.length, 0, 'both attempts reached the server');
  // invalid_grant: the sign-in ended.
  refreshPlan.push({ status: 400, body: { error: 'invalid_grant' } });
  await assert.rejects(oauth.fresh(linear.id, { stale: true }), (error) => error.status === 401 && /ended the sign-in/.test(error.message));
  let record = await store.get(linear.id);
  assert.deepEqual([record.oauth.status, record.oauth.expiresAt], ['expired', null]);
  assert.match(record.oauth.lastError, /ended the sign-in/);
  assert.equal((await tokensOf(linear.id)).accessToken, undefined); assert.equal((await tokensOf(linear.id)).refreshToken, undefined);
  assert.equal((await store.raw(linear.id)).oauth.clientId, 'client-2', 'invalid_grant keeps the registration');
  await assert.rejects(oauth.fresh(linear.id), (error) => error.status === 401 && /Sign in to Fixture Linear/.test(error.message));
  // invalid_client: the registration is forgotten so the next sign-in registers again.
  let registered = seen.registrations.length;
  await signIn(linear.id);
  assert.equal(seen.registrations.length, registered, 'signing in again reuses the registration');
  refreshPlan.push({ status: 401, body: { error: 'invalid_client' } });
  await assert.rejects(oauth.fresh(linear.id, { stale: true }), (error) => error.status === 401);
  const rawItem = await store.raw(linear.id);
  assert.equal(rawItem.oauth.clientId, undefined); assert.equal(rawItem.oauth.redirectUris, undefined);
  assert.equal((await tokensOf(linear.id)).clientSecret, undefined);
  registered = seen.registrations.length;
  await signIn(linear.id);
  assert.equal(seen.registrations.length, registered + 1, 'a forgotten registration registers again');
  covered.push('fresh');

  // ---------------------------------------------------------------- sign out
  const live = await tokensOf(linear.id);
  const out = await oauth.signOut(linear.id);
  assert.equal(out.revoked, true);
  assert.equal(seen.revoked.at(-1), live.refreshToken, 'the refresh token is revoked');
  assert.ok(seen.revoked.length > revokedBefore);
  assert.equal(out.connector.oauth.status, 'signed-out');
  assert.equal((await tokensOf(linear.id)).accessToken, undefined);
  assert.equal((await tokensOf(linear.id)).refreshToken, undefined);
  revocationStatus = 500;
  assert.equal(await oauth.revoke({ revocationEndpoint: `${origin}/as/revoke`, clientId: 'c' }, { accessToken: 'a' }), false);
  revocationStatus = 200;
  assert.equal(await oauth.revoke({ revocationEndpoint: 'http://127.0.0.1:1/revoke', clientId: 'c' }, { accessToken: 'a' }), false, 'a revocation endpoint that is down never throws');
  assert.equal(await oauth.revoke({ clientId: 'c' }, { accessToken: 'a' }), false);
  assert.equal(await oauth.revoke(null, null), false);
  await signIn(linear.id);
  const downStore = (await store.raw(linear.id)).oauth.revocationEndpoint;
  assert.equal(downStore, `${origin}/as/revoke`);
  covered.push('sign-out');

  // ------------------------------------------------------------- device grant
  const device = await store.create({ name: 'Device', kind: 'url', url: `${origin}/mcp/device` });
  devicePlans.push(['authorization_pending', 'slow_down', 'ok']);
  sleeps.length = 0;
  const registrations = seen.registrations.length;
  const deviceStart = await oauth.start(device.id);
  assert.deepEqual([deviceStart.mode, deviceStart.verificationUri], ['device', `${origin}/device`]);
  assert.match(deviceStart.userCode, /^WXYZ-/);
  assert.equal(seen.registrations.length, registrations, 'the device app does not register');
  assert.equal(oauth.progress(device.id).waiting, true);
  for (let wait = 0; (await store.get(device.id)).oauth?.status !== 'signed-in'; wait += 1) { assert.ok(wait < 200, 'device sign-in finished'); await new Promise((r) => setTimeout(r, 10)); }
  assert.deepEqual(sleeps, [1000, 1000, 6000], 'interval, then slow_down adds five seconds');
  const deviceRaw = await store.raw(device.id);
  assert.deepEqual([deviceRaw.oauth.mode, deviceRaw.oauth.clientId], ['device', 'device-client']);
  assert.match((await tokensOf(device.id)).accessToken, /^at-/);
  assert.equal(oauth.progress(device.id).waiting, false);
  const denied = await store.create({ name: 'Device B', kind: 'url', url: `${origin}/mcp/device-b` });
  devicePlans.push(['authorization_pending', 'access_denied']);
  await oauth.start(denied.id);
  for (let wait = 0; !oauth.progress(denied.id).error; wait += 1) { assert.ok(wait < 200, 'device denial reported'); await new Promise((r) => setTimeout(r, 10)); }
  assert.deepEqual(oauth.progress(denied.id), { mode: 'device', userCode: oauth.progress(denied.id).userCode, verificationUri: `${origin}/device`, error: 'Sign-in was cancelled.', waiting: false });
  assert.notEqual((await store.get(denied.id)).oauth?.status, 'signed-in');
  assert.deepEqual(events.filter((event) => event.id === denied.id).at(-1), { id: denied.id, outcome: 'failed' });
  covered.push('device grant');

  // ------------------------------------------------------------------ Google
  const { connector: gmail } = await store.install({ kind: 'google', name: 'Gmail', product: 'gmail', description: 'Mail' });
  await assert.rejects(oauth.start(gmail.id), (error) => error.status === 409 && error.code === 'google_client_missing');
  googleClient = { clientId: 'squad-test.apps.googleusercontent.com', clientSecret: 'google-secret' };
  const googleStart = await oauth.start(gmail.id);
  const googleLink = new URL(googleStart.url);
  assert.equal(googleLink.origin + googleLink.pathname, `${origin}/google/auth`);
  const g = Object.fromEntries(googleLink.searchParams);
  assert.deepEqual([g.access_type, g.prompt, g.code_challenge_method, g.client_id, g.redirect_uri], ['offline', 'consent', 'S256', googleClient.clientId, callback]);
  assert.deepEqual(g.scope.split(' '), ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose']);
  const googleApproved = approve(googleStart.url);
  const gmailSigned = await oauth.finish({ state: googleApproved.state, code: googleApproved.code });
  assert.equal(gmailSigned.oauth.status, 'signed-in');
  assert.equal(gmailSigned.oauth.account, 'ana@example.com', 'the id_token email names the account');
  const googleForm = seen.tokenForms.at(-1);
  assert.equal(googleForm.client_secret, 'google-secret');
  assert.equal(googleForm.resource, undefined, 'Google is not sent an MCP resource');
  text = await fileText();
  assert.ok(!text.includes((await tokensOf(gmail.id)).accessToken) && !text.includes('google-secret'));
  // Google refresh uses the current client.
  refreshes = seen.refreshes;
  await oauth.fresh(gmail.id, { stale: true });
  assert.equal(seen.refreshes, refreshes + 1);
  assert.equal(seen.tokenForms.at(-1).client_secret, 'google-secret');
  const gOut = await oauth.signOut(gmail.id);
  assert.equal(gOut.revoked, true);
  assert.equal(gOut.connector.oauth.account, '', 'signing out forgets the account');
  covered.push('google');

  // A refresh still out when the person signs out doesn't sign them back in.
  const racer = await store.create({ name: 'Refresh racer', kind: 'url', url: `${origin}/mcp/hinted` });
  await signIn(racer.id);
  refreshDelayMs = 200;
  const inFlight = oauth.fresh(racer.id, { stale: true });
  await new Promise((r) => setTimeout(r, 50));
  await oauth.signOut(racer.id);
  await assert.rejects(inFlight, (error) => error.status === 401);
  refreshDelayMs = 0;
  assert.equal((await store.get(racer.id)).oauth.status, 'signed-out', 'sign-out wins over a refresh in flight');
  assert.equal((await tokensOf(racer.id)).accessToken, undefined);
  covered.push('refresh race');

  // Endpoints from metadata can't point a public connector at this computer or its network.
  assert.equal(safeEndpoint('https://auth.example.com/token', 'https://mcp.example.com/mcp'), 'https://auth.example.com/token');
  for (const target of ['http://127.0.0.1:9/token', 'https://127.0.0.1/token', 'https://10.0.0.5/token', 'https://192.168.1.2/token', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://[fd00::1]/x', 'https://router.local/x', 'https://metadata.internal/x']) {
    assert.equal(safeEndpoint(target, 'https://mcp.example.com/mcp'), '', `${target} refused for a public connector`);
  }
  assert.equal(safeEndpoint('http://127.0.0.1:9/token', 'http://127.0.0.1:8/mcp'), 'http://127.0.0.1:9/token', 'a local connector may use local endpoints');
  assert.equal(safeEndpoint('http://auth.example.com/token', 'https://mcp.example.com/mcp'), '', 'plain http only on loopback');
  assert.ok(internalHost('172.20.0.1') && !internalHost('172.32.0.1') && internalHost('100.100.1.1') && !internalHost('8.8.8.8'));
  covered.push('endpoint checks');

  // Nothing the fixture issued ever reached connectors.json in clear.
  text = await fileText();
  for (const token of issued) assert.ok(!text.includes(token), 'no issued token in connectors.json');
  assert.equal(JSON.stringify(events).includes('at-'), false, 'events carry no token');

  console.log(`check-connector-oauth passed: ${covered.join(', ')} (${seen.registrations.length} registrations, ${seen.refreshes} refreshes, ${issued.size} tokens issued, none in clear on disk).`);
} finally {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  await rm(directory, { recursive: true, force: true });
}
