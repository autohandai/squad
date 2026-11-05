// Exercise the real stop path with two isolated bridges and an unrelated
// member-looking process. Never use the installed CLI: it may predate this fix.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { startBridge, stop, until } from './lib/reliability-browser.mjs';

const cli = resolve(process.env.SQUAD_TEST_CLI || join('daemon', 'target', 'debug', process.platform === 'win32' ? 'squad.exe' : 'squad'));
await access(cli);
assert.ok((await stat(cli)).mtimeMs >= (await stat('daemon/src/cli.rs')).mtimeMs,
  'Build the current source CLI before running isolation checks; older binaries contain an unsafe global cleanup.');
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
let a, b, member;
try {
  a = await startBridge({ development: false });
  b = await startBridge({ development: false });
  const original = (await a.api('/api/health')).pid;
  const target = await b.api('/api/health');
  const daemonPort = await freePort();
  const state = join(b.directory, 'squad');
  await mkdir(state, { recursive: true });
  await writeFile(join(state, 'config.json'), JSON.stringify({ host: '127.0.0.1', port: daemonPort, openUrl: b.origin, telemetryPolicy: 'disabled' }));
  await writeFile(join(state, 'web-server.json'), JSON.stringify({ pid: target.pid, host: '127.0.0.1', port: new URL(b.origin).port * 1, url: b.origin, serverPath: join(process.cwd(), 'server.mjs'), dev: false, startedAt: target.startedAt }));
  const lookalike = join(a.directory, 'node_modules', '@autohandai', 'cli', 'fixture.cjs');
  await mkdir(join(lookalike, '..'), { recursive: true });
  await writeFile(lookalike, 'setInterval(() => {}, 1000);');
  member = spawn(process.execPath, [lookalike, '--config', join(a.directory, '.autohand', 'agents', 'example', 'config.json')], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { member.once('spawn', resolve); member.once('error', reject); });
  const child = spawn(cli, ['stop'], { cwd: process.cwd(), env: { ...process.env, AUTOHAND_SQUAD_HOME: state, AUTOHAND_HOME: join(b.directory, 'autohand'), AUTOHAND_SQUAD_APP_STATE_DIR: join(b.directory, 'app'), AUTOHAND_USER_CONFIG_PATH: join(b.directory, 'config.json'), AUTOHAND_SQUAD_WEB_SERVER: join(process.cwd(), 'server.mjs'), AUTOHAND_SQUAD_NODE: process.execPath }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  assert.equal(code, 0, output);
  await until(async () => { try { await b.api('/api/health', 'GET', undefined, 500); return false; } catch { return true; } }, 'selected bridge stopped');
  assert.equal((await a.api('/api/health')).pid, original, 'stopping B must preserve sibling bridge A');
  assert.equal(member.exitCode, null, 'unrelated member-like processes must remain alive');
  assert.equal(member.signalCode, null);
  console.log('PASS real CLI stop: selected bridge stopped; sibling bridge and unrelated member process stayed alive. Isolated fixtures only.');
} finally {
  await stop(member);
  await b?.close();
  await a?.close();
}
