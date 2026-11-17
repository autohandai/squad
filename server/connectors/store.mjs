// Connector definitions: MCP servers the person adds (a command, an address,
// a registry install or one of Squad's Google connectors) plus the built-in
// Web research server. State lives in <squadStateDir>/connectors.json, mode
// 0600 (ADR-0107).
//
// Secrets never sit in that file in clear (ADR-0244): environment values and
// headers marked secret, OAuth tokens and client secrets, and the Firecrawl
// key are sealed per connector with AES-256-GCM under the same data key as
// the vault (macOS Keychain, Windows DPAPI, Linux Secret Service, else a 0600
// key file outside the state directory; server/vault/keychain.mjs). The
// connector id is bound as associated data, so a sealed blob moved onto
// another connector does not open. The browser only ever sees "configured"
// plus a four-character hint. Records written before sealing existed are
// sealed on first read.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';
import { seal, unseal } from '../vault/crypto.mjs';
import { createKeyring } from '../vault/keychain.mjs';

export const WEB_RESEARCH_ID = 'web-research';
export const MANAGED_PREFIX = 'squad-connector-';
export const GOOGLE_PRODUCTS = ['gmail', 'drive', 'calendar'];
const KINDS = new Set(['stdio', 'url', 'google']);
const TRANSPORTS = new Set(['http', 'sse']);
const FRAMINGS = new Set(['newline', 'header']);
const SECRET_KEY = /(token|secret|key|password|passwd|auth|bearer|credential|cookie|session)/i;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const MAX_CONNECTORS = 50;
const CRASH_WINDOW_MS = 60 * 60_000;

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function looksSecret(key, value = '') {
  return SECRET_KEY.test(String(key || '')) || /^bearer\s/i.test(String(value || ''));
}

function hint(value) {
  const text = String(value || '');
  return text.length >= 8 ? `…${text.slice(-4)}` : '';
}

function cleanText(value, limit, label) {
  const text = String(value ?? '').trim();
  if (text.length > limit) throw fail(`${label} is longer than ${limit} characters.`);
  return text;
}

function noLineBreaks(value, label) {
  if (/[\r\n\0]/.test(value)) throw fail(`${label} can't contain line breaks.`);
  return value;
}

/**
 * Normalise an env/header list coming from the browser into plain values,
 * secret values and hints. `incoming` is an array of { key, value, secret? }
 * (or an object). A secret entry sent back with an empty value keeps the
 * stored one; an entry left out is removed. `secret` defaults to the name
 * heuristic, so pasting API_TOKEN=… is sealed without a click.
 */
function mergePairs(incoming, stored, { pattern, label, keyLimit = 128, valueLimit = 8192 }) {
  const entries = Array.isArray(incoming) ? incoming : record(incoming) ? Object.entries(incoming).map(([key, value]) => ({ key, value })) : [];
  if (entries.length > 64) throw fail(`At most 64 ${label} entries are supported.`);
  const plain = {}, secret = {}, hints = {};
  for (const entry of entries) {
    const key = cleanText(record(entry) ? entry.key ?? entry.name : '', keyLimit, `${label} name`);
    if (!key) continue;
    if (!pattern.test(key)) throw fail(`${label} name "${key.slice(0, 40)}" is not valid.`);
    let value = cleanText(record(entry) ? entry.value : '', valueLimit, `${label} value`);
    if (label === 'Header') noLineBreaks(value, `Header ${key}`);
    const wasSecret = Object.prototype.hasOwnProperty.call(stored.secret, key);
    const wasPlain = Object.prototype.hasOwnProperty.call(stored.plain, key);
    if (value === '' && wasSecret) value = stored.secret[key];
    else if (value === '' && wasPlain && record(entry) && entry.keep === true) value = stored.plain[key];
    const isSecret = record(entry) && typeof entry.secret === 'boolean' ? entry.secret : (wasSecret && value === stored.secret[key]) || looksSecret(key, value);
    // An empty value is nothing to seal: it stays a plain, unconfigured entry.
    if (isSecret && value !== '') { secret[key] = value; hints[key] = hint(value); }
    else plain[key] = value;
  }
  return { plain, secret, hints };
}

