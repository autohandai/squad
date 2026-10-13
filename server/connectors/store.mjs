// Connector definitions: MCP servers the person adds (a stdio command or a
// URL) plus the built-in Web research server. State lives in
// <squadStateDir>/connectors.json, mode 0600. Secrets stay on disk and in the
// child environment; the browser only ever sees "configured" plus a hint.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';

export const WEB_RESEARCH_ID = 'web-research';
export const MANAGED_PREFIX = 'squad-connector-';
const KINDS = new Set(['stdio', 'url']);
const TRANSPORTS = new Set(['http', 'sse']);
const FRAMINGS = new Set(['newline', 'header']);
const SECRET_KEY = /(token|secret|key|password|passwd|auth|bearer|credential|cookie|session)/i;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

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

/**
 * Normalise an env/header map coming from the browser. `incoming` is an
 * array of { key, value } (or an object). A secret entry sent back with an
 * empty value keeps the stored one; an entry left out is removed.
 */
function mergePairs(incoming, stored, { pattern, label, keyLimit = 128, valueLimit = 8192 }) {
  const entries = Array.isArray(incoming) ? incoming : record(incoming) ? Object.entries(incoming).map(([key, value]) => ({ key, value })) : [];
  if (entries.length > 64) throw fail(`At most 64 ${label} entries are supported.`);
  const result = {};
  for (const entry of entries) {
    const key = cleanText(record(entry) ? entry.key : '', keyLimit, `${label} name`);
    if (!key) continue;
    if (!pattern.test(key)) throw fail(`${label} name "${key.slice(0, 40)}" is not valid.`);
    const value = cleanText(record(entry) ? entry.value : '', valueLimit, `${label} value`);
    result[key] = value === '' && Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : value;
  }
  return result;
}

function publicPairs(map, nameField) {
  return Object.entries(map || {}).map(([key, value]) => {
    const secret = looksSecret(key, value);
    return { [nameField]: key, value: secret ? '' : value, secret, configured: Boolean(value), hint: secret ? hint(value) : '' };
  });
}

function normalizeTest(value) {
  if (!record(value)) return null;
  return {
    at: String(value.at || ''),
    ok: value.ok === true,
    tools: Array.isArray(value.tools) ? value.tools.filter((tool) => typeof tool === 'string').slice(0, 200) : [],
    error: value.ok === true ? '' : String(value.error || '').slice(0, 240),
    serverName: String(value.serverName || '').slice(0, 120),
    ...(typeof value.credits === 'number' ? { credits: value.credits } : {}),
    keyChecked: value.keyChecked === true,
  };
}

