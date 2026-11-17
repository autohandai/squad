// The official MCP Registry (https://registry.modelcontextprotocol.io) as the
// connector catalogue: browsing and searching it, reading one server, and
// turning a server's packages and remotes into install options a person can
// fill in without typing a command (ADR-0244).
//
// Registry JSON is untrusted input. Everything read from it is reduced to a
// checked subset first (`sanitizeServer`): names become ids, URLs must be
// https (http only on loopback, for fixtures), packages must pin a version,
// and every string is bounded. The catalogue never runs anything; a definition
// built here is saved through the connector store like a hand-made one.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';
import { looksSecret } from './store.mjs';

export const DEFAULT_REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0/servers';
const PAGE_LIMIT = 60;
const SEARCH_TIMEOUT_MS = 45_000; // registry search often takes 20-30 s
const LOOKUP_TIMEOUT_MS = 15_000;
const FIRST_PAGE_FRESH_MS = 10 * 60_000;
const EMPTY_PAGE_SKIPS = 3;
const BROWSE_BUDGET_MS = 40_000;
const RETRY_DELAYS_MS = [500, 1500];

const NAME = /^[A-Za-z0-9.-]{1,120}\/[A-Za-z0-9._-]{1,120}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/;
const PACKAGE_COMMANDS = { npm: 'npx', pypi: 'uvx', oci: 'docker', nuget: 'dnx' };
const RUNTIME_LABELS = { npx: 'Node.js (npx)', uvx: 'uv (uvx)', docker: 'Docker', dnx: '.NET 10 (dnx)' };

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function isLoopback(hostname) {
  return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname);
}

/** An https URL (http only on loopback), or '' when it is anything else. */
export function safeUrl(value, { allowTemplate = false } = {}) {
  const raw = text(value, 2048);
  if (!raw) return '';
  const probe = allowTemplate ? raw.replace(/\{[A-Za-z0-9_.-]{1,64}\}/g, 'x') : raw;
  let parsed;
  try { parsed = new URL(probe); } catch { return ''; }
  if (parsed.username || parsed.password || parsed.hash) return '';
  if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLoopback(parsed.hostname))) return raw;
  return '';
}

function inputList(list, mapper) {
  return (Array.isArray(list) ? list : []).filter(record).slice(0, 32).map(mapper).filter(Boolean);
}

function sanitizeInput(entry, { nameRule = ENV_NAME, secretDefault = false } = {}) {
  const name = text(entry.name, 128);
  if (!name || !nameRule.test(name)) return null;
  return {
    name,
    description: text(entry.description, 300),
    // Raw registry keys (isSecret) or an already checked copy (secret): the cache stores the latter.
    // A value whose name looks like a key is sealed even when the registry forgot to say so.
    secret: (typeof entry.isSecret === 'boolean' ? entry.isSecret : typeof entry.secret === 'boolean' ? entry.secret : secretDefault) || looksSecret(entry.name),
    required: entry.isRequired === true || entry.required === true,
    default: typeof entry.default === 'string' ? entry.default.slice(0, 512) : '',
    value: typeof entry.value === 'string' ? entry.value.slice(0, 512) : null,
    valueHint: text(entry.valueHint, 80),
    format: text(entry.format, 20),
    choices: Array.isArray(entry.choices) ? entry.choices.filter((choice) => typeof choice === 'string').slice(0, 20).map((choice) => choice.slice(0, 120)) : [],
  };
}

