// Sign-in for connectors (ADR-0244).
//
// Remote MCP servers sign in with MCP authorization: OAuth 2.1 with PKCE,
// protected resource metadata (RFC 9728) found through the server's
// WWW-Authenticate hint or the well-known paths, authorization server
// metadata (RFC 8414, then OpenID discovery), and dynamic client registration
// (RFC 7591) with the bridge's loopback callback. Servers that don't let apps
// register but where Squad has its own app use the device grant (RFC 8628):
// the person types a code on the server's page and the bridge polls. Squad's
// own Google connectors sign in to Google with the OAuth client the person (or
// the build) provides, offline access, and the narrowest scopes per product.
//
// Tokens are sealed in the connector store; nothing here logs or returns one.
// The PKCE verifier never leaves the bridge, a `state` is single use and
// expires after 15 minutes, and every change after a network round trip is
// checked against the connector's auth revision, so an address edited while a
// sign-in was open never receives the old server's tokens.
import { createHash, randomBytes } from 'node:crypto';

const TIMEOUT_MS = 20_000;
const PENDING_MS = 15 * 60_000;
const EARLY_S = 60;
const REASON_MAX = 300;

export const GOOGLE_SCOPES = {
  gmail: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'],
  drive: ['https://www.googleapis.com/auth/drive.readonly'],
  calendar: ['https://www.googleapis.com/auth/calendar.events'],
};
export const GOOGLE_ENDPOINTS = {
  issuer: 'https://accounts.google.com',
  authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revocation: 'https://oauth2.googleapis.com/revoke',
};

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const b64url = (buffer) => Buffer.from(buffer).toString('base64url');
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');

function isLoopback(hostname) { return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname); }

/** Endpoints from metadata are untrusted: https only (http on loopback for fixtures). */
export function safeEndpoint(value) {
  const raw = text(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.hash) return '';
    return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname)) ? url.toString() : '';
  } catch { return ''; }
}

/** `resource_metadata="…"` and `scope="…"` from a `WWW-Authenticate: Bearer …` header. */
export function parseWwwAuthenticate(header) {
  const value = String(header || '');
  const param = (name) => {
    const match = value.match(new RegExp(`${name}="([^"]*)"`, 'i')) || value.match(new RegExp(`${name}=([^,\\s]+)`, 'i'));
    return match ? match[1] : '';
  };
  return { resourceMetadata: safeEndpoint(param('resource_metadata')), scope: param('scope').slice(0, 500), error: param('error').slice(0, 80) };
}

/** `https://a.b/x/y/` → [`https://a.b`, `/x/y`]. */
export function splitUrl(url) {
  const parsed = new URL(url);
  return [parsed.origin, parsed.pathname.replace(/\/+$/, '')];
}

/** What a refresh answer means (RFC 6749 §5.2). */
export function renewal(status, body) {
  if (status >= 200 && status < 300 && typeof body?.access_token === 'string') return 'renewed';
  if (status >= 500 || status === 408 || status === 429) return 'retry';
  const error = record(body) ? body.error : undefined;
  if (error === undefined || error === 'temporarily_unavailable') return 'retry';
  if (error === 'invalid_client' || error === 'unauthorized_client') return 'unregistered';
  return 'revoked';
}

function decodeJwtEmail(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1] || '', 'base64url').toString('utf8'));
    return typeof payload.email === 'string' ? payload.email.slice(0, 120) : '';
  } catch { return ''; }
}

/**
 * Device-grant apps Squad owns, one per server family. A client id only
 * comes from the environment (a release build sets it); without one the
 * server is reached with a token header instead.
 */
export function deviceAppsFromEnv(env = process.env) {
  const apps = [];
  if (text(env.AUTOHAND_SQUAD_GITHUB_CLIENT_ID)) {
    apps.push({
      id: 'github',
      issuer: 'https://github.com/login/oauth',
      resource: 'https://api.githubcopilot.com/mcp',
      clientId: text(env.AUTOHAND_SQUAD_GITHUB_CLIENT_ID),
      deviceEndpoint: 'https://github.com/login/device/code',
      tokenEndpoint: 'https://github.com/login/oauth/access_token',
      scopes: ['repo', 'read:org', 'read:user', 'user:email', 'read:project', 'gist', 'notifications'],
    });
  }
  return apps;
}

