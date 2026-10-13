#!/usr/bin/env node
// Real pinned CLI + real Squad stdio proxy; engine and provider are mocked.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AutohandSDK } from '@autohandai/agent-sdk';
import { createComputerUse } from '../server/computer-use.mjs';

const rootDir = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'squad-computer-cli-check-'));
let sdk; let service;
const calls = [];
let authCalls = 0;
let startupOutput = '';
const nativeClient = { async request(method, params) {
  calls.push({ method, params });
  if (method === 'tools/list') return { tools: [{ name: 'get_window_state', description: 'Mock screenshot verification', inputSchema: { type: 'object', properties: { pid: { type: 'integer' }, window_id: { type: 'integer' } }, required: ['pid', 'window_id'] } }] };
  throw new Error('This integration check must not execute native actions.');
}, close() {} };
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/v1/auth/me') {
      authCalls += 1;
      assert.equal(req.headers.authorization, 'Bearer mock-only');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ user: { id: 'fixture', email: 'fixture@example.invalid', name: 'Fixture', plan: 'free' } }));
      return;
    }
    assert.equal(req.url, '/api/computer-use/mcp');
    let body = ''; for await (const chunk of req) body += chunk;
    const data = await service.dispatch(req.headers['x-squad-computer-token'], JSON.parse(body));
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: true, data }));
  } catch (failure) { res.writeHead(403, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: false, error: failure.message })); }
});
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  service = createComputerUse({ rootDir, stateDir: temporary, bridgeUrl: `http://127.0.0.1:${server.address().port}`, nativeClient });
  const session = await service.createSession({ memberId: 'fixture', runId: 'no-action-check' });
  const configPath = join(temporary, 'config.json');
  await writeFile(configPath, JSON.stringify({ auth: { token: 'mock-only', expiresAt: new Date(Date.now() + 3600000).toISOString() }, telemetry: { enabled: false }, provider: 'openrouter', openrouter: { apiKey: 'test-only-not-a-real-key', model: 'mock-no-provider-calls', baseUrl: 'http://127.0.0.1:1' }, mcp: { enabled: true, servers: [session.mcpServer] } }), { mode: 0o600 });
  const names = { 'darwin/arm64': 'autohand-macos-arm64', 'darwin/x64': 'autohand-macos-x64', 'linux/arm64': 'autohand-linux-arm64', 'linux/x64': 'autohand-linux-x64', 'win32/x64': 'autohand-windows-x64.exe' };
  sdk = new AutohandSDK({ cwd: temporary, cliPath: join(rootDir, 'vendor', 'autohand-cli', names[`${process.platform}/${process.arch}`]), envVars: { AUTOHAND_HOME: temporary, AUTOHAND_CONFIG: configPath, AUTOHAND_AUTH_API_URL: `http://127.0.0.1:${server.address().port}/v1/auth`, AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN: '', AUTOHAND_NO_IDLE_LOGOUT: '1', AUTOHAND_CLIENT_NAME: 'squad-computer-check' }, timeout: 20000 });
  await sdk.start();
  sdk.client.transport.process?.stdout?.on('data', (chunk) => { startupOutput = `${startupOutput}${chunk}`.slice(-4000); });
  const configs = await sdk.getMcpServerConfigs();
  assert.ok(configs.configs.some((entry) => entry.name === 'autohand-computer-use'));
  let tools = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    tools = (await sdk.listMcpTools()).tools;
    if (tools.some((tool) => tool.name.includes('get_window_state'))) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(tools.some((tool) => tool.name.includes('get_window_state')), 'Pinned CLI did not discover the Squad Computer Use tool.');
  assert.ok(calls.length > 0 && calls.every((call) => call.method === 'tools/list'));
  assert.ok(authCalls > 0, 'The supported auth base override did not reach the local mock.');
  console.log('Pinned Autohand CLI 0.9.7 discovered the actual Squad Computer Use proxy through isolated member config; no provider prompts or native actions.');
} catch (failure) {
  // This check uses only its isolated fake provider config, never user state.
  const diagnostic = sdk?.client?.transport?.getStderrTail?.();
  if (diagnostic) process.stderr.write(`${diagnostic}\n`);
  if (startupOutput) process.stderr.write(`${startupOutput.replace(/[a-f0-9]{64}/g, '[redacted]').replaceAll('test-only-not-a-real-key', '[fake-key]')}\n`);
  throw failure;
} finally {
  await sdk?.close(); service?.close(); await new Promise((resolve) => server.close(resolve)); await rm(temporary, { recursive: true, force: true });
}