function sanitizeArgument(entry) {
  const type = entry.type === 'named' ? 'named' : 'positional';
  const name = text(entry.name, 128);
  if (type === 'named' && !/^-{1,2}[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return null;
  return {
    type,
    name,
    description: text(entry.description, 300),
    secret: entry.isSecret === true || entry.secret === true || looksSecret(entry.valueHint) || (type === 'named' && looksSecret(name)),
    required: entry.isRequired === true || entry.required === true,
    default: typeof entry.default === 'string' ? entry.default.slice(0, 512) : null,
    value: typeof entry.value === 'string' ? entry.value.slice(0, 1024) : null,
    valueHint: text(entry.valueHint, 80),
    format: text(entry.format, 20),
    // `{name}` parts of a fixed value the person fills in (e.g. -e TOKEN={token}).
    variables: (Array.isArray(entry.variables) ? entry.variables.map((item) => [item?.name, item]) : Object.entries(record(entry.variables) ? entry.variables : {})).slice(0, 8)
      .map(([key, item]) => (record(item) ? sanitizeInput({ ...item, name: key }, { nameRule: /^[A-Za-z0-9_.-]{1,64}$/ }) : null)).filter(Boolean),
  };
}

/** The checked subset of one registry server, or null when it isn't usable. */
export function sanitizeServer(raw) {
  const server = record(raw?.server) ? raw.server : raw;
  if (!record(server)) return null;
  const name = text(server.name, 241);
  if (!NAME.test(name)) return null;
  const icons = (Array.isArray(server.icons) ? server.icons : []).filter(record).map((icon) => ({
    src: safeUrl(icon.src),
    mimeType: text(icon.mimeType, 40),
    theme: icon.theme === 'dark' || icon.theme === 'light' ? icon.theme : '',
  })).filter((icon) => icon.src && /^(image\/(svg\+xml|png|webp|jpeg))?$/.test(icon.mimeType)).slice(0, 4);
  const packages = (Array.isArray(server.packages) ? server.packages : []).filter(record).slice(0, 8).map((pkg) => ({
    registryType: text(pkg.registryType, 20),
    identifier: text(pkg.identifier, 300),
    version: text(pkg.version, 64),
    transport: text(typeof pkg.transport === 'string' ? pkg.transport : pkg.transport?.type, 30) || 'stdio',
    environmentVariables: inputList(pkg.environmentVariables, (entry) => sanitizeInput(entry)),
    runtimeArguments: inputList(pkg.runtimeArguments, sanitizeArgument),
    packageArguments: inputList(pkg.packageArguments, sanitizeArgument),
  })).filter((pkg) => pkg.identifier);
  const remotes = (Array.isArray(server.remotes) ? server.remotes : []).filter(record).slice(0, 16).map((remote) => ({
    type: text(remote.type, 30),
    url: safeUrl(remote.url, { allowTemplate: true }),
    headers: inputList(remote.headers, (entry) => sanitizeInput(entry, { nameRule: HEADER_NAME, secretDefault: true })),
    variables: (Array.isArray(remote.variables) ? remote.variables.map((entry) => [entry?.name, entry]) : Object.entries(record(remote.variables) ? remote.variables : {})).slice(0, 16)
      .map(([key, entry]) => (record(entry) ? sanitizeInput({ ...entry, name: key }, { nameRule: /^[A-Za-z0-9_.-]{1,64}$/ }) : null)).filter(Boolean),
  })).filter((remote) => remote.url);
  return {
    name,
    title: text(server.title, 80),
    description: text(server.description, 400),
    version: text(server.version, 64),
    websiteUrl: safeUrl(server.websiteUrl) || safeUrl(server.repository?.url),
    icons,
    packages,
    remotes,
  };
}

/** "com.notion/mcp" -> "Notion", "io.github.microsoft/playwright-mcp" -> "Playwright". */
export function titleFromName(name) {
  const [org = '', last = name] = String(name).includes('/') ? String(name).split('/') : ['', String(name)];
  let words = last.split(/[-_.]/).filter((word) => word && !['mcp', 'server'].includes(word.toLowerCase()));
  if (!words.length) words = [org.split('.').find((label) => !['com', 'io', 'app', 'ai', 'dev', 'org', 'github', 'net'].includes(label)) || org];
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * The exact package reference passed to the runtime. A floating version is
 * refused: a connector that silently changes under a member is not safe.
 */
export function packageReference(pkg) {
  const id = pkg.identifier;
  const unpinned = () => fail(`${id} has no pinned version in the MCP Registry, so Squad won't install it.`);
  // A version is a version: no ranges, tags, git or URL references that would float or fetch elsewhere.
  const pinned = (version) => /^[0-9][0-9A-Za-z.+-]{0,63}$/.test(String(version || ''));
  if (pkg.registryType === 'oci') {
    if (!/^[a-z0-9][a-z0-9._:/-]{0,255}$/.test(id.split('@')[0].replace(/:[^/:]*$/, ''))) throw fail(`${id.slice(0, 60)} isn't an image name Squad can run.`);
    const at = id.indexOf('@');
    if (at >= 0) {
      if (!/^sha256:[a-f0-9]{64}$/i.test(id.slice(at + 1))) throw unpinned();
      return id;
    }
    const last = id.split('/').pop() || '';
    const colon = last.lastIndexOf(':');
    const tag = colon >= 0 ? last.slice(colon + 1) : '';
    if (!pinned(tag) || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) throw unpinned();
    return id;
  }
  if (!/^[@A-Za-z0-9][A-Za-z0-9@/._-]{0,213}$/.test(id)) throw fail(`${id.slice(0, 60)} isn't a package name Squad can run.`);
  if (!pinned(pkg.version)) throw unpinned();
  return pkg.registryType === 'pypi' ? `${id}==${pkg.version}` : `${id}@${pkg.version}`;
}

/** Flags npx and uvx themselves take; anything else is the server's. */
const RUNNER_FLAGS = {
  npx: /^(-y|--yes|--no|-p|--package|-c|--call|--registry|--cache|--prefer-offline|--prefer-online|--offline|--include|--omit|--workspace|-w|--node-options)$/,
  uvx: /^(--from|--with|--with-editable|--with-requirements|-p|--python|--index|--index-url|--default-index|--extra-index-url|--find-links|-f|--isolated|--offline|--no-cache|--refresh|--upgrade|-U|--prerelease|--native-tls|--env-file)$/,
};

/** Docker run flags that reach outside the container. A catalogue entry asking for one is not installed by a click. */
const RISKY_DOCKER = /^(--privileged|-v|--volume|--mount|--pid|--ipc|--uts|--userns|--cap-add|--device|--security-opt|--network|--net)(=|$)/;
function riskyDockerFlag(argumentsList) {
  for (const argument of argumentsList) {
    const flag = argument.type === 'named' ? argument.name : String(argument.value || '');
    if (!RISKY_DOCKER.test(flag)) continue;
    const value = String(argument.value ?? argument.default ?? '');
    // A network flag is fine unless it is the host's own network.
    if (/^--net(work)?/.test(flag) && !/(^|=)host$/.test(flag.includes('=') ? flag : value)) continue;
    return flag.split('=')[0];
  }
  return '';
}

/** The input an argument asks the person for, or null when the registry fixes it. */
function argumentInput(argument) {
  if (argument.value !== null) return null;
  if (argument.variables?.length) return null;
  // A named argument without a value is asked for (and left out when empty);
  // only a required boolean one is a fixed bare flag.
  if (argument.type === 'named') return argument.format === 'boolean' && argument.required ? null : argument.name.replace(/^-+/, '');
  return argument.valueHint || argument.name || 'value';
}

function describeInput(entry, { key, target, secret }) {
  return {
    key,
    label: entry.name && target !== 'arg' ? entry.name : key,
    description: entry.description || '',
    secret,
    required: entry.required === true,
    default: entry.default ?? '',
    placeholder: entry.valueHint || '',
    choices: entry.choices || [],
    target,
  };
}

/**
 * The ways a server can run here, each with what the person must fill in.
 * `runtimes` says which package runners exist on this computer; an option
 * whose runner is missing is still listed, marked with what to install.
 */
export function installOptions(server, runtimes = {}) {
  const options = [];
  server.packages.forEach((pkg, index) => {
    const command = PACKAGE_COMMANDS[pkg.registryType];
    if (!command || pkg.transport !== 'stdio') return;
    let reference = '';
    try { reference = packageReference(pkg); } catch { return; }
    const inputs = [
      ...pkg.environmentVariables.map((entry) => describeInput(entry, { key: entry.name, target: 'env', secret: entry.secret })),
      ...[...pkg.runtimeArguments, ...pkg.packageArguments].flatMap((argument) => {
        if (argument.value !== null && argument.variables?.length) {
          return argument.variables.map((variable) => describeInput({ ...variable, description: variable.description || argument.description, name: '' }, { key: variable.name, target: 'arg', secret: variable.secret }));
        }
        const key = argumentInput(argument);
        return key ? [describeInput({ ...argument, name: '', choices: argument.format === 'boolean' ? ['true', 'false'] : [] }, { key, target: 'arg', secret: argument.secret })] : [];
      }),
    ];
    const available = runtimes[command] !== false;
    const risky = command === 'docker' ? riskyDockerFlag(pkg.runtimeArguments) : '';
    // What will run, shown before Add; inputs appear as <NAME>, secrets as placeholders.
    let preview = '';
    try { const built = buildDefinition(server, `package:${index}`, Object.fromEntries(inputs.map((input) => [input.key, `<${input.key}>`]))); preview = [built.command, ...built.args].join(' '); } catch { preview = `${command} ${reference}`; }
    options.push({ id: `package:${index}`, kind: pkg.registryType, label: { npm: 'npm package', pypi: 'Python package', oci: 'Docker image', nuget: 'NuGet package' }[pkg.registryType], detail: reference, preview, runs: 'local', command, available: available && !risky, needs: available ? '' : RUNTIME_LABELS[command], blocked: risky ? `This image asks Docker for access to this computer (${risky}), so Squad won't add it from the catalogue. Add it as a custom connector if you trust it.` : '', inputs });
  });
  server.remotes.forEach((remote, index) => {
    if (!['streamable-http', 'sse'].includes(remote.type)) return;
    const inputs = [
      ...remote.variables.map((entry) => describeInput(entry, { key: entry.name, target: 'url', secret: entry.secret })),
      ...remote.headers.map((entry) => describeInput({ ...entry, valueHint: entry.valueHint || entry.value || '' }, { key: entry.name, target: 'header', secret: entry.secret })),
    ];
    options.push({ id: `remote:${index}`, kind: 'remote', label: 'Hosted', detail: remote.url, runs: 'hosted', transport: remote.type === 'sse' ? 'sse' : 'http', available: true, needs: '', inputs });
  });
  // Some servers list a remote per region or per product: one of each kind is enough.
  const seen = new Set();
  return options.filter((option) => (seen.has(option.kind) ? false : (seen.add(option.kind), true)));
}

/**
 * Command-line words for registry arguments, one group per argument. A
 * secret value never lands in the saved arguments: Docker's `-e NAME=value`
 * becomes `-e NAME` with NAME in the sealed environment, anything else a
 * `{{secret:key}}` placeholder the launcher fills from the sealed store.
 */
function argumentGroups(list, input, { env, argSecrets, docker }) {
  const groups = [];
  for (const argument of list) {
    let value;
    let secret = argument.secret;
    let secretKey = '';
    const key = argumentInput(argument);
    if (argument.value !== null && argument.variables?.length) {
      // A fixed value with parts to fill: an optional part left empty drops the whole argument.
      value = argument.value;
      let skip = false;
      for (const variable of argument.variables) {
        const filled = input(variable.name) ?? (variable.default || null);
        if (filled === null) {
          if (variable.required || argument.required) throw fail(`${variable.name} is required.`);
          skip = true;
          break;
        }
        if (variable.secret) { secret = true; secretKey ||= variable.name; }
        value = value.split(`{${variable.name}}`).join(filled);
      }
      if (skip) continue;
    } else if (key === null) value = argument.value;
    else {
      value = input(key) ?? argument.default ?? null;
      if (value === null) {
        if (argument.required) throw fail(`${key} is required.`);
        continue;
      }
      if (argument.type === 'named' && argument.format === 'boolean') {
        // A boolean flag is passed bare when on and left out when off.
        if (/^(true|yes|on|1)$/i.test(String(value))) groups.push([argument.name]);
        continue;
      }
      secretKey = key;
    }
    const group = [];
    if (argument.type === 'named' && argument.name) group.push(argument.name);
    if (value !== null && value !== undefined) {
      const text = String(value);
      const assignment = text.match(/^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/);
      if (secret && docker && argument.name === '-e' && assignment) {
        env.push({ key: assignment[1], value: assignment[2], secret: true });
        group.push(assignment[1]);
      } else if (secret) {
        const placeholder = String(secretKey || `arg${Object.keys(argSecrets).length + 1}`).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64);
        argSecrets[placeholder] = text;
        group.push(`{{secret:${placeholder}}}`);
      } else group.push(text);
    }
    groups.push(group);
  }
  return groups;
}

/** `{prefix}` in a header template filled with the person's value, or the value as is. */
function fillTemplate(template, value) {
  if (template && template.includes('{') && template.includes('}')) return template.replace(/\{[^}]*\}/, () => value);
  return value;
}

/**
 * A store definition for one install option and the person's inputs
 * (`{ KEY: value }`). Secret inputs are listed so the store seals them.
 */
export function buildDefinition(server, optionId, inputs = {}, { title = '' } = {}) {
  const [kind, rawIndex] = String(optionId || '').split(':');
  const index = Number(rawIndex);
  if (!['package', 'remote'].includes(kind) || !Number.isInteger(index) || index < 0) throw fail('Choose how to run this connector.');
  const input = (key) => {
    const value = record(inputs) ? inputs[key] : undefined;
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 8192) : null;
  };
  const registry = { name: server.name, version: server.version, option: optionId };
  const name = title || server.title || titleFromName(server.name);
  if (kind === 'package') {
    const pkg = server.packages[index];
    if (!pkg) throw fail('That install option no longer exists. Reopen the connector and try again.');
    const command = PACKAGE_COMMANDS[pkg.registryType];
    if (!command || pkg.transport !== 'stdio') throw fail('This package type isn\'t supported.');
    const risky = command === 'docker' ? riskyDockerFlag(pkg.runtimeArguments) : '';
    if (risky) throw fail(`This image asks Docker for access to this computer (${risky}), so Squad won't add it from the catalogue. Add it as a custom connector if you trust it.`, 409);
    const reference = packageReference(pkg);
    const env = [];
    for (const entry of pkg.environmentVariables) {
      const value = input(entry.name) ?? (entry.default || null);
      if (value === null) {
        if (entry.required) throw fail(`${entry.name} is required.`);
        continue;
      }
      env.push({ key: entry.name, value, secret: entry.secret });
    }
    const argSecrets = {};
    const docker = command === 'docker';
    const declaredEnv = env.map((pair) => pair.key);
    // Some entries list the server's own flags as runtime arguments (Supabase's
    // --project-ref, --read-only…). npx and uvx would read them as their own,
    // so a runtime flag the runner doesn't have goes after the package instead.
    const runnerFlag = RUNNER_FLAGS[command];
    const runtimeList = runnerFlag ? pkg.runtimeArguments.filter((argument) => argument.type !== 'named' || runnerFlag.test(argument.name)) : pkg.runtimeArguments;
    const moved = runnerFlag ? pkg.runtimeArguments.filter((argument) => !runtimeList.includes(argument)) : [];
    const runtime = argumentGroups(runtimeList, input, { env, argSecrets, docker });
    const packageArgs = argumentGroups([...moved, ...pkg.packageArguments], input, { env, argSecrets, docker });
    const args = command === 'npx' ? ['-y'] : docker ? ['run', '-i', '--rm', ...declaredEnv.flatMap((key) => ['-e', key])] : [];
    // Skip a bare flag Squad already passes (-y, -i, --rm); keep every flag-with-value group.
    for (const group of runtime) if (!(group.length === 1 && group[0].startsWith('-') && args.includes(group[0]))) args.push(...group);
    args.push(reference);
    if (pkg.registryType === 'nuget') args.push('--yes');
    args.push(...packageArgs.flat());
    return { name, kind: 'stdio', command, args, env, argSecrets, registry, description: server.description };
  }
  const remote = server.remotes[index];
  if (!remote) throw fail('That install option no longer exists. Reopen the connector and try again.');
  let url = remote.url;
  for (const variable of remote.variables) {
    const value = input(variable.name) ?? (variable.default || null);
    if (value === null) throw fail(`${variable.name} is required.`);
    url = url.split(`{${variable.name}}`).join(encodeURIComponent(value));
  }
  if (/\{[^}]*\}/.test(url)) throw fail('This server\'s address has parts the registry doesn\'t describe; add it as a custom connector.');
  if (!safeUrl(url)) throw fail('The registry gave an address Squad won\'t connect to.');
  const headers = [];
  for (const header of remote.headers) {
    const value = input(header.name);
    if (value === null) {
      if (header.required) throw fail(`${header.name} is required.`);
      continue;
    }
    let filled = fillTemplate(header.value, value);
    // A bare token typed for an Authorization header without a template is a bearer token.
    if (!header.value && header.name.toLowerCase() === 'authorization' && !/^(bearer|basic|token)\s/i.test(filled)) filled = `Bearer ${filled}`;
    headers.push({ key: header.name, value: filled, secret: header.secret });
  }
  return { name, kind: 'url', url, transport: remote.type === 'sse' ? 'sse' : 'http', headers, registry, description: server.description };
}

