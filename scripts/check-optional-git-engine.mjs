// Real SDK + CLI startup, in an empty private work folder, without a model
// prompt. The CLI path can be overridden to compare engine releases.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { AutohandSDK } from '@autohandai/agent-sdk';
import { CLI_TARGETS } from '../server/runtime/cli-bootstrap.mjs';

const target = CLI_TARGETS[`${process.platform}/${process.arch}`];
assert.ok(target, 'a supported host CLI target is required');
const cliPath = resolve(process.env.AUTOHAND_TEST_CLI || join(process.env.AUTOHAND_SQUAD_CLI_DIR || 'vendor/autohand-cli', target.binary));
await access(cliPath);
const directory = await mkdtemp(join(tmpdir(), 'squad-no-git-engine-'));
const home = join(directory, 'home');
const workspace = join(home, 'Documents', 'autohand-desktop');
const agentHome = join(directory, 'agent');
const config = join(agentHome, 'config.json');
let sdk;
let modelRequests = 0;
const auth = createServer((request, response) => {
  if (request.url?.includes('chat/completions')) modelRequests++;
  response.writeHead(request.url === '/api/auth/me' ? 200 : 404, { 'content-type': 'application/json' });
  response.end(JSON.stringify(request.url === '/api/auth/me' ? { user: { id: 'fixture', email: 'fixture@example.test', name: 'Fixture' } } : { error: 'No provider in this startup check.' }));
});
await new Promise(resolve => auth.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${auth.address().port}`;
try {
  await mkdir(workspace, { recursive: true });
  await mkdir(agentHome);
  await writeFile(config, JSON.stringify({
    provider: 'openrouter', openrouter: { apiKey: 'fixture-only-no-provider', model: 'openai/gpt-4o-mini', baseUrl: 'http://127.0.0.1:1' },
    auth: { token: 'fixture-only-no-provider', expiresAt: '2099-01-01T00:00:00Z', user: { id: 'fixture', email: 'fixture@example.test' } },
    sync: { enabled: false }, agent: { autoMemory: false }, autoReport: { enabled: false },
    ui: { checkForUpdates: false, promptSuggestions: false }, mcp: { servers: [] }, hooks: { enabled: false },
  }));
  sdk = new AutohandSDK({ debug: process.env.AUTOHAND_TEST_DEBUG === "1", cliPath, cwd: workspace, extraArgs: ['--path', workspace, '--config', config], envVars: { HOME: home, USERPROFILE: home, AUTOHAND_HOME: agentHome, AUTOHAND_CONFIG: config, AUTOHAND_AUTH_URL: origin, AUTOHAND_AUTH_API_URL: origin + '/api/auth', AUTOHAND_API_URL: origin + '/v1', AUTOHAND_DISABLE_COMPUTER_USE: '1', AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN: '' }, timeout: 30000 });
  await sdk.start();
  await sdk.getState(); // A spawned process alone has not completed CLI initialization.
  await assert.rejects(access(join(workspace, '.git')), 'cold managed SDK startup must not initialize Git');
  await assert.rejects(access(join(workspace, '.gitignore')), 'startup must not create an ignore file');
  assert.equal(modelRequests, 0);
  console.log('PASS real SDK/CLI cold startup in an empty work folder: initialized successfully without .git or .gitignore; no model prompt sent.');
} finally {
  try { await sdk?.close(); }
  finally { auth.closeAllConnections(); await new Promise(resolve => auth.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}