function publicPairs(plain = {}, secretHints = {}, secretKeys = [], nameField) {
  const keys = [...new Set([...Object.keys(plain), ...secretKeys])];
  return keys.map((key) => (secretKeys.includes(key)
    ? { [nameField]: key, value: '', secret: true, configured: true, hint: secretHints[key] || '' }
    : { [nameField]: key, value: plain[key], secret: !plain[key] && looksSecret(key), configured: Boolean(plain[key]), hint: '' }));
}

function normalizeTest(value) {
  if (!record(value)) return null;
  return {
    at: String(value.at || ''),
    ok: value.ok === true,
    tools: Array.isArray(value.tools) ? value.tools.filter((tool) => typeof tool === 'string').slice(0, 200) : [],
    toolDetails: Array.isArray(value.toolDetails) ? value.toolDetails.filter((tool) => record(tool) && typeof tool.name === 'string').slice(0, 200).map((tool) => ({ name: tool.name.slice(0, 120), description: String(tool.description || '').slice(0, 200) })) : [],
    error: value.ok === true ? '' : String(value.error || '').slice(0, 240),
    serverName: String(value.serverName || '').slice(0, 120),
    ...(typeof value.credits === 'number' ? { credits: value.credits } : {}),
    keyChecked: value.keyChecked === true,
    ...(value.needsSignIn === true ? { needsSignIn: true } : {}),
  };
}

function publicOAuth(oauth) {
  if (!record(oauth)) return null;
  return {
    mode: String(oauth.mode || 'dcr'),
    status: ['signed-in', 'signed-out', 'expired', 'revoked'].includes(oauth.status) ? oauth.status : 'signed-out',
    issuer: String(oauth.issuer || ''),
    expiresAt: Number(oauth.expiresAt) || null,
    signedInAt: String(oauth.signedInAt || ''),
    account: String(oauth.account || '').slice(0, 120),
    lastError: String(oauth.lastError || '').slice(0, 240),
    scopes: Array.isArray(oauth.scopes) ? oauth.scopes.slice(0, 20) : [],
  };
}