/** A registry server as a catalogue row. */
export function listing(server, { installed = [], runtimes = {}, featured = null } = {}) {
  const options = installOptions(server, runtimes);
  if (!options.length) return null;
  const match = installed.find((item) => item.registry?.name === server.name);
  return {
    name: server.name,
    title: featured?.title || server.title || titleFromName(server.name),
    description: featured?.description || server.description,
    version: server.version,
    website: featured?.website || server.websiteUrl,
    logo: featured?.logo || '',
    icon: (server.icons.find((icon) => icon.theme !== 'dark') || server.icons[0])?.src || '',
    iconDark: server.icons.find((icon) => icon.theme === 'dark')?.src || '',
    featured: Boolean(featured),
    installed: Boolean(match),
    installedId: match?.id || '',
    options,
  };
}

/**
 * Semver-style comparison; >0 when a is newer. A pre-release sorts before its
 * release (2.0.0-rc.1 < 2.0.0) and build metadata (+…) is ignored.
 */
export function compareVersions(a, b) {
  const part = (value) => (/^\d+$/.test(value) ? Number(value) : value);
  const parse = (value) => {
    const [core, ...pre] = String(value || '').split('+')[0].split('-');
    return { core: core.split('.').map(part), pre: pre.length ? pre.join('-').split('.').map(part) : [] };
  };
  const compare = (left, right, missing) => {
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const x = left[index] ?? missing, y = right[index] ?? missing;
      if (x === y) continue;
      if (x === undefined) return -1;
      if (y === undefined) return 1;
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      if (typeof x === 'number') return -1;
      if (typeof y === 'number') return 1;
      return String(x).localeCompare(String(y));
    }
    return 0;
  };
  const left = parse(a), right = parse(b);
  const core = compare(left.core, right.core, 0);
  if (core) return core;
  if (!left.pre.length || !right.pre.length) return right.pre.length - left.pre.length;
  return compare(left.pre, right.pre, undefined);
}

