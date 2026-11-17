#!/usr/bin/env node
// ADR-0248: the sign-in apps a release build provides reach the bridge.
// Staging writes CONNECTOR_CLIENTS.json from the build environment; the
// bridge reads it, the environment wins per provider, a missing file means
// "not set up", and neither the staging output, the page nor the bridge's
// logs carry the values.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONNECTOR_CLIENTS_FILE, connectorClientsFrom, describeConnectorBuildClients, deviceAppEnv, readConnectorBuildClients } from '../server/connectors/build-clients.mjs';
import { deviceAppsFromEnv } from '../server/connectors/oauth.mjs';
import { stageConnectorClients } from './stage-connector-clients.mjs';

// Fixture values in the providers' shapes; none of them is a real client.
const STAGED = {
  AUTOHAND_SQUAD_GOOGLE_CLIENT_ID: '123456789012-fixturestagedclient0000000000.apps.googleusercontent.com',
  AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET: 'GOCSPX-fixtureStagedSecret000000',
  AUTOHAND_SQUAD_GITHUB_CLIENT_ID: 'Ov23liFixtureStaged0',
};
const OVERRIDE = {
  AUTOHAND_SQUAD_GOOGLE_CLIENT_ID: '210987654321-fixtureenvclient00000000000000.apps.googleusercontent.com',
  AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET: 'GOCSPX-fixtureEnvSecret000000000',
};
const EMPTY = { AUTOHAND_SQUAD_GOOGLE_CLIENT_ID: '', AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET: '', AUTOHAND_SQUAD_GITHUB_CLIENT_ID: '' };
const root = await mkdtemp(join(tmpdir(), 'squad-connector-clients-'));
const step = (label) => console.log(`- ${label}`);