export function createConnectorStore({ stateDir, rootDir, homeDir = process.env.HOME || '', nodePath = process.execPath, now = () => Date.now(), keyring = createKeyring({ stateDir, homeDir }) }) {
  const file = join(stateDir, 'connectors.json');
  let queue = Promise.resolve();
  let migrated = false;
  const serial = (operation) => { const pending = queue.then(operation); queue = pending.catch(() => {}); return pending; };
  const iso = () => new Date(now()).toISOString();

  async function dataKey(needed) {
    return (await keyring.load({ hasItems: needed })).key;
  }
  /** Decrypted secrets of one item: { env, headers, oauth, firecrawlApiKey, clientSecret }. */
  async function secretsOf(item) {
    if (record(item.secrets)) return item.secrets;
    if (!item.sealed) return (item.secrets = {});
    item.secrets = unseal(await dataKey(true), item.id, 'connector', item.sealed, item.name);
    return item.secrets;
  }
  async function hasSealed(state) {
    return state.connectors.some((item) => item.sealed) || Boolean(state.google?.sealed);
  }

  /** Move clear-text secrets of records from before ADR-0244 into `secrets`. */
  function migrateLegacy(item) {
    let changed = false;
    if (item.sealed || record(item.secrets)) return false;
    const secrets = {};
    if (item.builtin && item.firecrawlApiKey) { secrets.firecrawlApiKey = item.firecrawlApiKey; item.keyHint = hint(item.firecrawlApiKey); changed = true; }
    delete item.firecrawlApiKey;
    for (const [field, keysField, hintsField] of [['env', 'secretEnv', 'envHints'], ['headers', 'secretHeaders', 'headerHints']]) {
      if (!record(item[field])) continue;
      for (const [key, value] of Object.entries(item[field])) {
        if (!value || !looksSecret(key, value)) continue;
        (secrets[field] ||= {})[key] = value;
        item[keysField] = [...new Set([...(item[keysField] || []), key])];
        (item[hintsField] ||= {})[key] = hint(value);
        delete item[field][key];
        changed = true;
      }
    }
    if (changed) item.secrets = secrets;
    return changed;
  }

  async function load() {
    const stored = await readPersistentJson(file, { version: 2, connectors: [] });
    if (!record(stored) || !Array.isArray(stored.connectors)) throw fail('The connector store is invalid. Repair or remove connectors.json before retrying.', 503);
    const connectors = stored.connectors.filter((item) => record(item) && typeof item.id === 'string');
    if (!connectors.some((item) => item.id === WEB_RESEARCH_ID)) connectors.unshift(builtinWebResearch());
    const state = { version: 2, connectors, google: record(stored.google) ? stored.google : null };
    // Only a file written before sealing (version 1) holds clear-text secrets;
    // in a version 2 file a value outside `sealed` is plain on purpose.
    let legacy = false;
    if (stored.version !== 2) for (const item of connectors) legacy = migrateLegacy(item) || legacy;
    state.legacy = legacy;
    return state;
  }

  async function save(state) {
    const sealedNeeded = state.connectors.some((item) => record(item.secrets) && Object.keys(item.secrets).length) || (record(state.google?.secrets) && Object.keys(state.google.secrets).length);
    const key = sealedNeeded ? await dataKey(await hasSealed(state)) : null;
    const out = state.connectors.map((item) => {
      const { secrets, ...rest } = item;
      if (record(secrets)) {
        const filled = Object.fromEntries(Object.entries(secrets).filter(([, value]) => value !== undefined && value !== null && !(record(value) && !Object.keys(value).length) && value !== ''));
        if (Object.keys(filled).length) rest.sealed = seal(key, item.id, 'connector', filled);
        else delete rest.sealed;
      }
      return rest;
    });
    let google = null;
    if (state.google) {
      const { secrets, ...rest } = state.google;
      google = rest;
      if (record(secrets)) {
        if (secrets.clientSecret) google.sealed = seal(key, 'google-client', 'connector', secrets);
        else delete google.sealed;
      }
    }
    await writePersistentJson(file, { version: 2, connectors: out, ...(google ? { google } : {}) });
  }

  /** Every read path goes through here so a legacy file is sealed once, under the queue. */
  async function read() {
    if (!migrated) {
      await serial(async () => {
        if (migrated) return;
        const state = await load();
        if (state.legacy) await save(state);
        migrated = true;
      });
    }
    return load();
  }

  function builtinWebResearch() {
    return { id: WEB_RESEARCH_ID, builtin: true, name: 'Web research', kind: 'stdio', enabled: false, framing: 'newline', createdAt: iso(), updatedAt: iso(), lastTest: null };
  }

  function uniqueName(state, name, exceptId) {
    const wanted = name.trim().toLowerCase();
    const clash = state.connectors.find((item) => item.id !== exceptId && String(item.name || '').trim().toLowerCase() === wanted);
    if (clash) throw fail(`Another connector is already called ${clash.name}. Choose another name.`, 409);
  }

  /** Apply a browser definition onto `base` (a stored item), keeping secrets sent back blank. */
  async function validate(input, existing = null) {
    if (!record(input)) throw fail('A connector definition is required.');
    const base = existing || {};
    const secrets = existing ? { ...(await secretsOf(existing)) } : {};
    const name = noLineBreaks(cleanText(input.name ?? base.name, 80, 'Name'), 'Name');
    if (!name) throw fail('Give the connector a name.');
    const kind = input.kind ?? base.kind;
    if (!KINDS.has(kind) || kind === 'google') {
      if (kind === 'google' && base.kind === 'google') return { next: { ...base, name, description: cleanText(input.description ?? base.description ?? '', 400, 'Description'), updatedAt: iso() }, secrets };
      throw fail('A connector runs a command or connects to an address.');
    }
    const next = { ...base, name, kind, description: cleanText(input.description ?? base.description ?? '', 400, 'Description'), updatedAt: iso() };
    if (kind === 'stdio') {
      next.command = noLineBreaks(cleanText(input.command ?? base.command, 1024, 'Command'), 'Command');
      if (!next.command) throw fail('Enter the command to run.');
      const args = input.args ?? base.args ?? [];
      const list = Array.isArray(args) ? args : String(args).split('\n');
      next.args = list.map((item) => cleanText(item, 4096, 'Argument')).filter(Boolean).slice(0, 64);
      const merged = mergePairs(input.env ?? publicPairs(base.env, base.envHints, base.secretEnv, 'key').map((pair) => ({ ...pair, keep: true })), { plain: base.env || {}, secret: secrets.env || {} }, { pattern: ENV_KEY, label: 'Environment variable' });
      next.env = merged.plain; next.secretEnv = Object.keys(merged.secret); next.envHints = merged.hints; secrets.env = merged.secret;
      // Sealed argument values ({{secret:key}} placeholders) survive only while their placeholder does.
      const placeholders = new Set(next.args.flatMap((arg) => [...arg.matchAll(/\{\{secret:([A-Za-z0-9_.-]{1,64})\}\}/g)].map((found) => found[1])));
      const argSecrets = { ...(secrets.args || {}), ...(record(input.argSecrets) ? input.argSecrets : {}) };
      secrets.args = Object.fromEntries(Object.entries(argSecrets).filter(([key, value]) => placeholders.has(key) && typeof value === 'string'));
      if (!Object.keys(secrets.args).length) delete secrets.args;
      for (const field of ['url', 'transport', 'headers', 'secretHeaders', 'headerHints']) delete next[field];
      delete secrets.headers; delete secrets.oauth; delete next.oauth;
    } else {
      const url = noLineBreaks(cleanText(input.url ?? base.url, 2048, 'Address'), 'Address');
      let parsed;
      try { parsed = new URL(url); } catch { throw fail('Enter a valid http or https address.'); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw fail('Connector addresses must start with http:// or https://.');
      if (parsed.username || parsed.password) throw fail('Put credentials in a header, never in the address.');
      if (parsed.hash) throw fail('Remove the #… part of the address.');
      next.url = url;
      next.transport = TRANSPORTS.has(input.transport ?? base.transport) ? input.transport ?? base.transport : 'http';
      const merged = mergePairs(input.headers ?? publicPairs(base.headers, base.headerHints, base.secretHeaders, 'name').map((pair) => ({ ...pair, keep: true })), { plain: base.headers || {}, secret: secrets.headers || {} }, { pattern: HEADER_NAME, label: 'Header' });
      next.headers = merged.plain; next.secretHeaders = Object.keys(merged.secret); next.headerHints = merged.hints; secrets.headers = merged.secret;
      for (const field of ['command', 'args', 'env', 'secretEnv', 'envHints', 'framing']) delete next[field];
      delete secrets.env;
      delete secrets.args;
      // A new address or new headers retire the sign-in (its tokens were
      // granted for the old server) and every sign-in still in flight.
      const headersChanged = JSON.stringify([next.headers, secrets.headers]) !== JSON.stringify([base.headers || {}, (existing ? (await secretsOf(existing)).headers : null) || {}]);
      if (existing && (base.url !== next.url || headersChanged)) {
        next.authRevision = randomBytes(8).toString('hex');
        if (base.url !== next.url && next.oauth) { next.oauth = { status: 'signed-out', mode: next.oauth.mode }; delete secrets.oauth; }
      }
    }
    return { next, secrets };
  }

  function publicRecord(item) {
    const common = {
      id: item.id, name: item.name, kind: item.kind, builtin: item.builtin === true, enabled: item.enabled === true,
      description: item.description || '', lastTest: normalizeTest(item.lastTest), createdAt: item.createdAt || '', updatedAt: item.updatedAt || '',
      serverName: MANAGED_PREFIX + item.id,
      registry: record(item.registry) ? { name: item.registry.name, version: item.registry.version, option: item.registry.option, latest: item.update?.latest || '', checkedAt: item.update?.checkedAt || '' } : null,
      catalogId: item.catalogId || '',
      oauth: publicOAuth(item.oauth),
      runtime: publicRuntime(item.runtime),
    };
    if (item.builtin) return { ...common, hasKey: Boolean(item.keyHint), keyHint: item.keyHint || '', tools: ['web_search', 'web_fetch'] };
    if (item.kind === 'google') return { ...common, google: { product: item.google?.product || '' } };
    if (item.kind === 'stdio') return { ...common, command: item.command || '', args: Array.isArray(item.args) ? item.args : [], env: publicPairs(item.env, item.envHints, item.secretEnv, 'key'), framing: FRAMINGS.has(item.framing) ? item.framing : 'newline' };
    return { ...common, url: item.url || '', transport: TRANSPORTS.has(item.transport) ? item.transport : 'http', headers: publicPairs(item.headers, item.headerHints, item.secretHeaders, 'name') };
  }

  function publicRuntime(runtime) {
    if (!record(runtime)) return null;
    const crashes = (Array.isArray(runtime.crashes) ? runtime.crashes : []).filter((at) => now() - Date.parse(at) < CRASH_WINDOW_MS);
    return { crashesLastHour: crashes.length, lastError: String(runtime.lastError || '').slice(0, 240), lastErrorAt: String(runtime.lastErrorAt || ''), lastStartAt: String(runtime.lastStartAt || '') };
  }

  /** Everything needed to start or connect to the server, secrets included. Server-side only. */
  async function launchSpec(item, { firecrawlBaseUrl = '' } = {}) {
    const serverName = MANAGED_PREFIX + item.id;
    const secrets = await secretsOf(item);
    if (item.builtin) {
      const env = { FIRECRAWL_API_KEY: String(secrets.firecrawlApiKey || '') };
      if (firecrawlBaseUrl) env.FIRECRAWL_API_URL = firecrawlBaseUrl;
      return { id: item.id, name: item.name, serverName, kind: 'stdio', command: nodePath, args: [join(rootDir, 'server', 'connectors', 'web-research-mcp.mjs')], env, framing: 'newline', builtin: true };
    }
    if (item.kind === 'google') {
      return { id: item.id, name: item.name, serverName, kind: 'stdio', command: nodePath, args: [join(rootDir, 'server', 'connectors', 'google-workspace-mcp.mjs'), '--product', item.google?.product || 'gmail'], env: {}, framing: 'newline', builtin: false, google: item.google?.product || 'gmail', needsBridgeToken: true };
    }
    if (item.kind === 'stdio') {
      const args = (Array.isArray(item.args) ? item.args : []).map((arg) => arg.replace(/\{\{secret:([A-Za-z0-9_.-]{1,64})\}\}/g, (whole, key) => secrets.args?.[key] ?? whole));
      return { id: item.id, name: item.name, serverName, kind: 'stdio', command: item.command, args, env: { ...(item.env || {}), ...(secrets.env || {}) }, framing: FRAMINGS.has(item.framing) ? item.framing : 'newline', builtin: false };
    }
    const headers = { ...(item.headers || {}), ...(secrets.headers || {}) };
    if (record(item.oauth) && secrets.oauth?.accessToken) headers.Authorization = `Bearer ${secrets.oauth.accessToken}`;
    return { id: item.id, name: item.name, serverName, kind: 'url', url: item.url, transport: TRANSPORTS.has(item.transport) ? item.transport : 'http', headers, builtin: false, oauth: record(item.oauth) ? item.oauth.status : null };
  }

  async function find(state, id) {
    const item = state.connectors.find((entry) => entry.id === id);
    if (!item) throw fail('Connector not found.', 404);
    return item;
  }

  function newId() { return `cn-${randomBytes(4).toString('hex')}`; }

  function mutate(id, operation) {
    return serial(async () => {
      const state = await load();
      const item = await find(state, id);
      const result = await operation(item, state);
      await save(state);
      return result === undefined ? publicRecord(item) : result;
    });
  }

  /** A definition built from the catalogue (registry.buildDefinition or a Google product). */
  async function fromDefinition(definition, base = null) {
    const input = {
      name: definition.name, kind: definition.kind, description: definition.description,
      command: definition.command, args: definition.args, env: definition.env, argSecrets: definition.argSecrets,
      url: definition.url, transport: definition.transport, headers: definition.headers,
    };
    if (definition.kind === 'google') {
      if (!GOOGLE_PRODUCTS.includes(definition.product)) throw fail('Unknown Google product.');
      const next = { ...(base || {}), name: cleanText(definition.name, 80, 'Name'), kind: 'google', google: { product: definition.product }, description: definition.description || '', updatedAt: iso(), oauth: base?.oauth?.mode === 'google' ? base.oauth : { mode: 'google', status: 'signed-out' } };
      return { next, secrets: base ? await secretsOf(base) : {} };
    }
    return validate(input, base);
  }

  return {
    file,
    keyring,
    async list() { return (await read()).connectors.map(publicRecord); },
    async get(id) { return publicRecord(await find(await read(), id)); },
    async raw(id) { const item = await find(await read(), id); return { ...item, secrets: undefined, sealed: undefined }; },
    async spec(id, options) { return launchSpec(await find(await read(), id), options); },
    async secrets(id) { return { ...(await secretsOf(await find(await read(), id))) }; },
    create(input) {
      return serial(async () => {
        const state = await load();
        if (state.connectors.length >= MAX_CONNECTORS) throw fail(`At most ${MAX_CONNECTORS} connectors are supported.`);
        const { next, secrets } = await validate(input);
        uniqueName(state, next.name, null);
        const item = { ...next, id: newId(), enabled: false, createdAt: iso(), lastTest: null, secrets };
        state.connectors.push(item);
        await save(state);
        return publicRecord(item);
      });
    },
    /**
     * Install from the catalogue. A server already installed from the same
     * registry entry (or the same Google product) is rebuilt in place, same
     * id and on/off state, so members keep their server name.
     */
    install(definition, { catalogId = '' } = {}) {
      return serial(async () => {
        const state = await load();
        const existing = state.connectors.find((item) => !item.builtin && ((definition.registry?.name && item.registry?.name === definition.registry.name) || (definition.kind === 'google' && item.kind === 'google' && item.google?.product === definition.product)));
        const { next, secrets } = await fromDefinition(definition, existing || null);
        if (definition.registry) next.registry = { ...definition.registry };
        if (catalogId) next.catalogId = catalogId;
        if (existing) {
          const kept = { ...next, secrets, lastTest: existing.kind === next.kind && existing.command === next.command && existing.url === next.url ? existing.lastTest : null };
          delete kept.update;
          state.connectors[state.connectors.indexOf(existing)] = kept;
          await save(state);
          return { connector: publicRecord(kept), reinstalled: true };
        }
        if (state.connectors.length >= MAX_CONNECTORS) throw fail(`At most ${MAX_CONNECTORS} connectors are supported.`);
        let name = next.name, counter = 2;
        while (state.connectors.some((item) => String(item.name).toLowerCase() === name.toLowerCase())) name = `${next.name} ${counter++}`;
        const item = { ...next, name, id: newId(), enabled: false, createdAt: iso(), lastTest: null, secrets };
        state.connectors.push(item);
        await save(state);
        return { connector: publicRecord(item), reinstalled: false };
      });
    },
    update(id, input) {
      return mutate(id, async (item, state) => {
        let next, secrets;
        if (item.builtin) {
          next = { ...item, updatedAt: iso() };
          secrets = { ...(await secretsOf(item)) };
          if (record(input) && input.apiKey !== undefined) {
            if (input.apiKey === null) { delete secrets.firecrawlApiKey; next.keyHint = ''; }
            else { const key = cleanText(input.apiKey, 512, 'Firecrawl key'); if (key) { secrets.firecrawlApiKey = key; next.keyHint = hint(key); } }
          }
        } else {
          ({ next, secrets } = await validate({ kind: item.kind, ...input }, item));
          uniqueName(state, next.name, item.id);
          if (next.kind !== item.kind || next.command !== item.command || next.url !== item.url || JSON.stringify(next.args) !== JSON.stringify(item.args)) next.lastTest = null;
        }
        if (record(input) && typeof input.enabled === 'boolean') next.enabled = input.enabled;
        Object.keys(item).forEach((key) => delete item[key]);
        Object.assign(item, next, { secrets });
        delete item.sealed;
      });
    },
    /** Rename only: no check, same id and server name, so members are unaffected. */
    rename(id, name) {
      return mutate(id, (item, state) => {
        const clean = noLineBreaks(cleanText(name, 80, 'Name'), 'Name');
        if (!clean) throw fail('Give the connector a name.');
        uniqueName(state, clean, id);
        item.name = clean; item.updatedAt = iso();
      });
    },
    /** Removes the connector and its sealed secrets; returns what the caller must revoke. */
    remove(id) {
      return serial(async () => {
        const state = await load();
        const item = await find(state, id);
        if (item.builtin) throw fail('Web research is built in; turn it off instead of removing it.');
        let secrets = {};
        try { secrets = await secretsOf(item); } catch { /* a connector whose secrets can't be opened can still be removed */ }
        state.connectors = state.connectors.filter((entry) => entry !== item);
        await save(state);
        return { id, oauth: record(item.oauth) ? { ...item.oauth } : null, tokens: secrets.oauth ? { ...secrets.oauth } : null };
      });
    },
    setEnabled(id, enabled) {
      return mutate(id, (item) => { item.enabled = enabled === true; item.updatedAt = iso(); });
    },
    recordTest(id, result) {
      return mutate(id, (item) => {
        const tools = (result.tools || []).map((tool) => (typeof tool === 'string' ? { name: tool, description: '' } : tool)).filter((tool) => tool?.name);
        item.lastTest = normalizeTest({ ...result, at: iso(), tools: tools.map((tool) => tool.name), toolDetails: tools, serverName: result.serverInfo?.name || '' });
        if (result.ok && item.kind === 'stdio' && FRAMINGS.has(result.framing)) item.framing = result.framing;
        if (result.ok && item.kind === 'url' && TRANSPORTS.has(result.transport)) item.transport = result.transport;
      });
    },
    /** OAuth bookkeeping. `revision` guards against an edit racing a sign-in. */
    setOAuth(id, { revision, url } = {}, change) {
      return mutate(id, async (item) => {
        if (revision !== undefined && String(item.authRevision || '') !== String(revision || '')) throw fail('This connector changed while signing in. Start the sign-in again.', 409);
        if (url !== undefined && item.kind === 'url' && item.url !== url) throw fail('This connector changed while signing in. Start the sign-in again.', 409);
        const secrets = await secretsOf(item);
        const oauth = record(item.oauth) ? { ...item.oauth } : { mode: 'dcr', status: 'signed-out' };
        const tokens = record(secrets.oauth) ? { ...secrets.oauth } : {};
        change(oauth, tokens);
        item.oauth = oauth;
        secrets.oauth = tokens;
        item.updatedAt = iso();
        return { oauth: { ...oauth }, tokens: { ...tokens }, connector: publicRecord(item) };
      });
    },
    async oauthState(id) {
      const item = await find(await read(), id);
      const secrets = await secretsOf(item);
      return { item: { id: item.id, name: item.name, kind: item.kind, url: item.url, authRevision: String(item.authRevision || ''), headers: { ...(item.headers || {}), ...(secrets.headers || {}) }, google: item.google || null }, oauth: record(item.oauth) ? { ...item.oauth } : null, tokens: record(secrets.oauth) ? { ...secrets.oauth } : {} };
    },
    recordRuntime(id, event) {
      return mutate(id, (item) => {
        const runtime = record(item.runtime) ? item.runtime : {};
        const at = iso();
        const crashes = (Array.isArray(runtime.crashes) ? runtime.crashes : []).filter((stamp) => now() - Date.parse(stamp) < CRASH_WINDOW_MS);
        if (event.type === 'started') runtime.lastStartAt = at;
        if (event.type === 'crash') crashes.push(at);
        if (event.type === 'crash' || event.type === 'error') { runtime.lastError = String(event.detail || '').slice(0, 240); runtime.lastErrorAt = at; }
        if (event.type === 'recovered') { runtime.lastError = ''; runtime.lastErrorAt = ''; }
        runtime.crashes = crashes.slice(-20);
        item.runtime = runtime;
      });
    },
    /** A registry package moved to a new version: new arguments, same everything else. */
    applyUpdate(id, { args, version }) {
      return mutate(id, (item) => {
        item.args = args.map(String).slice(0, 64);
        item.registry = { ...(item.registry || {}), version: String(version) };
        item.update = { latest: '', checkedAt: iso() };
        item.updatedAt = iso();
      });
    },
    setUpdateInfo(id, info) {
      return mutate(id, (item) => { item.update = { latest: String(info.latest || ''), checkedAt: iso() }; });
    },
    /** The Google OAuth client the person (or the build) provides. */
    async googleClient() {
      const state = await read();
      if (!state.google?.clientId) return null;
      const secrets = state.google.sealed ? unseal(await dataKey(true), 'google-client', 'connector', state.google.sealed, 'Google client') : {};
      return { clientId: state.google.clientId, clientSecret: secrets.clientSecret || '', savedAt: state.google.savedAt || '' };
    },
    setGoogleClient(input) {
      return serial(async () => {
        const state = await load();
        if (input === null) { state.google = null; await save(state); return null; }
        const clientId = noLineBreaks(cleanText(input?.clientId, 256, 'Client ID'), 'Client ID');
        if (!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw fail('A Google client ID ends in .apps.googleusercontent.com.');
        const previous = state.google?.clientId === clientId && state.google.sealed ? unseal(await dataKey(true), 'google-client', 'connector', state.google.sealed, 'Google client') : {};
        const clientSecret = cleanText(input?.clientSecret, 256, 'Client secret') || previous.clientSecret || '';
        state.google = { clientId, secretHint: hint(clientSecret), savedAt: iso(), secrets: { clientSecret } };
        await save(state);
        return { clientId, secretHint: state.google.secretHint };
      });
    },
    async googleClientPublic() {
      const state = await read();
      return state.google?.clientId ? { clientId: state.google.clientId, secretHint: state.google.secretHint || '', savedAt: state.google.savedAt || '' } : null;
    },
    /** Launch specs for every enabled connector, in display order. */
    async enabledSpecs(options) {
      const state = await read();
      const specs = [];
      for (const item of state.connectors.filter((entry) => entry.enabled === true)) specs.push(await launchSpec(item, options));
      return specs;
    },
    /** What provisioning needs to write launcher entries: no secrets. */
    async enabledSummaries() {
      return (await read()).connectors.filter((item) => item.enabled === true).map((item) => ({ id: item.id, name: item.name, serverName: MANAGED_PREFIX + item.id, builtin: item.builtin === true, google: item.kind === 'google' ? item.google?.product || '' : '' }));
    },
    async enabledIds() {
      return (await read()).connectors.filter((item) => item.enabled === true).map((item) => item.id);
    },
  };
}
