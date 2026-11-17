#!/usr/bin/env node
// The connector catalogue (ADR-0244) without the bridge: registry.mjs turns
// untrusted MCP Registry JSON into install options and store definitions, and
// its client pages, caches and falls back offline; health.mjs words each
// connector state. Registry answers come from an injected fetch built over
// the real catalog-snapshot.json entries. Nothing reaches the network.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildDefinition, compareVersions, createRegistry, installOptions, packageReference, sanitizeServer } from '../server/connectors/registry.mjs';
import { connectorHealth, plainError } from '../server/connectors/health.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const directory = await mkdtemp(join(tmpdir(), 'squad-connector-catalog-'));
const snapshot = JSON.parse(await readFile(join(root, 'server', 'connectors', 'catalog-snapshot.json'), 'utf8'));
const raw = (name) => { const found = snapshot.servers.find((entry) => entry.name === name); assert.ok(found, `snapshot has ${name}`); return structuredClone(found); };
const GITHUB = 'io.github.github/github-mcp-server', SUPABASE = 'com.supabase/mcp', CONTEXT7 = 'io.github.upstash/context7', LINEAR = 'app.linear/linear', CLOUDFLARE = 'com.cloudflare.mcp/mcp';
const throwsStatus = (operation, pattern, status = 400) => assert.throws(operation, (error) => pattern.test(error.message) && error.status === status, `expected ${pattern}`);
const covered = [];