export function createConnectorStore({ stateDir, rootDir, nodePath = process.execPath, now = () => Date.now() }) {
  const file = join(stateDir, 'connectors.json');
  let queue = Promise.resolve();
  const serial = (operation) => { const pending = queue.then(operation); queue = pending.catch(() => {}); return pending; };

  async function load() {
    const stored = await readPersistentJson(file, { version: 1, connectors: [] });
    if (!record(stored) || !Array.isArray(stored.connectors)) throw fail('The connector store is invalid. Repair or remove connectors.json before retrying.', 503);
    const connectors = stored.connectors.filter((item) => record(item) && typeof item.id === 'string');
    if (!connectors.some((item) => item.id === WEB_RESEARCH_ID)) connectors.unshift(builtinWebResearch());
    return { version: 1, connectors };
  }
  async function save(state) { await writePersistentJson(file, state); }

  function builtinWebResearch() {
    return { id: WEB_RESEARCH_ID, builtin: true, name: 'Web research', kind: 'stdio', enabled: false, firecrawlApiKey: '', framing: 'newline', createdAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString(), lastTest: null };
  }

  function validate(input, existing = null) {
    if (!record(input)) throw fail('A connector definition is required.');
    const base = existing || {};
    const name = cleanText(input.name ?? base.name, 80, 'Name');
    if (!name) throw fail('Give the connector a name.');
    const kind = input.kind ?? base.kind;
    if (!KINDS.has(kind)) throw fail('A connector runs a command or connects to a URL.');
    const next = { ...base, name, kind, updatedAt: new Date(now()).toISOString() };
    if (kind === 'stdio') {
      next.command = cleanText(input.command ?? base.command, 1024, 'Command');
      if (!next.command) throw fail('Enter the command to run.');
      const args = input.args ?? base.args ?? [];
      const list = Array.isArray(args) ? args : String(args).split('\n');
      next.args = list.map((item) => cleanText(item, 4096, 'Argument')).filter(Boolean).slice(0, 64);
      next.env = mergePairs(input.env ?? Object.entries(base.env || {}).map(([key, value]) => ({ key, value })), base.env || {}, { pattern: ENV_KEY, label: 'Environment variable' });
      delete next.url; delete next.transport; delete next.headers;
    } else {
      const url = cleanText(input.url ?? base.url, 2048, 'Address');
      let parsed;
      try { parsed = new URL(url); } catch { throw fail('Enter a valid http or https address.'); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw fail('Connector addresses must start with http:// or https://.');
      if (parsed.username || parsed.password) throw fail('Put credentials in a header, never in the address.');
      next.url = url;
      next.transport = TRANSPORTS.has(input.transport ?? base.transport) ? input.transport ?? base.transport : 'http';
      next.headers = mergePairs(input.headers ?? Object.entries(base.headers || {}).map(([key, value]) => ({ key, value })), base.headers || {}, { pattern: HEADER_NAME, label: 'Header' });
      delete next.command; delete next.args; delete next.env;
    }
    return next;
  }

  function publicRecord(item) {
    const common = { id: item.id, name: item.name, kind: item.kind, builtin: item.builtin === true, enabled: item.enabled === true, lastTest: normalizeTest(item.lastTest), createdAt: item.createdAt || '', updatedAt: item.updatedAt || '', serverName: MANAGED_PREFIX + item.id };
    if (item.builtin) return { ...common, hasKey: Boolean(item.firecrawlApiKey), keyHint: hint(item.firecrawlApiKey), tools: ['web_search', 'web_fetch'] };
    if (item.kind === 'stdio') return { ...common, command: item.command || '', args: Array.isArray(item.args) ? item.args : [], env: publicPairs(item.env, 'key'), framing: FRAMINGS.has(item.framing) ? item.framing : 'newline' };
    return { ...common, url: item.url || '', transport: TRANSPORTS.has(item.transport) ? item.transport : 'http', headers: publicPairs(item.headers, 'name') };
  }

  /** Everything needed to start or connect to the server, secrets included. */
  function launchSpec(item, { firecrawlBaseUrl = '' } = {}) {
    const serverName = MANAGED_PREFIX + item.id;
    if (item.builtin) {
      const env = { FIRECRAWL_API_KEY: String(item.firecrawlApiKey || '') };
      if (firecrawlBaseUrl) env.FIRECRAWL_API_URL = firecrawlBaseUrl;
      return { id: item.id, name: item.name, serverName, kind: 'stdio', command: nodePath, args: [join(rootDir, 'server', 'connectors', 'web-research-mcp.mjs')], env, framing: 'newline', builtin: true };
    }
    if (item.kind === 'stdio') return { id: item.id, name: item.name, serverName, kind: 'stdio', command: item.command, args: Array.isArray(item.args) ? [...item.args] : [], env: { ...(item.env || {}) }, framing: FRAMINGS.has(item.framing) ? item.framing : 'newline', builtin: false };
    return { id: item.id, name: item.name, serverName, kind: 'url', url: item.url, transport: TRANSPORTS.has(item.transport) ? item.transport : 'http', headers: { ...(item.headers || {}) }, builtin: false };
  }

  async function find(state, id) {
    const item = state.connectors.find((entry) => entry.id === id);
    if (!item) throw fail('Connector not found.', 404);
    return item;
  }

  return {
    file,
    async list() { return (await load()).connectors.map(publicRecord); },
    async get(id) { return publicRecord(await find(await load(), id)); },
    async spec(id, options) { return launchSpec(await find(await load(), id), options); },
    create(input) {
      return serial(async () => {
        const state = await load();
        if (state.connectors.length >= 50) throw fail('At most 50 connectors are supported.');
        const item = { ...validate(input), id: `cn-${randomBytes(4).toString('hex')}`, enabled: false, createdAt: new Date(now()).toISOString(), lastTest: null };
        state.connectors.push(item);
        await save(state);
        return publicRecord(item);
      });
    },
    update(id, input) {
      return serial(async () => {
        const state = await load();
        const item = await find(state, id);
        let next;
        if (item.builtin) {
          next = { ...item, updatedAt: new Date(now()).toISOString() };
          if (record(input) && input.apiKey !== undefined) {
            if (input.apiKey === null) next.firecrawlApiKey = '';
            else { const key = cleanText(input.apiKey, 512, 'Firecrawl key'); if (key) next.firecrawlApiKey = key; }
          }
        } else {
          next = validate(input, item);
          if (next.kind !== item.kind || next.command !== item.command || next.url !== item.url) next.lastTest = null;
        }
        if (record(input) && typeof input.enabled === 'boolean') next.enabled = input.enabled;
        state.connectors[state.connectors.indexOf(item)] = next;
        await save(state);
        return publicRecord(next);
      });
    },
    remove(id) {
      return serial(async () => {
        const state = await load();
        const item = await find(state, id);
        if (item.builtin) throw fail('Web research is built in; turn it off instead of removing it.');
        state.connectors = state.connectors.filter((entry) => entry !== item);
        await save(state);
        return { id };
      });
    },
    setEnabled(id, enabled) {
      return serial(async () => {
        const state = await load();
        const item = await find(state, id);
        item.enabled = enabled === true;
        item.updatedAt = new Date(now()).toISOString();
        await save(state);
        return publicRecord(item);
      });
    },
    recordTest(id, result) {
      return serial(async () => {
        const state = await load();
        const item = await find(state, id);
        item.lastTest = normalizeTest({ ...result, at: new Date(now()).toISOString(), tools: (result.tools || []).map((tool) => (typeof tool === 'string' ? tool : tool?.name)).filter(Boolean), serverName: result.serverInfo?.name || '' });
        if (result.ok && item.kind === 'stdio' && FRAMINGS.has(result.framing)) item.framing = result.framing;
        await save(state);
        return publicRecord(item);
      });
    },
    /** Launch specs for every enabled connector, in display order. */
    async enabledSpecs(options) {
      return (await load()).connectors.filter((item) => item.enabled === true).map((item) => launchSpec(item, options));
    },
  };
}