try {
  step('staging writes only the three values and never prints them');
  const output = [];
  const runtime = join(root, 'runtime');
  await mkdir(runtime);
  assert.deepEqual(await stageConnectorClients({ runtimeDir: runtime, env: STAGED, log: (line) => output.push(line) }), { google: true, github: true });
  const staged = JSON.parse(await readFile(join(runtime, CONNECTOR_CLIENTS_FILE), 'utf8'));
  assert.deepEqual(staged, { google: { clientId: STAGED.AUTOHAND_SQUAD_GOOGLE_CLIENT_ID, clientSecret: STAGED.AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET }, github: { clientId: STAGED.AUTOHAND_SQUAD_GITHUB_CLIENT_ID } });
  for (const value of Object.values(STAGED)) assert.ok(!output.join('\n').includes(value), 'staging output names providers, never values');

  step('a build without values stages an empty file');
  const bare = join(root, 'bare');
  await mkdir(bare);
  assert.deepEqual(await stageConnectorClients({ runtimeDir: bare, env: {}, log: () => {} }), { google: false, github: false });
  assert.deepEqual(JSON.parse(await readFile(join(bare, CONNECTOR_CLIENTS_FILE), 'utf8')), {});

  step('a malformed value fails staging without echoing it');
  const bad = 'not-a-google-client-id-but-looks-secret';
  await assert.rejects(stageConnectorClients({ runtimeDir: bare, env: { AUTOHAND_SQUAD_GOOGLE_CLIENT_ID: bad }, log: () => {} }), (error) => !error.message.includes(bad) && /AUTOHAND_SQUAD_GOOGLE_CLIENT_ID/.test(error.message));
  await assert.rejects(stageConnectorClients({ runtimeDir: bare, env: { AUTOHAND_SQUAD_GITHUB_CLIENT_ID: 'x y' }, log: () => {} }), /AUTOHAND_SQUAD_GITHUB_CLIENT_ID/);
  assert.throws(() => connectorClientsFrom({ AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET: 'GOCSPX-orphanSecret0000000000' }), /CLIENT_ID/, 'a secret without its id is a mistake');

  step('a local .env counts, the process environment wins');
  const envFile = join(root, '.env');
  await writeFile(envFile, `AUTOHAND_SQUAD_GITHUB_CLIENT_ID="${STAGED.AUTOHAND_SQUAD_GITHUB_CLIENT_ID}"\nAUTOHAND_SQUAD_GOOGLE_CLIENT_ID=${OVERRIDE.AUTOHAND_SQUAD_GOOGLE_CLIENT_ID}\n`);
  const local = join(root, 'local');
  await mkdir(local);
  await stageConnectorClients({ runtimeDir: local, env: { AUTOHAND_SQUAD_GOOGLE_CLIENT_ID: STAGED.AUTOHAND_SQUAD_GOOGLE_CLIENT_ID }, envFile, log: () => {} });
  assert.deepEqual(JSON.parse(await readFile(join(local, CONNECTOR_CLIENTS_FILE), 'utf8')), { google: { clientId: STAGED.AUTOHAND_SQUAD_GOOGLE_CLIENT_ID }, github: { clientId: STAGED.AUTOHAND_SQUAD_GITHUB_CLIENT_ID } });

  step('the bridge reader: staged, overridden per provider, missing, unreadable');
  const fromBuild = readConnectorBuildClients(runtime, EMPTY);
  assert.deepEqual(fromBuild.google, { clientId: STAGED.AUTOHAND_SQUAD_GOOGLE_CLIENT_ID, clientSecret: STAGED.AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET });
  assert.deepEqual(fromBuild.source, { google: 'build', github: 'build' });
  assert.deepEqual(deviceAppsFromEnv(deviceAppEnv(fromBuild)).map((app) => [app.id, app.clientId]), [['github', STAGED.AUTOHAND_SQUAD_GITHUB_CLIENT_ID]], 'the staged GitHub app reaches the device flow');
  const overridden = readConnectorBuildClients(runtime, { ...EMPTY, ...OVERRIDE });
  assert.deepEqual(overridden.google, { clientId: OVERRIDE.AUTOHAND_SQUAD_GOOGLE_CLIENT_ID, clientSecret: OVERRIDE.AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET }, 'env wins');
  assert.deepEqual(overridden.github, { clientId: STAGED.AUTOHAND_SQUAD_GITHUB_CLIENT_ID }, 'per provider');
  const idOnly = readConnectorBuildClients(runtime, { ...EMPTY, AUTOHAND_SQUAD_GOOGLE_CLIENT_ID: OVERRIDE.AUTOHAND_SQUAD_GOOGLE_CLIENT_ID });
  assert.equal(idOnly.google.clientSecret, '', 'an env client id never borrows the staged secret');
  const missing = readConnectorBuildClients(join(root, 'nowhere'), EMPTY);
  assert.deepEqual(missing, { google: null, github: null, source: { google: null, github: null } });
  assert.equal(describeConnectorBuildClients(missing), 'Google not set up; GitHub not set up');
  await writeFile(join(bare, CONNECTOR_CLIENTS_FILE), '{"google":{"clientId":"tampered"}');
  assert.deepEqual(readConnectorBuildClients(bare, EMPTY).google, null, 'an unreadable file is "not set up"');
  for (const value of Object.values(STAGED)) assert.ok(!describeConnectorBuildClients(fromBuild).includes(value));

  if (process.env.AUTOHAND_SKIP_BRIDGE === '1') console.log('Bridge boot skipped (AUTOHAND_SKIP_BRIDGE=1).');
  else await bridgeChecks();
  console.log('Connector build clients check passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}

// The real bridge, started from a runtime directory that holds a staged file
// the way an installed app's runtime does (server.mjs reads process.cwd()).
async function bridgeChecks() {
  const { startBridge } = await import('./lib/reliability-browser.mjs');
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const runtimeRoot = join(root, 'bridge-runtime');
  await mkdir(runtimeRoot);
  for (const entry of await readdir(repo)) {
    if (entry === CONNECTOR_CLIENTS_FILE || entry === '.git') continue;
    await symlink(join(repo, entry), join(runtimeRoot, entry));
  }
  await stageConnectorClients({ runtimeDir: runtimeRoot, env: STAGED, log: () => {} });
  const scan = async (directory) => {
    let text = '';
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) text += await scan(path);
      else if (entry.isFile() && /\.(log|jsonl|json|txt)$/.test(entry.name)) text += await readFile(path, 'utf8').catch(() => '');
    }
    return text;
  };
  for (const [label, env, expected] of [
    ['staged clients reach the bridge', EMPTY, { clientId: STAGED.AUTOHAND_SQUAD_GOOGLE_CLIENT_ID, provided: 'build' }],
    ['the environment wins over the staged file', { ...EMPTY, ...OVERRIDE }, { clientId: OVERRIDE.AUTOHAND_SQUAD_GOOGLE_CLIENT_ID, provided: 'build' }],
  ]) {
    step(`bridge: ${label}`);
    const bridge = await startBridge({ cwd: runtimeRoot, development: false, prepare: async () => env });
    try {
      const listing = await bridge.api('/api/connectors');
      assert.deepEqual((listing.data ?? listing).googleClient, expected);
      const page = JSON.stringify(listing);
      for (const secret of [STAGED.AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET, OVERRIDE.AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET]) assert.ok(!page.includes(secret), 'the page never receives a client secret');
      const logs = `${bridge.logs}\n${await scan(bridge.directory)}`;
      assert.match(logs, /Connector sign-in apps: Google set up \((build|env)\); GitHub set up \(build\)/, 'the bridge says which providers are set up');
      for (const value of [...Object.values(STAGED), ...Object.values(OVERRIDE)]) assert.ok(!logs.includes(value), 'no client value lands in the bridge logs');
    } finally { await bridge.close(); }
  }
  step('bridge: no staged file and no environment is "not set up"');
  await rm(join(runtimeRoot, CONNECTOR_CLIENTS_FILE));
  const bridge = await startBridge({ cwd: runtimeRoot, development: false, prepare: async () => EMPTY });
  try {
    const listing = await bridge.api('/api/connectors');
    assert.equal((listing.data ?? listing).googleClient, null);
    assert.match(`${bridge.logs}\n${await scan(bridge.directory)}`, /Google not set up; GitHub not set up/);
  } finally { await bridge.close(); }
}