try {
  // ------------------------------------------------------------ sanitizeServer
  for (const name of ['', 'noslash', 'a/b/c', 'a b/c', 'org/', '/name', 'org/<script>', `${'a'.repeat(121)}/x`, 'org/na me']) {
    assert.equal(sanitizeServer({ name, remotes: [{ type: 'streamable-http', url: 'https://ok.example/mcp' }] }), null, `name ${JSON.stringify(name)} refused`);
  }
  assert.equal(sanitizeServer(null), null);
  assert.equal(sanitizeServer('io.x/y'), null);
  const hostile = sanitizeServer({ server: {
    name: 'io.example/hostile', title: `  Hostile\n\n  ${'T'.repeat(200)}`, description: 'd'.repeat(5000), version: '1.0.0',
    websiteUrl: 'http://example.com', repository: { url: 'https://github.com/example/hostile' },
    icons: [{ src: 'https://example.com/i.svg', mimeType: 'image/svg+xml', theme: 'dark' }, { src: 'https://example.com/i.exe', mimeType: 'application/x-msdownload' }, { src: 'http://example.com/i.png', mimeType: 'image/png' }],
    remotes: [
      { type: 'streamable-http', url: 'http://example.com/mcp' },
      { type: 'streamable-http', url: 'https://user:pass@example.com/mcp' },
      { type: 'streamable-http', url: 'https://example.com/mcp#frag' },
      { type: 'streamable-http', url: 'javascript:alert(1)' },
      { type: 'sse', url: 'ftp://example.com/sse' },
      { type: 'streamable-http', url: 'http://127.0.0.1:4100/mcp' },
      { type: 'streamable-http', url: 'http://localhost:4100/mcp' },
      { type: 'streamable-http', url: 'https://ok.example.com/mcp', headers: [{ name: 'X-Api-Key' }, { name: 'X-Region', isSecret: false }, { name: 'Bad Header' }, { name: 'X-Long', description: 'x'.repeat(900) }] },
    ],
    packages: [{ registryType: 'npm', identifier: 'pkg', version: '1.0.0', environmentVariables: [{ name: 'GOOD_NAME' }, { name: '1BAD' }, { name: 'ALSO BAD' }] }, { registryType: 'npm', identifier: '' }],
  } });
  assert.deepEqual(hostile.remotes.map((remote) => remote.url), ['http://127.0.0.1:4100/mcp', 'http://localhost:4100/mcp', 'https://ok.example.com/mcp'], 'non-https (except loopback), credentials and fragments are dropped');
  assert.equal(hostile.websiteUrl, 'https://github.com/example/hostile', 'an http website falls back to the https repository');
  assert.deepEqual(hostile.icons.map((icon) => icon.src), ['https://example.com/i.svg'], 'only https icons with an image type survive');
  assert.equal(hostile.title.length, 80); assert.ok(!/\n|\s{2}/.test(hostile.title), 'whitespace collapsed');
  assert.equal(hostile.description.length, 400);
  const headers = hostile.remotes[2].headers;
  assert.deepEqual(headers.map((header) => [header.name, header.secret]), [['X-Api-Key', true], ['X-Region', false], ['X-Long', true]], 'headers are secret unless the registry says otherwise; bad names dropped');
  assert.equal(headers[2].description.length, 300);
  assert.equal(hostile.packages.length, 1);
  assert.deepEqual(hostile.packages[0].environmentVariables.map((entry) => entry.name), ['GOOD_NAME']);
  // Idempotent on its own output (the disk cache stores sanitized servers and reads them back through here).
  const samples = [...snapshot.servers, { server: hostile }, {
    name: 'io.example/vars', version: '2.0.0',
    remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com/{workspace}/mcp', variables: { workspace: { description: 'Workspace', isRequired: true } }, headers: [{ name: 'Authorization', value: 'Bearer {api_key}', isSecret: true }] }],
    packages: [{ registryType: 'pypi', identifier: 'mcp-x', version: '0.1.0', packageArguments: [{ type: 'positional', valueHint: 'api_key', isSecret: true, isRequired: true }, { type: 'named', name: '--mode', default: 'safe' }] }],
  }];
  for (const sample of samples) {
    const once = sanitizeServer(sample);
    assert.ok(once, `sanitizes ${sample.name || sample.server?.name}`);
    assert.deepEqual(sanitizeServer(once), once, `sanitizeServer is idempotent for ${once.name}`);
    assert.deepEqual(sanitizeServer(JSON.parse(JSON.stringify(once))), once, `and survives a JSON round trip for ${once.name}`);
  }
  covered.push('sanitize');

  // -------------------------------------------------------- packageReference
  for (const version of ['latest', '^1', '^1.2.0', '~1', '~1.2', '*', '', undefined, '>=1.0.0', '1.0.0 || 2.0.0']) {
    throwsStatus(() => packageReference({ registryType: 'npm', identifier: 'some-mcp', version }), /no pinned version/);
    throwsStatus(() => packageReference({ registryType: 'pypi', identifier: 'some-mcp', version }), /no pinned version/);
  }
  assert.equal(packageReference({ registryType: 'npm', identifier: '@scope/server', version: '1.2.3' }), '@scope/server@1.2.3');
  assert.equal(packageReference({ registryType: 'pypi', identifier: 'mcp-server-time', version: '2025.1.1' }), 'mcp-server-time==2025.1.1');
  throwsStatus(() => packageReference({ registryType: 'npm', identifier: 'evil; rm -rf ~', version: '1.0.0' }), /isn't a package name/);
  throwsStatus(() => packageReference({ registryType: 'npm', identifier: '--yes', version: '1.0.0' }), /isn't a package name/);
  for (const identifier of ['ghcr.io/org/image', 'ghcr.io/org/image:latest', 'localhost:5000/image', 'ghcr.io/org/image@sha256:abc', 'ghcr.io/org/image:^1']) {
    throwsStatus(() => packageReference({ registryType: 'oci', identifier }), /no pinned version/, 400);
  }
  const digest = `ghcr.io/org/image@sha256:${'a'.repeat(64)}`;
  assert.equal(packageReference({ registryType: 'oci', identifier: digest }), digest);
  assert.equal(packageReference({ registryType: 'oci', identifier: 'localhost:5000/image:1.4' }), 'localhost:5000/image:1.4');
  covered.push('packageReference');

  // ----------------------------------------------------------- installOptions
  const github = sanitizeServer(raw(GITHUB)), supabase = sanitizeServer(raw(SUPABASE)), context7 = sanitizeServer(raw(CONTEXT7)), linear = sanitizeServer(raw(LINEAR)), cloudflare = sanitizeServer(raw(CLOUDFLARE));
  const ctxOptions = installOptions(context7);
  assert.deepEqual(ctxOptions.map((option) => [option.id, option.kind, option.command || option.transport, option.detail]), [['package:0', 'npm', 'npx', '@upstash/context7-mcp@4.7.1'], ['remote:0', 'remote', 'http', 'https://mcp.context7.com/mcp']], 'the mcpb package is skipped, npm and the hosted option remain');
  assert.deepEqual(ctxOptions[0].inputs.map((input) => [input.key, input.target, input.secret, input.required]), [['CONTEXT7_API_KEY', 'env', true, false]], 'secret flag comes from the env var');
  assert.deepEqual(ctxOptions[1].inputs.map((input) => [input.key, input.target, input.secret]), [['Authorization', 'header', true]]);
  const missingNode = installOptions(context7, { npx: false });
  assert.equal(missingNode[0].available, false); assert.equal(missingNode[0].needs, 'Node.js (npx)'); assert.equal(missingNode[1].available, true);
  const ghOptions = installOptions(github, { docker: false });
  assert.deepEqual(ghOptions.map((option) => [option.kind, option.available, option.needs]), [['oci', false, 'Docker'], ['remote', true, '']]);
  assert.equal(ghOptions[0].detail, 'ghcr.io/github/github-mcp-server:2.2.0');
  assert.deepEqual(ghOptions[0].inputs.map((input) => [input.key, input.target, input.secret]), [['token', 'arg', true]], 'GITHUB_PERSONAL_ACCESS_TOKEN={token} asks for the token only');
  const cfOptions = installOptions(cloudflare);
  assert.equal(cfOptions.length, 1, 'thirty Cloudflare remotes collapse to one hosted option');
  assert.equal(cfOptions[0].detail, 'https://docs.mcp.cloudflare.com/mcp');
  assert.equal(installOptions(linear).length, 1);
  const multi = sanitizeServer({
    name: 'io.example/multi', version: '1.0.0',
    packages: [
      { registryType: 'npm', identifier: 'first-mcp', version: '1.0.0' },
      { registryType: 'npm', identifier: 'second-mcp', version: '1.0.0' },
      { registryType: 'npm', identifier: 'floating-mcp', version: 'latest' },
      { registryType: 'pypi', identifier: 'mcp-server-time', version: '2025.1.1' },
      { registryType: 'nuget', identifier: 'Contoso.Mcp', version: '1.2.3' },
      { registryType: 'oci', identifier: 'docker.io/example/mcp:3.1.0', environmentVariables: [{ name: 'API_KEY', isSecret: true, isRequired: true }, { name: 'REGION', default: 'eu' }] },
      { registryType: 'npm', identifier: 'http-only', version: '1.0.0', transport: { type: 'streamable-http' } },
    ],
    remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com/{workspace}/mcp', variables: { workspace: { description: 'Workspace slug', isRequired: true } }, headers: [{ name: 'X-Api-Key' }] }, { type: 'sse', url: 'https://mcp.example.com/sse' }],
  });
  const multiOptions = installOptions(multi, { uvx: false, dnx: false });
  assert.deepEqual(multiOptions.map((option) => [option.id, option.kind, option.command || option.transport, option.available, option.needs]), [
    ['package:0', 'npm', 'npx', true, ''], ['package:3', 'pypi', 'uvx', false, 'uv (uvx)'], ['package:4', 'nuget', 'dnx', false, '.NET 10 (dnx)'], ['package:5', 'oci', 'docker', true, ''], ['remote:0', 'remote', 'http', true, ''],
  ], 'one option per kind; floating and non-stdio packages are not offered');
  assert.deepEqual(multiOptions[3].inputs.map((input) => [input.key, input.secret, input.required, input.default]), [['API_KEY', true, true, ''], ['REGION', false, false, 'eu']]);
  assert.deepEqual(multiOptions[4].inputs.map((input) => [input.key, input.target, input.required, input.secret]), [['workspace', 'url', true, false], ['X-Api-Key', 'header', false, true]], 'URL variables and headers (secret by default)');
  // Supabase's named arguments carry no value: they are optional inputs, never bare flags.
  const sbInputs = installOptions(supabase)[0].inputs;
  assert.deepEqual(sbInputs.map((input) => [input.key, input.target]), [['SUPABASE_ACCESS_TOKEN', 'env'], ['project-ref', 'arg'], ['read-only', 'arg'], ['features', 'arg'], ['api-url', 'arg']]);
  covered.push('installOptions');

  // ----------------------------------------------------------- buildDefinition
  const ctxDef = buildDefinition(context7, 'package:0', { CONTEXT7_API_KEY: '  ctx7sk-secret-1  ' });
  assert.deepEqual([ctxDef.kind, ctxDef.command, ctxDef.args], ['stdio', 'npx', ['-y', '@upstash/context7-mcp@4.7.1']]);
  assert.deepEqual(ctxDef.env, [{ key: 'CONTEXT7_API_KEY', value: 'ctx7sk-secret-1', secret: true }]);
  assert.deepEqual(ctxDef.registry, { name: CONTEXT7, version: '4.7.1', option: 'package:0' });
  assert.deepEqual(buildDefinition(multi, 'package:3').args, ['mcp-server-time==2025.1.1']);
  assert.deepEqual(buildDefinition(multi, 'package:4').args, ['Contoso.Mcp@1.2.3', '--yes']);
  throwsStatus(() => buildDefinition(supabase, 'package:0', {}), /SUPABASE_ACCESS_TOKEN is required/);
  const sbDef = buildDefinition(supabase, 'package:0', { SUPABASE_ACCESS_TOKEN: 'sbp_secret_token' });
  assert.deepEqual(sbDef.args, ['-y', '@supabase/mcp-server-supabase@0.17.0'], 'unfilled named arguments are left out, not passed as bare flags that swallow the package name');
  assert.deepEqual(buildDefinition(supabase, 'package:0', { SUPABASE_ACCESS_TOKEN: 'sbp_secret_token', 'project-ref': 'abcd', 'read-only': 'true', features: 'database,docs' }).args, ['-y', '--project-ref', 'abcd', '--read-only', '--features', 'database,docs', '@supabase/mcp-server-supabase@0.17.0']);
  assert.ok(!buildDefinition(supabase, 'package:0', { SUPABASE_ACCESS_TOKEN: 'x', 'read-only': 'false' }).args.includes('--read-only'), 'a boolean flag set to false is left out');
  // Docker: a secret -e NAME=value becomes -e NAME plus a sealed env entry.
  const ghDocker = buildDefinition(github, 'package:0', { token: 'ghp_docker_secret_123' });
  assert.equal(ghDocker.command, 'docker');
  assert.deepEqual(ghDocker.args, ['run', '-i', '--rm', '-p', '127.0.0.1:8085:8085', '-e', 'GITHUB_OAUTH_CALLBACK_PORT=8085', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server:2.2.0']);
  assert.deepEqual(ghDocker.env, [{ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', value: 'ghp_docker_secret_123', secret: true }]);
  assert.ok(!JSON.stringify(ghDocker.args).includes('ghp_docker_secret_123'), 'the token never sits in the arguments');
  assert.deepEqual(buildDefinition(github, 'package:0', {}).args, ['run', '-i', '--rm', '-p', '127.0.0.1:8085:8085', '-e', 'GITHUB_OAUTH_CALLBACK_PORT=8085', 'ghcr.io/github/github-mcp-server:2.2.0'], 'an optional token left empty drops its -e');
  const dockerEnv = buildDefinition(multi, 'package:5', { API_KEY: 'k-secret-docker' });
  assert.deepEqual(dockerEnv.args, ['run', '-i', '--rm', '-e', 'API_KEY', '-e', 'REGION', 'docker.io/example/mcp:3.1.0']);
  assert.deepEqual(dockerEnv.env, [{ key: 'API_KEY', value: 'k-secret-docker', secret: true }, { key: 'REGION', value: 'eu', secret: false }]);
  // A secret positional argument becomes a placeholder; its value goes to argSecrets.
  const vars = sanitizeServer(samples.at(-1));
  const posDef = buildDefinition(vars, 'package:0', { api_key: 'pos-secret-777' });
  assert.deepEqual(posDef.args, ['mcp-x==0.1.0', '{{secret:api_key}}', '--mode', 'safe']);
  assert.deepEqual(posDef.argSecrets, { api_key: 'pos-secret-777' });
  assert.ok(!posDef.args.join(' ').includes('pos-secret-777'));
  throwsStatus(() => buildDefinition(vars, 'package:0', {}), /api_key is required/);
  // Remotes: URL variables encoded, header templates, bare Authorization tokens.
  const urlDef = buildDefinition(vars, 'remote:0', { workspace: 'team one/x?', api_key: 'abc123' });
  assert.equal(urlDef.url, 'https://mcp.example.com/team%20one%2Fx%3F/mcp');
  assert.deepEqual(urlDef.headers, []);
  throwsStatus(() => buildDefinition(vars, 'remote:0', {}), /workspace is required/);
  const templated = sanitizeServer({ name: 'io.example/tpl', version: '1', remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: [{ name: 'Authorization', value: 'Bearer {api_key}', isSecret: true }] }] });
  assert.deepEqual(buildDefinition(templated, 'remote:0', { Authorization: 'tok-xyz' }).headers, [{ key: 'Authorization', value: 'Bearer tok-xyz', secret: true }]);
  assert.deepEqual(buildDefinition(context7, 'remote:0', { Authorization: 'ctx7sk-raw' }).headers, [{ key: 'Authorization', value: 'Bearer ctx7sk-raw', secret: true }], 'a bare token gains Bearer');
  assert.deepEqual(buildDefinition(context7, 'remote:0', { Authorization: 'Bearer ctx7sk-raw' }).headers[0].value, 'Bearer ctx7sk-raw');
  assert.deepEqual(buildDefinition(context7, 'remote:0', {}).headers, [], 'an optional header left empty is left out');
  const cfObs = sanitizeServer({ ...raw(CLOUDFLARE), remotes: [raw(CLOUDFLARE).remotes[1]] });
  assert.deepEqual(buildDefinition(cfObs, 'remote:0', { Authentication: 'cf-token' }).headers, [{ key: 'Authentication', value: 'cf-token', secret: true }], 'only Authorization gains Bearer');
  const requiredHeader = sanitizeServer({ name: 'io.example/req', version: '1', remotes: [{ type: 'sse', url: 'https://mcp.example.com/sse', headers: [{ name: 'X-Key', isRequired: true }] }] });
  throwsStatus(() => buildDefinition(requiredHeader, 'remote:0', {}), /X-Key is required/);
  assert.equal(buildDefinition(requiredHeader, 'remote:0', { 'X-Key': 'k' }).transport, 'sse');
  const undescribed = sanitizeServer({ name: 'io.example/undescribed', version: '1', remotes: [{ type: 'streamable-http', url: 'https://{tenant}.example.com/mcp' }] });
  throwsStatus(() => buildDefinition(undescribed, 'remote:0', {}), /add it as a custom connector/);
  throwsStatus(() => buildDefinition(linear, 'remote:7', {}), /no longer exists/);
  throwsStatus(() => buildDefinition(linear, 'bogus', {}), /Choose how to run/);
  assert.equal(buildDefinition(linear, 'remote:0', {}, { title: 'My Linear' }).name, 'My Linear');
  covered.push('buildDefinition');

  // ---------------------------------------------------------- compareVersions
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.ok(compareVersions('0.17.0', '0.17.1') < 0);
  assert.equal(compareVersions('2.2.0', '2.2.0'), 0);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.ok(compareVersions('2.0.0', '2.0.0-beta.1') > 0, 'a release is newer than its pre-release');
  assert.ok(compareVersions('2.0.0-rc.1', '2.0.0') < 0, 'a pre-release is not an update over the release');
  assert.ok(compareVersions('2.0.0-beta.10', '2.0.0-beta.2') > 0);
  assert.ok(compareVersions('2.0.1-beta', '2.0.0') > 0);
  assert.equal(compareVersions('1.0.0+build.5', '1.0.0'), 0, 'build metadata does not order versions');
  covered.push('compareVersions');

  // ----------------------------------------------------------- createRegistry
  const REGISTRY = 'http://127.0.0.1:9/v0/servers';
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const wrap = (entry) => ({ server: entry, _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } } });
  const unusable = (index) => ({ name: `io.example/unusable-${index}`, version: '1.0.0', packages: [{ registryType: 'mcpb', identifier: 'https://example.com/x.mcpb', version: '1.0.0' }] });
  const pages = {
    '': { servers: [raw(GITHUB), raw(LINEAR), raw(CONTEXT7)], metadata: { nextCursor: 'c2' } },
    c2: { servers: [unusable(1)], metadata: { nextCursor: 'c3' } },
    c3: { servers: [], metadata: { nextCursor: 'c4' } },
    c4: { servers: [raw(CLOUDFLARE)], metadata: { nextCursor: 'c5' } },
    e0: { servers: [], metadata: { nextCursor: 'e1' } },
    e1: { servers: [unusable(2)], metadata: { nextCursor: 'e2' } },
    e2: { servers: [], metadata: { nextCursor: 'e3' } },
    e3: { servers: [], metadata: { nextCursor: 'e4' } },
    e4: { servers: [raw(LINEAR)], metadata: {} },
    r1: { servers: [raw(LINEAR)], metadata: { nextCursor: 'r1' } },
    q0: { servers: [], metadata: { nextCursor: 'q0' } },
  };
  const searches = { linear: { servers: [raw(LINEAR)], metadata: { nextCursor: 's2' } }, 'linear@s2': { servers: [raw(CLOUDFLARE)], metadata: {} } };
  const calls = [];
  const failures = { flaky: [503, 503, 503], limited: [429], gone: [400] };
  let offline = false;
  const fetchRequest = async (target) => {
    const url = new URL(target);
    calls.push(url.pathname + url.search);
    if (offline) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    assert.equal(url.origin + url.pathname.split('/').slice(0, 3).join('/'), 'http://127.0.0.1:9/v0/servers');
    const lookup = url.pathname.match(/^\/v0\/servers\/(.+)\/versions\/latest$/);
    if (lookup) {
      const name = decodeURIComponent(lookup[1]);
      const found = snapshot.servers.find((entry) => entry.name === name);
      return found ? json(200, wrap(found)) : json(404, { error: 'not found' });
    }
    assert.equal(url.searchParams.get('version'), 'latest');
    const search = url.searchParams.get('search') || '', cursor = url.searchParams.get('cursor') || '';
    if (failures[search]?.length) return json(failures[search].shift(), { error: 'busy' });
    if (search === 'limited' || search === 'flaky') return json(200, { servers: [raw(LINEAR)], metadata: {} });
    const body = search ? searches[cursor ? `${search}@${cursor}` : search] : pages[cursor];
    return json(200, { ...(body || { servers: [] }), servers: (body?.servers || []).map(wrap) });
  };
  let clock = Date.parse('2026-11-17T10:00:00Z');
  const featured = [{ registryName: SUPABASE, title: 'Supabase', description: 'Databases.', logo: 'supabase' }, { registryName: GITHUB, title: 'GitHub', logo: 'github' }];
  const stateDir = join(directory, 'state');
  const registry = createRegistry({ registryUrl: REGISTRY, stateDir, rootDir: root, fetchRequest, now: () => clock, featured });
  const first = await registry.browse();
  assert.equal(first.source, 'live');
  assert.deepEqual(first.items.slice(0, 2).map((item) => [item.name, item.featured, item.title]), [[SUPABASE, true, 'Supabase'], [GITHUB, true, 'GitHub']], 'featured servers lead the first page');
  assert.deepEqual(first.items.map((item) => item.name), [SUPABASE, GITHUB, LINEAR, CONTEXT7], 'a featured server is not repeated from the page');
  assert.equal(first.nextCursor, 'c2');
  const firstCalls = calls.length;
  assert.equal(firstCalls, 3, 'two featured lookups and one page');
  const again = await registry.browse({ installed: [{ id: 'cn-1', registry: { name: LINEAR } }] });
  assert.equal(calls.length, firstCalls, 'the first page is served from memory');
  assert.equal(again.items.find((item) => item.name === LINEAR).installedId, 'cn-1');
  const cacheFile = JSON.parse(await readFile(join(stateDir, 'connector-catalog-cache.json'), 'utf8'));
  assert.deepEqual(cacheFile.servers.map((item) => item.name), [SUPABASE, GITHUB, LINEAR, CONTEXT7]);
  // Stale after ten minutes: answered from memory, refreshed in the background.
  clock += 11 * 60_000;
  await registry.browse();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.length, firstCalls + 3, 'a stale first page refreshes in the background');
  // Empty pages are read past (up to three), then the scan stops.
  calls.length = 0;
  const skipped = await registry.browse({ cursor: 'c2' });
  assert.deepEqual(skipped.items.map((item) => item.name), [CLOUDFLARE]);
  assert.equal(skipped.nextCursor, 'c5');
  assert.deepEqual(calls.map((call) => new URLSearchParams(call.split('?')[1]).get('cursor')), ['c2', 'c3', 'c4']);
  calls.length = 0;
  const exhausted = await registry.browse({ cursor: 'e0' });
  assert.deepEqual(exhausted.items, []);
  assert.equal(calls.length, 4, 'the requested page plus at most three empty ones');
  assert.equal(exhausted.nextCursor, 'e4', 'the person can still ask for more');
  const repeated = await registry.browse({ cursor: 'r1' });
  assert.deepEqual([repeated.items.length, repeated.nextCursor], [1, null], 'a cursor that repeats ends the list');
  calls.length = 0;
  const looping = await registry.browse({ cursor: 'q0' });
  assert.deepEqual([looping.items.length, looping.nextCursor, calls.length], [0, null, 1], 'an empty page pointing at itself is not re-read');
  // Search and its cursor.
  calls.length = 0;
  const searched = await registry.browse({ search: '  linear  ' });
  assert.deepEqual(searched.items.map((item) => item.name), [LINEAR]);
  assert.equal(searched.nextCursor, 's2');
  assert.equal(new URLSearchParams(calls[0].split('?')[1]).get('search'), 'linear');
  const searched2 = await registry.browse({ search: 'linear', cursor: 's2' });
  assert.deepEqual([searched2.items.map((item) => item.name), searched2.nextCursor], [[CLOUDFLARE], null]);
  // 5xx and 429 retried with backoff; other 4xx not.
  calls.length = 0;
  let started = Date.now();
  await assert.rejects(registry.browse({ search: 'flaky' }), (error) => error.message === 'The MCP Registry answered 503.' && error.status === 502);
  assert.equal(calls.length, 3, 'three attempts on 503');
  assert.ok(Date.now() - started >= 1900, 'with backoff between them');
  calls.length = 0;
  assert.deepEqual((await registry.browse({ search: 'limited' })).items.map((item) => item.name), [LINEAR]);
  assert.equal(calls.length, 2, '429 then success');
  calls.length = 0;
  await assert.rejects(registry.browse({ search: 'gone' }), /answered 400/);
  assert.equal(calls.length, 1, '400 is not retried');
  calls.length = 0;
  await assert.rejects(registry.lookup('io.example/missing'), (error) => error.status === 404);
  assert.equal(calls.length, 1, '404 is not retried');
  await assert.rejects(registry.lookup('not a name'), (error) => error.status === 400);
  assert.equal((await registry.lookup(SUPABASE)).name, SUPABASE);
  // Offline: the saved first page, then the bundled snapshot.
  offline = true;
  calls.length = 0;
  started = Date.now();
  const restarted = createRegistry({ registryUrl: REGISTRY, stateDir, rootDir: root, fetchRequest, now: () => clock, featured });
  const fromCache = await restarted.browse();
  assert.equal(fromCache.source, 'cache');
  assert.match(fromCache.notice, /Can't reach the MCP Registry/);
  assert.deepEqual(fromCache.items.slice(0, 2).map((item) => item.name), [SUPABASE, GITHUB]);
  assert.equal(calls.length, 9, 'three tries each for two lookups and a page');
  assert.equal((await restarted.lookup(CONTEXT7)).name, CONTEXT7, 'lookup offline reads the saved page');
  assert.equal((await restarted.lookup('com.notion/mcp')).name, 'com.notion/mcp', 'and then the snapshot');
  await assert.rejects(restarted.lookup('io.example/nowhere'), /Can't reach the MCP Registry/);
  const bare = createRegistry({ registryUrl: REGISTRY, stateDir: join(directory, 'empty-state'), rootDir: root, fetchRequest, now: () => clock, featured });
  const fromSnapshot = await bare.browse();
  assert.equal(fromSnapshot.source, 'snapshot');
  assert.ok(fromSnapshot.items.length >= 10, 'the bundled snapshot lists the servers');
  assert.ok(fromSnapshot.items.some((item) => item.name === SUPABASE && item.featured));
  const nothing = createRegistry({ registryUrl: REGISTRY, stateDir: join(directory, 'nothing'), fetchRequest, now: () => clock });
  assert.deepEqual(await nothing.browse(), { items: [], nextCursor: null, source: 'snapshot', notice: 'Can\'t reach the MCP Registry. Check this computer\'s connection.' });
  // Offline search has nothing to fall back to: a plain error.
  await assert.rejects(restarted.browse({ search: 'linear' }), (error) => error.status === 503 && /Can't reach/.test(error.message));
  offline = false;
  covered.push('registry client');

  // ------------------------------------------------------------------ health
  const now = Date.parse('2026-11-17T10:00:00Z');
  const at = (minutes) => new Date(now - minutes * 60_000).toISOString();
  const ok = (extra = {}) => ({ ok: true, at: at(5), tools: ['a', 'b', 'c'], error: '', ...extra });
  const health = (connector, options = {}) => connectorHealth({ name: 'Linear', kind: 'url', ...connector }, { now, ...options });
  let state = health({ builtin: true, hasKey: false, name: 'Web research', kind: 'stdio' });
  assert.deepEqual([state.state, state.action.kind], ['needs-setup', 'add-key']); assert.match(state.message, /Firecrawl key/);
  state = health({ kind: 'google', name: 'Gmail', oauth: { status: 'signed-out' } });
  assert.deepEqual([state.state, state.action.kind], ['needs-setup', 'google-client']);
  assert.equal(health({ kind: 'google', name: 'Gmail', oauth: { status: 'signed-out' } }, { googleClientReady: true }).state, 'needs-sign-in');
  state = health({ oauth: { status: 'signed-out' } });
  assert.deepEqual([state.state, state.tone, state.action.label], ['needs-sign-in', 'muted', 'Sign in']);
  state = health({ oauth: { status: 'expired' } });
  assert.deepEqual([state.state, state.tone, state.action.label], ['needs-sign-in', 'error', 'Sign in again']); assert.match(state.message, /sign-in to Linear ended/);
  assert.match(health({ oauth: { status: 'signed-in' } }, { signingIn: true }).message, /Waiting for you/);
  assert.equal(health({ lastTest: { ok: false, at: at(1), tools: [], needsSignIn: true } }).state, 'needs-sign-in');
  state = health({ kind: 'stdio', command: 'npx', lastTest: { ok: false, at: at(1), tools: [], error: 'spawn npx ENOENT' } });
  assert.deepEqual([state.state, state.action.kind, state.action.runtime, state.action.label], ['failing', 'install-runtime', 'Node.js', 'How to install']);
  assert.match(state.message, /npx isn't installed/);
  const launcherWords = 'npx isn\'t installed on this computer. Install Node.js, then test the connector again in Settings › Connectors.';
  assert.equal(plainError(launcherWords, { command: 'npx' }).action, 'install-runtime', 'the launcher wording maps to install-runtime');
  state = health({ kind: 'stdio', command: 'npx', lastTest: ok({ at: at(30) }), runtime: { crashesLastHour: 0, lastError: launcherWords, lastErrorAt: at(1) } });
  assert.deepEqual([state.state, state.message], ['unstable', 'Last use failed: npx isn\'t installed on this computer. Install Node.js, then test again.']);
  assert.equal(plainError('Squad couldn\'t find /usr/local/bin/uvx on this computer.').runtime, 'uv');
  assert.equal(plainError('Squad couldn\'t find my-tool on this computer.').action, 'edit');
  state = health({ lastTest: { ok: false, at: at(1), tools: [], error: 'HTTP 401 Unauthorized' }, headers: [] });
  assert.deepEqual([state.action.kind, state.message], ['edit', 'Linear refused the key or token. Update it, then test again.']);
  state = health({ oauth: { status: 'signed-in' }, lastTest: { ok: false, at: at(1), tools: [], error: 'HTTP 401 Unauthorized' } });
  assert.deepEqual([state.action.kind, state.message], ['sign-in', 'Linear no longer accepts the sign-in. Sign in again.']);
  assert.equal(plainError('HTTP 503 Service Unavailable', { name: 'Linear' }).message, 'Linear is having trouble right now (HTTP 503). Try again shortly.');
  assert.equal(plainError('connect ECONNREFUSED 127.0.0.1:1').action, 'test');
  assert.equal(plainError('HTTP 404').action, 'edit');
  assert.equal(plainError('').message, 'The check failed.');
  state = health({ lastTest: ok(), runtime: { crashesLastHour: 3, lastError: 'Linear stopped unexpectedly (exit code 1).' } });
  assert.deepEqual([state.state, state.tone], ['unstable', 'error']); assert.match(state.message, /^Stopped 3 times in the last hour: /);
  assert.match(health({ lastTest: ok(), runtime: { crashesLastHour: 1, lastError: 'x' } }).message, /^Stopped once/);
  state = health({ lastTest: ok(), runtime: { crashesLastHour: 0, lastError: 'HTTP 401', lastErrorAt: at(1) }, oauth: { status: 'signed-in' } });
  assert.deepEqual([state.state, state.action.kind], ['unstable', 'sign-in']);
  assert.equal(health({ lastTest: ok({ at: at(1) }), runtime: { crashesLastHour: 0, lastError: 'old', lastErrorAt: at(10) } }).state, 'ready', 'an error older than the last good test is history');
  state = health({});
  assert.deepEqual([state.state, state.action.kind], ['untested', 'test']);
  state = health({ lastTest: ok({ at: at(90) }), oauth: { status: 'signed-in', account: 'ana@example.com' } });
  assert.deepEqual([state.state, state.tone, state.message, state.action], ['ready', 'ok', '3 tools · ana@example.com · checked 2 h ago', null]);
  assert.equal(health({ lastTest: ok({ tools: ['only'], at: at(0) }) }).message, '1 tool · checked just now');
  state = health({ lastTest: ok(), registry: { version: '0.17.0', latest: '0.18.0' } });
  assert.deepEqual([state.update, state.action], [{ latest: '0.18.0' }, { kind: 'update', label: 'Update to 0.18.0' }]);
  assert.equal(health({ lastTest: ok(), registry: { version: '0.17.0', latest: '0.17.0' } }).update, null);
  covered.push('health');

  console.log(`check-connector-catalog passed: ${covered.join(', ')} (${snapshot.servers.length} snapshot servers, offline cache and snapshot fallbacks).`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
