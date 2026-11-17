#!/usr/bin/env node
// The connector store (ADR-0244): a connectors.json from before sealing is
// sealed on first read and keeps working; sealed values are bound to their
// connector; a missing key is reported instead of silently losing secrets;
// renames keep the id; a catalogue reinstall keeps the id and on/off state;
// removal hands back what must be revoked. No keychain, no network.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createConnectorStore } from '../server/connectors/store.mjs';
import { VaultLockedError } from '../server/vault/keychain.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const directory = await mkdtemp(join(tmpdir(), 'squad-connector-store-'));
const key = randomBytes(32);
const keyring = { load: async () => ({ key, source: 'test' }), source: () => 'test', sources: ['test'], forget() {} };
const lockedKeyring = { load: async ({ hasItems }) => { if (hasItems) throw new VaultLockedError('the OS keychain'); return { key: randomBytes(32), source: 'test' }; }, source: () => null, sources: ['test'], forget() {} };
const SECRETS = { firecrawl: 'fc-legacy-key-7777', env: 'legacy-env-token-8888', header: 'Bearer legacy-header-9999' };

try {
  const file = join(directory, 'connectors.json');
  await writeFile(file, JSON.stringify({ version: 1, connectors: [
    { id: 'web-research', builtin: true, name: 'Web research', kind: 'stdio', enabled: true, firecrawlApiKey: SECRETS.firecrawl, framing: 'newline' },
    { id: 'cn-aaaa1111', name: 'Legacy command', kind: 'stdio', enabled: true, command: 'node', args: ['server.js'], env: { API_TOKEN: SECRETS.env, PLAIN: 'visible' }, framing: 'header' },
    { id: 'cn-bbbb2222', name: 'Legacy address', kind: 'url', enabled: false, url: 'https://mcp.example.com/mcp', transport: 'http', headers: { Authorization: SECRETS.header, 'X-Team': 'one' } },
  ] }), { mode: 0o600 });

  const store = createConnectorStore({ stateDir: directory, rootDir: root, keyring });
  const listed = await store.list();
  const text = await readFile(file, 'utf8');
  for (const [label, secret] of Object.entries(SECRETS)) assert.ok(!text.includes(secret), `the legacy ${label} secret is sealed on first read`);
  assert.equal(JSON.parse(text).version, 2);
  assert.equal(listed.find((item) => item.id === 'web-research').keyHint, '…7777');
  const command = listed.find((item) => item.id === 'cn-aaaa1111');
  assert.deepEqual(command.env, [{ key: 'PLAIN', value: 'visible', secret: false, configured: true, hint: '' }, { key: 'API_TOKEN', value: '', secret: true, configured: true, hint: '…8888' }]);
  assert.equal(listed.find((item) => item.id === 'cn-bbbb2222').headers.find((pair) => pair.name === 'Authorization').hint, '…9999');
  const spec = await store.spec('cn-aaaa1111');
  assert.equal(spec.env.API_TOKEN, SECRETS.env); assert.equal(spec.env.PLAIN, 'visible'); assert.equal(spec.framing, 'header');
  assert.equal((await store.spec('web-research')).env.FIRECRAWL_API_KEY, SECRETS.firecrawl);
  assert.equal((await store.spec('cn-bbbb2222')).headers.Authorization, SECRETS.header);

  // A sealed blob pasted onto another connector does not open (the id is bound in).
  const stored = JSON.parse(await readFile(file, 'utf8'));
  const commandRecord = stored.connectors.find((item) => item.id === 'cn-aaaa1111');
  stored.connectors.find((item) => item.id === 'cn-bbbb2222').sealed = commandRecord.sealed;
  await writeFile(file, JSON.stringify(stored));
  const tampered = createConnectorStore({ stateDir: directory, rootDir: root, keyring });
  await assert.rejects(tampered.spec('cn-bbbb2222'), /could not be opened/);
  await assert.doesNotReject(tampered.spec('cn-aaaa1111'));

  // A missing key with sealed items is a plain 503, and listing still works.
  const locked = createConnectorStore({ stateDir: directory, rootDir: root, keyring: lockedKeyring });
  assert.equal((await locked.list()).length, 3, 'the list shows without the key');
  await assert.rejects(locked.spec('cn-aaaa1111'), (error) => error.status === 503 && /key is missing/.test(error.message));

  // Fresh store for the remaining cases.
  await rm(file);
  const fresh = createConnectorStore({ stateDir: directory, rootDir: root, keyring });
  const a = await fresh.create({ name: 'Alpha', kind: 'stdio', command: 'node', args: ['a.js'], env: [{ key: 'MODE', value: 'fast' }, { key: 'SECRET_THING', value: 'not-obvious-1234', secret: true }, { key: 'LOOKS_LIKE_TOKEN', value: 'plain-but-named-token', secret: false }] });
  assert.deepEqual(a.env.map((pair) => [pair.key, pair.secret]), [['MODE', false], ['LOOKS_LIKE_TOKEN', false], ['SECRET_THING', true]], 'an explicit secret flag wins over the name heuristic');
  const reread = await createConnectorStore({ stateDir: directory, rootDir: root, keyring }).get(a.id);
  assert.deepEqual(reread.env.map((pair) => [pair.key, pair.secret]), [['MODE', false], ['LOOKS_LIKE_TOKEN', false], ['SECRET_THING', true]], 'a plain value stays plain after a reload (no second migration)');
  const empty = await fresh.create({ name: 'Empty header', kind: 'url', url: 'https://x.example/mcp', headers: [{ key: 'Authorization', value: '' }] });
  assert.deepEqual((await createConnectorStore({ stateDir: directory, rootDir: root, keyring }).get(empty.id)).headers, [{ name: 'Authorization', value: '', secret: true, configured: false, hint: '' }], 'an empty key-like header is listed, unconfigured');
  await assert.rejects(fresh.create({ name: ' alpha ', kind: 'stdio', command: 'node' }), (error) => error.status === 409, 'names are unique, ignoring case and spaces');
  const renamed = await fresh.rename(a.id, 'Alpha tools');
  assert.equal(renamed.id, a.id); assert.equal(renamed.serverName, a.serverName, 'a rename keeps the member-facing server name');
  await assert.rejects(fresh.update(a.id, { name: 'Bad\nname' }), /line breaks/);
  await assert.rejects(fresh.create({ name: 'H', kind: 'url', url: 'https://x.example/mcp', headers: [{ key: 'X-Evil', value: 'a\r\nInjected: 1' }] }), /line breaks/);

  // A secret argument placeholder is filled at launch and dropped when its placeholder goes.
  const installed = await fresh.install({ name: 'Registry pkg', kind: 'stdio', command: 'npx', args: ['-y', 'pkg@1.0.0', '--token', '{{secret:token}}'], env: [], argSecrets: { token: 'arg-secret-5555' }, registry: { name: 'io.example/pkg', version: '1.0.0', option: 'package:0' } });
  assert.ok(!(await readFile(file, 'utf8')).includes('arg-secret-5555'));
  assert.deepEqual((await fresh.spec(installed.connector.id)).args, ['-y', 'pkg@1.0.0', '--token', 'arg-secret-5555']);
  await fresh.setEnabled(installed.connector.id, true);
  const again = await fresh.install({ name: 'Registry pkg', kind: 'stdio', command: 'npx', args: ['-y', 'pkg@1.0.0', '--token', '{{secret:token}}'], env: [], argSecrets: { token: 'arg-secret-6666' }, registry: { name: 'io.example/pkg', version: '1.0.0', option: 'package:0' } });
  assert.equal(again.reinstalled, true); assert.equal(again.connector.id, installed.connector.id); assert.equal(again.connector.enabled, true, 'a reinstall keeps the id and the on/off state');
  assert.equal((await fresh.spec(installed.connector.id)).args[3], 'arg-secret-6666');
  await fresh.update(installed.connector.id, { args: ['-y', 'pkg@1.0.0'] });
  assert.equal((await fresh.secrets(installed.connector.id)).args, undefined, 'an argument secret goes with its placeholder');

  // A new address signs the connector out; removal returns the sign-in to revoke.
  const remote = await fresh.create({ name: 'Remote', kind: 'url', url: 'https://one.example/mcp' });
  await fresh.setOAuth(remote.id, {}, (oauth, tokens) => { Object.assign(oauth, { mode: 'dcr', status: 'signed-in', revocationEndpoint: 'https://one.example/revoke', clientId: 'c1' }); tokens.accessToken = 'at-1'; tokens.refreshToken = 'rt-1'; });
  const before = await fresh.raw(remote.id);
  await fresh.update(remote.id, { url: 'https://two.example/mcp' });
  const after = await fresh.get(remote.id);
  assert.equal(after.oauth.status, 'signed-out'); assert.notEqual((await fresh.raw(remote.id)).authRevision || '', before.authRevision || '');
  assert.equal((await fresh.secrets(remote.id)).oauth, undefined, 'old tokens are dropped with the old address');
  assert.equal((await fresh.raw(remote.id)).oauth.revocationEndpoint, undefined, 'the old server\'s sign-in details go too');
  await fresh.setOAuth(remote.id, {}, (oauth, tokens) => { Object.assign(oauth, { status: 'signed-in', revocationEndpoint: 'https://one.example/revoke' }); tokens.accessToken = 'at-2'; tokens.refreshToken = 'rt-2'; });
  const removed = await fresh.remove(remote.id);
  assert.equal(removed.tokens.refreshToken, 'rt-2'); assert.equal(removed.oauth.revocationEndpoint, 'https://one.example/revoke');
  assert.ok(!(await fresh.list()).some((item) => item.id === remote.id));
  assert.ok(!(await readFile(file, 'utf8')).includes(remote.id), 'nothing of a removed connector stays in the file');

  // The Google client: id plain, secret sealed, kept when sent back blank.
  await assert.rejects(fresh.setGoogleClient({ clientId: 'not-a-google-id', clientSecret: 'x' }), /apps\.googleusercontent\.com/);
  await fresh.setGoogleClient({ clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret-4321' });
  assert.ok(!(await readFile(file, 'utf8')).includes('GOCSPX-secret-4321'));
  await fresh.setGoogleClient({ clientId: '123-abc.apps.googleusercontent.com', clientSecret: '' });
  assert.equal((await fresh.googleClient()).clientSecret, 'GOCSPX-secret-4321');
  assert.deepEqual(await fresh.googleClientPublic(), { clientId: '123-abc.apps.googleusercontent.com', secretHint: '…4321', savedAt: (await fresh.googleClientPublic()).savedAt });

  console.log('check-connector-store passed: legacy secrets sealed on first read with hints kept, id-bound sealing, locked key reported, explicit secret flags, unique names, rename keeps server name, argument secrets, in-place reinstall, address change signs out, removal returns tokens to revoke, Google client sealed.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