export function createConnectorOAuth({ store, fetchRequest = fetch, now = () => Date.now(), callbackUrl, googleClient = async () => null, googleEndpoints = GOOGLE_ENDPOINTS, deviceApps = [], emit = () => {}, log = () => {}, sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)) }) {
  const pending = new Map(); // state -> sign-in waiting for its callback
  const devices = new Map(); // connector id -> device sign-in being polled
  const refreshing = new Map(); // connector id -> in-flight refresh (single flight)
  const seconds = () => Math.floor(now() / 1000);

  async function request(url, init = {}) {
    return fetchRequest(url, { redirect: 'manual', ...init, signal: AbortSignal.timeout(init.timeoutMs || TIMEOUT_MS) });
  }
  async function getJson(url) {
    const response = await request(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw fail(`${url} answered ${response.status}`);
    return response.json();
  }
  async function postForm(url, form, { basic } = {}) {
    const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
    if (basic) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(basic.id)}:${encodeURIComponent(basic.secret)}`).toString('base64')}`;
    const response = await request(url, { method: 'POST', headers, body: new URLSearchParams(form).toString() });
    const raw = await response.text();
    let body = null;
    try { body = JSON.parse(raw); } catch { body = Object.fromEntries(new URLSearchParams(raw)); }
    return { status: response.status, body: record(body) ? body : {} };
  }

  /** The initialize probe that tells whether a server wants sign-in, and how to find out more. */
  async function probe(url, headers = {}) {
    const response = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'autohand-squad', version: '1' } } }),
    });
    const challenge = parseWwwAuthenticate(response.headers.get('www-authenticate'));
    await response.body?.cancel().catch(() => {});
    return { status: response.status, challenge };
  }

  async function resourceMetadata(url, hint = '') {
    const tries = [];
    if (hint) tries.push(hint);
    try {
      const [origin, path] = splitUrl(url);
      if (path) tries.push(`${origin}/.well-known/oauth-protected-resource${path}`);
      tries.push(`${origin}/.well-known/oauth-protected-resource`);
    } catch { /* not a URL: no metadata */ }
    for (const candidate of tries) {
      try {
        const body = await getJson(candidate);
        if (record(body)) return body;
      } catch { /* try the next */ }
    }
    return null;
  }

  async function serverMetadata(issuer) {
    const [origin, path] = splitUrl(issuer);
    const tries = [
      `${origin}/.well-known/oauth-authorization-server${path}`,
      `${origin}/.well-known/openid-configuration${path}`,
      ...(path ? [`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`] : []),
    ];
    for (const candidate of tries) {
      try {
        const body = await getJson(candidate);
        if (record(body) && safeEndpoint(body.authorization_endpoint || body.device_authorization_endpoint)) return body;
      } catch { /* try the next */ }
    }
    throw fail(`${origin} doesn't describe how to sign in.`, 502);
  }

  /**
   * Whether a remote server wants sign-in. A 401 to headers the person gave
   * (an API key) is a rejected key, not a sign-in request: OAuth would take
   * over the Authorization header and leave no way to fix the key.
   */
  async function discover(url, headers = {}) {
    const ownAuthorization = Object.keys(headers).some((key) => key.toLowerCase() === 'authorization');
    let first;
    try { first = await probe(url, headers); } catch { return { required: false, reachable: false }; }
    if (first.status === 401) {
      if (ownAuthorization) return { required: false, rejectedKey: true, reachable: true };
      // A 401 means sign-in only when the server says how; otherwise it wants a key.
      const metadata = await resourceMetadata(url, first.challenge.resourceMetadata);
      if (Array.isArray(metadata?.authorization_servers) && metadata.authorization_servers.length) return { required: true, reachable: true, challenge: first.challenge };
      const described = await serverMetadata(splitUrl(url)[0]).then(() => true, () => false);
      return described ? { required: true, reachable: true, challenge: first.challenge } : { required: false, needsKey: true, reachable: true };
    }
    if (first.status >= 200 && first.status < 300) {
      if (Object.keys(headers).length) return { required: false, reachable: true };
      const metadata = await resourceMetadata(url);
      return { required: Array.isArray(metadata?.authorization_servers) && metadata.authorization_servers.length > 0, reachable: true };
    }
    return { required: false, reachable: true, status: first.status };
  }

  function deviceAppFor(issuer, url) {
    return deviceApps.find((app) => app.issuer === issuer.replace(/\/+$/, '') && String(url).startsWith(app.resource)) || null;
  }

  async function register(endpoint, redirectUri) {
    const response = await request(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_name: 'Autohand Squad', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', application_type: 'native' }),
    });
    const body = await response.json().catch(() => null);
    if (record(body) && text(body.client_id)) {
      return { clientId: body.client_id, clientSecret: text(body.client_secret), authMethod: text(body.token_endpoint_auth_method) || (text(body.client_secret) ? 'client_secret_post' : 'none') };
    }
    const reason = text(body?.error_description) || text(body?.error) || `HTTP ${response.status}`;
    throw fail(`The server refused to register Squad for sign-in (${reason.slice(0, REASON_MAX)}).`, 502);
  }

  function pkce() {
    const verifier = b64url(randomBytes(32));
    return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
  }

  function expirePending() {
    for (const [state, entry] of pending) if (now() - entry.startedAt > PENDING_MS) pending.delete(state);
  }

  /**
   * Start signing in to connector `id`. Answers `{ mode: 'browser', url }`
   * (open it; the callback finishes the sign-in) or `{ mode: 'device',
   * userCode, verificationUri }` (the bridge polls in the background).
   */
  async function start(id) {
    expirePending();
    const { item, oauth } = await store.oauthState(id);
    const redirectUri = callbackUrl();
    if (item.kind === 'google') return startGoogle(item, redirectUri);
    if (item.kind !== 'url') throw fail(`${item.name} runs on this computer; it has nothing to sign in to.`);
    const headers = Object.fromEntries(Object.entries(item.headers).filter(([key]) => key.toLowerCase() !== 'authorization'));
    let challenge = {};
    try { challenge = (await probe(item.url, headers)).challenge; } catch { throw fail(`Can't reach ${new URL(item.url).host}. Check the address and this computer's connection.`, 502); }
    const resource = await resourceMetadata(item.url, challenge.resourceMetadata);
    const issuer = safeEndpoint(Array.isArray(resource?.authorization_servers) ? resource.authorization_servers[0] : '') || splitUrl(item.url)[0];
    const meta = await serverMetadata(issuer);
    const tokenEndpoint = safeEndpoint(meta.token_endpoint);
    if (!tokenEndpoint) throw fail(`${item.name}'s sign-in has no token endpoint.`, 502);
    const app = deviceAppFor(issuer, item.url);
    if (app) return startDevice(item, app, meta);
    const authorization = safeEndpoint(meta.authorization_endpoint);
    if (!authorization) throw fail(`${item.name}'s sign-in has no authorization endpoint.`, 502);
    if (Array.isArray(meta.code_challenge_methods_supported) && meta.code_challenge_methods_supported.length && !meta.code_challenge_methods_supported.includes('S256')) {
      throw fail(`${item.name}'s sign-in doesn't support PKCE, which Squad requires.`, 502);
    }
    let client = oauth?.clientId && Array.isArray(oauth.redirectUris) && oauth.redirectUris.includes(redirectUri) && oauth.issuer === issuer
      ? { clientId: oauth.clientId, clientSecret: (await store.oauthState(id)).tokens.clientSecret || '', authMethod: oauth.authMethod || 'none' }
      : null;
    if (!client) {
      const endpoint = safeEndpoint(meta.registration_endpoint);
      if (!endpoint) throw fail(`${item.name} doesn't let new apps sign in by themselves. Add it with an access token in a header instead.`, 409);
      client = await register(endpoint, redirectUri);
    }
    const scope = challenge.scope || (Array.isArray(resource?.scopes_supported) ? resource.scopes_supported.filter((value) => typeof value === 'string').join(' ') : '');
    await store.setOAuth(id, { revision: item.authRevision, url: item.url }, (next, tokens) => {
      Object.assign(next, { mode: 'dcr', issuer, clientId: client.clientId, authMethod: client.authMethod, redirectUris: [redirectUri], tokenEndpoint, revocationEndpoint: safeEndpoint(meta.revocation_endpoint), scopes: scope ? scope.split(' ').slice(0, 20) : [] });
      if (next.status !== 'signed-in') next.status = 'signed-out';
      if (client.clientSecret) tokens.clientSecret = client.clientSecret; else delete tokens.clientSecret;
    });
    const { verifier, challenge: codeChallenge } = pkce();
    const state = b64url(randomBytes(24));
    const link = new URL(authorization);
    link.searchParams.set('response_type', 'code');
    link.searchParams.set('client_id', client.clientId);
    link.searchParams.set('redirect_uri', redirectUri);
    link.searchParams.set('code_challenge', codeChallenge);
    link.searchParams.set('code_challenge_method', 'S256');
    link.searchParams.set('state', state);
    link.searchParams.set('resource', item.url);
    if (scope) link.searchParams.set('scope', scope);
    for (const [key, entry] of pending) if (entry.id === id) pending.delete(key);
    pending.set(state, { id, verifier, redirectUri, resource: item.url, revision: item.authRevision, url: item.url, startedAt: now(), tokenEndpoint, revocationEndpoint: safeEndpoint(meta.revocation_endpoint), client, issuer });
    return { mode: 'browser', url: link.toString(), expiresInSeconds: PENDING_MS / 1000 };
  }

  async function startGoogle(item, redirectUri) {
    const client = await googleClient();
    if (!client?.clientId) throw Object.assign(fail('Squad needs a Google OAuth client before it can sign in to Google. Add one under Google sign-in.', 409), { code: 'google_client_missing' });
    const product = item.google?.product;
    const scopes = ['openid', 'email', ...(GOOGLE_SCOPES[product] || [])];
    await store.setOAuth(item.id, { revision: item.authRevision }, (next) => {
      Object.assign(next, { mode: 'google', issuer: googleEndpoints.issuer, clientId: client.clientId, redirectUris: [redirectUri], tokenEndpoint: googleEndpoints.token, revocationEndpoint: googleEndpoints.revocation, scopes });
      if (next.status !== 'signed-in') next.status = 'signed-out';
    });
    const { verifier, challenge } = pkce();
    const state = b64url(randomBytes(24));
    const link = new URL(googleEndpoints.authorization);
    for (const [key, value] of Object.entries({ response_type: 'code', client_id: client.clientId, redirect_uri: redirectUri, scope: scopes.join(' '), code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' })) link.searchParams.set(key, value);
    for (const [key, entry] of pending) if (entry.id === item.id) pending.delete(key);
    pending.set(state, { id: item.id, verifier, redirectUri, resource: '', revision: item.authRevision, url: undefined, startedAt: now(), tokenEndpoint: googleEndpoints.token, revocationEndpoint: googleEndpoints.revocation, client: { clientId: client.clientId, clientSecret: client.clientSecret, authMethod: client.clientSecret ? 'client_secret_post' : 'none' }, issuer: googleEndpoints.issuer, google: true });
    return { mode: 'browser', url: link.toString(), expiresInSeconds: PENDING_MS / 1000 };
  }

  function clientForm(client) {
    if (client.authMethod === 'client_secret_basic' && client.clientSecret) return { form: {}, basic: { id: client.clientId, secret: client.clientSecret } };
    return { form: { client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}) } };
  }

  function storeTokens(oauthRecord, tokens, body) {
    tokens.accessToken = String(body.access_token);
    if (text(body.refresh_token)) tokens.refreshToken = body.refresh_token;
    oauthRecord.expiresAt = Number(body.expires_in) > 0 ? seconds() + Number(body.expires_in) : null;
    oauthRecord.status = 'signed-in';
    oauthRecord.signedInAt = new Date(now()).toISOString();
    oauthRecord.lastError = '';
    const email = body.id_token ? decodeJwtEmail(body.id_token) : '';
    if (email) oauthRecord.account = email;
  }

  /** The callback: trade the code for tokens. One use per state. */
  async function finish({ state, code, error, errorDescription }) {
    expirePending();
    const entry = pending.get(String(state || ''));
    if (!entry) throw fail('This sign-in already finished or expired. Start it again from Settings › Connectors.', 410);
    pending.delete(state);
    if (error) {
      const reason = error === 'access_denied' ? 'Sign-in was cancelled.' : `Sign-in didn't finish: ${String(errorDescription || error).slice(0, 200)}`;
      await store.setOAuth(entry.id, {}, (next) => { next.lastError = reason; }).catch(() => {});
      emit({ id: entry.id, outcome: 'failed' });
      throw fail(reason, 400);
    }
    if (!text(code)) throw fail('Sign-in didn\'t return a code. Start it again.', 400);
    const { form, basic } = clientForm(entry.client);
    const answer = await postForm(entry.tokenEndpoint, { grant_type: 'authorization_code', code, redirect_uri: entry.redirectUri, code_verifier: entry.verifier, ...(entry.resource ? { resource: entry.resource } : {}), ...form }, { basic }).catch(() => null);
    if (!answer || answer.status < 200 || answer.status >= 300 || typeof answer.body.access_token !== 'string') {
      const reason = answer ? `The sign-in server refused the code (${text(answer.body.error_description) || text(answer.body.error) || `HTTP ${answer.status}`}). Start the sign-in again.` : 'Couldn\'t reach the sign-in server. Check this computer\'s connection and start the sign-in again.';
      await store.setOAuth(entry.id, {}, (next) => { next.lastError = reason.slice(0, 240); }).catch(() => {});
      emit({ id: entry.id, outcome: 'failed' });
      throw fail(reason.slice(0, 300), 502);
    }
    let result;
    try {
      result = await store.setOAuth(entry.id, { revision: entry.revision, ...(entry.url !== undefined ? { url: entry.url } : {}) }, (next, tokens) => storeTokens(next, tokens, answer.body));
    } catch (failure) {
      // The connector changed (or went) while the person was signing in: these
      // tokens were granted for the old server, so hand them back.
      const meta = { revocationEndpoint: entry.revocationEndpoint, clientId: entry.client.clientId, authMethod: entry.client.authMethod, mode: entry.google ? 'google' : 'dcr' };
      void revoke(meta, { accessToken: answer.body.access_token, refreshToken: text(answer.body.refresh_token), clientSecret: entry.client.clientSecret });
      throw failure;
    }
    emit({ id: entry.id, outcome: 'signed-in' });
    return result.connector;
  }

  async function startDevice(item, app, meta) {
    const endpoint = safeEndpoint(meta.device_authorization_endpoint) || app.deviceEndpoint;
    const tokenEndpoint = safeEndpoint(meta.token_endpoint) || app.tokenEndpoint;
    const answer = await postForm(endpoint, { client_id: app.clientId, scope: app.scopes.join(' ') }).catch(() => null);
    const body = answer?.body || {};
    if (!text(body.device_code) || !text(body.user_code) || !safeEndpoint(body.verification_uri)) throw fail(`${item.name} refused the sign-in${answer ? ` (HTTP ${answer.status})` : ''}.`, 502);
    const expiresAt = now() + (Number(body.expires_in) > 0 ? Number(body.expires_in) : 900) * 1000;
    const job = { id: item.id, userCode: body.user_code, verificationUri: body.verification_uri, expiresAt, cancelled: false, error: '' };
    devices.get(item.id)?.cancel?.();
    devices.set(item.id, job);
    job.cancel = () => { job.cancelled = true; };
    let interval = Math.max(1, Number(body.interval) || 5) * 1000;
    void (async () => {
      while (!job.cancelled && now() < expiresAt) {
        await sleep(interval);
        if (job.cancelled) return;
        const poll = await postForm(tokenEndpoint, { client_id: app.clientId, device_code: body.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }).catch(() => null);
        if (!poll) continue; // a network blip: keep polling until the code expires
        if (typeof poll.body.access_token === 'string') {
          try {
            await store.setOAuth(item.id, { revision: item.authRevision, url: item.url }, (next, tokens) => {
              Object.assign(next, { mode: 'device', issuer: app.issuer, clientId: app.clientId, tokenEndpoint, revocationEndpoint: '', scopes: app.scopes });
              storeTokens(next, tokens, poll.body);
            });
            emit({ id: item.id, outcome: 'signed-in' });
          } catch (error) { job.error = error.message; }
          devices.delete(item.id);
          return;
        }
        const code = poll.body.error;
        if (code === 'authorization_pending') continue;
        if (code === 'slow_down') { interval += 5000; continue; }
        job.error = code === 'access_denied' ? 'Sign-in was cancelled.' : code === 'expired_token' ? 'The code expired. Start the sign-in again.' : `Sign-in didn't finish (${String(code || poll.status).slice(0, 80)}).`;
        emit({ id: item.id, outcome: 'failed' });
        return;
      }
      if (!job.cancelled && !job.error) { job.error = 'The code expired. Start the sign-in again.'; emit({ id: item.id, outcome: 'failed' }); }
    })();
    return { mode: 'device', userCode: job.userCode, verificationUri: job.verificationUri, expiresInSeconds: Math.round((expiresAt - now()) / 1000) };
  }

  /** What a person waiting on a sign-in should see. */
  function progress(id) {
    const device = devices.get(id);
    if (device) return { mode: 'device', userCode: device.userCode, verificationUri: device.verificationUri, error: device.error, waiting: !device.error && now() < device.expiresAt };
    for (const entry of pending.values()) if (entry.id === id && now() - entry.startedAt < PENDING_MS) return { mode: 'browser', waiting: true };
    return { waiting: false };
  }

  function cancel(id) {
    devices.get(id)?.cancel?.();
    devices.delete(id);
    for (const [key, entry] of pending) if (entry.id === id) pending.delete(key);
  }

  /**
   * A usable access token for connector `id`, refreshed when it is about to
   * expire or the server just said 401 (`stale`). One refresh per connector
   * at a time: servers that rotate refresh tokens revoke the old one on use.
   */
  async function fresh(id, { stale = false } = {}) {
    const { item, oauth, tokens } = await store.oauthState(id);
    if (!oauth || !tokens.accessToken || oauth.status !== 'signed-in') throw fail(`Sign in to ${item.name} in Settings › Connectors.`, 401);
    const expiring = oauth.expiresAt && oauth.expiresAt <= seconds() + EARLY_S;
    if (!stale && !expiring) return { accessToken: tokens.accessToken, expiresAt: oauth.expiresAt || null };
    if (refreshing.has(id)) return refreshing.get(id);
    const job = renew(id, item, oauth, tokens, stale).finally(() => refreshing.delete(id));
    refreshing.set(id, job);
    return job;
  }

  async function renew(id, item, oauth, tokens, stale) {
    const stillValid = () => !stale && oauth.expiresAt && oauth.expiresAt > seconds();
    if (!tokens.refreshToken) {
      if (stillValid()) return { accessToken: tokens.accessToken, expiresAt: oauth.expiresAt };
      await markEnded(id, item, 'expired', `The sign-in to ${item.name} ended. Sign in again in Settings › Connectors.`);
      throw fail(`The sign-in to ${item.name} ended. Sign in again in Settings › Connectors.`, 401);
    }
    const client = oauth.mode === 'google' ? await googleClient().then((value) => ({ clientId: value?.clientId || oauth.clientId, clientSecret: value?.clientSecret || '', authMethod: value?.clientSecret ? 'client_secret_post' : 'none' })) : { clientId: oauth.clientId, clientSecret: tokens.clientSecret || '', authMethod: oauth.authMethod || 'none' };
    const { form, basic } = clientForm(client);
    let answer = null;
    // One more try after a network failure or a busy server (5xx, 429): those say nothing about the grant.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      answer = await postForm(oauth.tokenEndpoint, { grant_type: 'refresh_token', refresh_token: tokens.refreshToken, ...(item.kind === 'url' ? { resource: item.url } : {}), ...form }, { basic }).catch(() => null);
      if (answer && renewal(answer.status, answer.body) !== 'retry') break;
      if (attempt === 0) await sleep(1000);
    }
    const outcome = answer ? renewal(answer.status, answer.body) : 'retry';
    if (outcome === 'renewed') {
      const result = await store.setOAuth(id, { revision: item.authRevision }, (next, nextTokens) => storeTokens(next, nextTokens, answer.body));
      return { accessToken: result.tokens.accessToken, expiresAt: result.oauth.expiresAt || null };
    }
    log(`connector ${id} token refresh ${outcome}${answer ? ` (HTTP ${answer.status} ${String(answer.body.error || '').slice(0, 40)})` : ''}`);
    if (outcome === 'retry') {
      if (stillValid()) return { accessToken: tokens.accessToken, expiresAt: oauth.expiresAt };
      throw fail(`Couldn't renew the sign-in to ${item.name}. Squad will try again on the next request; check this computer's connection.`, 503);
    }
    await markEnded(id, item, 'expired', `${item.name} ended the sign-in. Sign in again in Settings › Connectors.`, outcome === 'unregistered');
    throw fail(`${item.name} ended the sign-in. Sign in again in Settings › Connectors.`, 401);
  }

  async function markEnded(id, item, status, message, forgetClient = false) {
    await store.setOAuth(id, { revision: item.authRevision }, (next, tokens) => {
      next.status = status; next.lastError = message; next.expiresAt = null;
      delete tokens.accessToken; delete tokens.refreshToken;
      if (forgetClient) { delete next.clientId; delete next.redirectUris; delete tokens.clientSecret; }
    }).catch(() => {});
    emit({ id, outcome: status });
  }

  /** Best-effort token revocation (RFC 7009); never throws. */
  async function revoke(oauth, tokens) {
    if (!oauth?.revocationEndpoint || !tokens) return false;
    const token = tokens.refreshToken || tokens.accessToken;
    if (!token) return false;
    try {
      const client = oauth.mode === 'google' ? { clientId: oauth.clientId, clientSecret: '' } : { clientId: oauth.clientId, clientSecret: tokens.clientSecret || '', authMethod: oauth.authMethod };
      const { form, basic } = clientForm(client);
      const answer = await postForm(oauth.revocationEndpoint, { token, ...form }, { basic });
      return answer.status >= 200 && answer.status < 300;
    } catch { return false; }
  }

  async function signOut(id) {
    cancel(id);
    const { oauth, tokens } = await store.oauthState(id);
    const revoked = await revoke(oauth, tokens);
    const result = await store.setOAuth(id, {}, (next, nextTokens) => {
      next.status = 'signed-out'; next.expiresAt = null; next.lastError = ''; next.account = '';
      delete nextTokens.accessToken; delete nextTokens.refreshToken;
    });
    return { connector: result.connector, revoked };
  }

  return { discover, start, finish, progress, cancel, fresh, revoke, signOut, resourceMetadata, serverMetadata, pendingCount: () => pending.size };
}