/**
 * The registry client. `fetchRequest` is injectable for checks; the cache
 * file keeps the last good first page so the catalogue opens offline.
 */
export function createRegistry({ registryUrl = DEFAULT_REGISTRY_URL, stateDir, rootDir, fetchRequest = fetch, now = () => Date.now(), featured = [], log = () => {} } = {}) {
  const cacheFile = stateDir ? join(stateDir, 'connector-catalog-cache.json') : '';
  const snapshotFile = rootDir ? join(rootDir, 'server', 'connectors', 'catalog-snapshot.json') : '';
  let firstPage = null; // { at, servers, next }
  let refreshing = null;

  async function getJson(url, timeoutMs) {
    let last;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const response = await fetchRequest(url, { headers: { accept: 'application/json', 'user-agent': 'autohand-squad' }, signal: AbortSignal.timeout(timeoutMs) });
        if (response.status === 404) throw Object.assign(fail('Not in the MCP Registry.', 404), { final: true });
        if (response.ok) return await response.json();
        last = fail(`The MCP Registry answered ${response.status}.`, 502);
        if (response.status < 500 && response.status !== 429) { last.final = true; throw last; }
      } catch (error) {
        if (error.final) throw error;
        last = ['TimeoutError', 'AbortError'].includes(error?.name) ? fail('The MCP Registry took too long to answer.', 504) : error.status ? error : fail('Can\'t reach the MCP Registry. Check this computer\'s connection.', 503);
      }
      if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
    }
    throw last;
  }

  async function page(search, cursor, limit = PAGE_LIMIT) {
    const url = new URL(registryUrl);
    url.searchParams.set('version', 'latest');
    url.searchParams.set('limit', String(limit));
    if (search) url.searchParams.set('search', search);
    if (cursor) url.searchParams.set('cursor', cursor);
    const body = await getJson(url, SEARCH_TIMEOUT_MS);
    const servers = (Array.isArray(body?.servers) ? body.servers : []).map(sanitizeServer).filter(Boolean);
    const next = typeof body?.metadata?.nextCursor === 'string' && body.metadata.nextCursor && body.metadata.nextCursor !== cursor ? body.metadata.nextCursor.slice(0, 512) : null;
    return { servers, next };
  }

  async function server(name) {
    if (!NAME.test(String(name || ''))) throw fail('That isn\'t an MCP Registry name.');
    const url = new URL(registryUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(name)}/versions/latest`;
    const found = sanitizeServer(await getJson(url, LOOKUP_TIMEOUT_MS));
    if (!found || found.name !== name) throw fail(`${name} isn't in the MCP Registry.`, 404);
    return found;
  }

  async function snapshot() {
    if (!snapshotFile) return [];
    try { return (JSON.parse(await readFile(snapshotFile, 'utf8')).servers || []).map(sanitizeServer).filter(Boolean); } catch { return []; }
  }
  async function cached() {
    if (!cacheFile) return null;
    const stored = await readPersistentJson(cacheFile, null).catch(() => null);
    if (!record(stored) || !Array.isArray(stored.servers)) return null;
    return { at: Number(stored.at) || 0, servers: stored.servers.map(sanitizeServer).filter(Boolean), next: typeof stored.next === 'string' ? stored.next : null };
  }

  async function fetchFirstPage() {
    const names = featured.map((entry) => entry.registryName).filter(Boolean);
    const [lookups, rest] = await Promise.all([
      Promise.allSettled(names.map((name) => server(name))),
      page('', '').then((value) => ({ value }), (error) => ({ error })),
    ]);
    const found = lookups.filter((outcome) => outcome.status === 'fulfilled').map((outcome) => outcome.value);
    if (rest.error && !found.length) throw rest.error;
    const servers = [...found, ...(rest.value?.servers || []).filter((item) => !names.includes(item.name))];
    const result = { at: now(), servers, next: rest.value?.next || null };
    if (!rest.error && found.length === names.length) {
      firstPage = result;
      if (cacheFile) await writePersistentJson(cacheFile, result).catch((error) => log(`connector catalogue cache not saved: ${error.message}`));
    }
    return result;
  }

  /**
   * The unfiltered first page: featured servers first, then the registry's
   * first page. Served from memory when fresh, refreshed in the background
   * when stale; offline it falls back to the saved copy, then to the
   * snapshot shipped with Squad.
   */
  async function firstPageServers() {
    if (firstPage && now() - firstPage.at < FIRST_PAGE_FRESH_MS) return { ...firstPage, source: 'live' };
    if (firstPage) {
      refreshing ||= fetchFirstPage().catch(() => null).finally(() => { refreshing = null; });
      return { ...firstPage, source: 'live' };
    }
    try {
      return { ...(await (refreshing ||= fetchFirstPage().finally(() => { refreshing = null; }))), source: 'live' };
    } catch (error) {
      const saved = await cached();
      if (saved?.servers.length) return { ...saved, source: 'cache', error: error.message };
      return { at: 0, servers: await snapshot(), next: null, source: 'snapshot', error: error.message };
    }
  }

  /**
   * One page of rows. A page with nothing Squad can install reads on (up to
   * EMPTY_PAGE_SKIPS pages, within BROWSE_BUDGET_MS) so a person isn't shown
   * an empty list with a "more" button.
   */
  async function browse({ search = '', cursor = '', installed = [], runtimes = {} } = {}) {
    const query = text(search, 120);
    const deadline = now() + BROWSE_BUDGET_MS;
    const featuredByName = new Map(featured.filter((entry) => entry.registryName).map((entry) => [entry.registryName, entry]));
    const rows = (servers) => {
      const seen = new Set();
      return servers.filter((item) => (seen.has(item.name) ? false : (seen.add(item.name), true)))
        .map((item) => listing(item, { installed, runtimes, featured: featuredByName.get(item.name) || null })).filter(Boolean);
    };
    let result;
    if (!query && !cursor) result = await firstPageServers();
    else {
      const loaded = await page(query, cursor);
      result = { ...loaded, servers: query ? loaded.servers : loaded.servers.filter((item) => !featuredByName.has(item.name)), source: 'live' };
    }
    let items = rows(result.servers);
    let next = result.next;
    let asked = cursor;
    for (let skip = 0; skip < EMPTY_PAGE_SKIPS && !items.length && next && next !== asked; skip += 1) {
      if (now() >= deadline) break;
      asked = next;
      const loaded = await page(query, asked);
      items = rows(query ? loaded.servers : loaded.servers.filter((item) => !featuredByName.has(item.name)));
      next = loaded.next;
    }
    return { items, nextCursor: next && next !== asked ? next : null, source: result.source, ...(result.error ? { notice: result.error } : {}) };
  }

  /** One server, live; offline, from the saved first page or the snapshot. */
  async function lookup(name) {
    try { return await server(name); } catch (error) {
      if (error.status === 404 || error.status === 400) throw error;
      const known = [...(firstPage?.servers || []), ...((await cached())?.servers || []), ...await snapshot()].find((item) => item.name === name);
      if (known) return known;
      throw error;
    }
  }

  return { browse, lookup, server, page, snapshot };
}
