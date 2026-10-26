#!/usr/bin/env node
// Fresh installed-runtime reproduction: no system CLI, no bundled CLI and
// isolated account/state. Exercises the actual bridge, never the user's home.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile, stat, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startBrowser, stop, until } from './lib/reliability-browser.mjs';
import { CLI_TARGETS } from '../server/runtime/cli-bootstrap.mjs';

const root = process.cwd();
const directory = await realpath(await mkdtemp(join(tmpdir(), 'squad-first-run-runtime-')));
const runtimeRoot = join(directory, 'runtime');
const workspace = join(directory, 'project');
let bridge, browser, logs = '';
try {
  await mkdir(runtimeRoot);
  await mkdir(workspace);
  execFileSync(process.platform === 'darwin' ? '/usr/bin/git' : 'git', ['init', '-q', workspace]);
  for (const name of ['server.mjs', 'package.json', 'server', 'relay', 'dist']) await cp(join(root, name), join(runtimeRoot, name), { recursive: true });
  await cp(join(root, 'src/lib'), join(runtimeRoot, 'src/lib'), { recursive: true });
  for (const name of ['toml', 'yaml']) await cp(join(root, 'node_modules', name), join(runtimeRoot, 'node_modules', name), { recursive: true, dereference: true });
  const sdk = join(root, 'node_modules/@autohandai/agent-sdk');
  await cp(join(sdk, 'dist'), join(runtimeRoot, 'node_modules/@autohandai/agent-sdk/dist'), { recursive: true });
  await cp(join(sdk, 'package.json'), join(runtimeRoot, 'node_modules/@autohandai/agent-sdk/package.json'));
  const target = CLI_TARGETS[`${process.platform}/${process.arch}`];
  const fixtureCli = join(directory, 'archive-content', target.inner);
  await mkdir(join(directory, 'archive-content'));
  await writeFile(fixtureCli, '#!/bin/sh\nprintf "0.9.7\\n"\n', { mode: 0o700 });
  const archive = join(directory, 'fixture.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', join(directory, 'archive-content'), target.inner]);
  const bytes = await readFile(archive);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const bad = join(directory, 'bad-checksum');
  const attempts = join(directory, 'downloads.log');
  await writeFile(bad, 'bad');
  const preload = join(directory, 'fixture-fetch.mjs');
  await writeFile(preload, `import {readFileSync,existsSync,appendFileSync} from 'node:fs';
const original=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  const path=String(url);
  if(!path.startsWith('https://github.com/autohandai/code-cli/releases/download/v0.9.7/'))return original(url,options);
  if(path.endsWith('.sha256'))return new Response((existsSync(${JSON.stringify(bad)})?'0'.repeat(64):${JSON.stringify(digest)})+'  archive\\n');
  appendFileSync(${JSON.stringify(attempts)},'download\\n');
  const bytes=readFileSync(${JSON.stringify(archive)});
  return new Response(bytes,{headers:{'content-length':String(bytes.length)}});
};`);
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  await writeFile(join(directory, 'config.json'), JSON.stringify({ provider: 'autohandai', auth: { token: 'fixture-only-no-provider', email: 'fresh@example.test', expiresAt: '2099-01-01T00:00:00Z' } }));
  const bridgeOptions = {
    cwd: runtimeRoot,
    env: { ...process.env, HOME: directory, NODE_OPTIONS: `--import=${preload}`, PATH: '/usr/bin:/bin', AUTOHAND_SQUAD_AUTOHAND_BIN: '', AUTOHAND_AGENT_SDK_DIR: '', AUTOHAND_AGENT_SDK_ENTRY: '', AUTOHAND_SQUAD_CLI_DIR: join(directory, 'empty-vendor'), AUTOHAND_HOME: join(directory, 'autohand'), AUTOHAND_USER_CONFIG_PATH: join(directory, 'config.json'), AUTOHAND_SQUAD_HOME: join(directory, 'squad'), AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, 'app') },
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  async function launch() {
    bridge = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(port)], bridgeOptions);
    bridge.stdout.on('data', data => { logs += data; }); bridge.stderr.on('data', data => { logs += data; });
    await until(async () => (await fetch(origin+'/api/health').catch(() => null))?.ok, 'fresh bridge', 30000);
  }
  await launch();
  const health = await (await fetch(origin+'/api/health', { signal: AbortSignal.timeout(800) })).json();
  assert.equal(health.success, true);
  assert.equal(health.service, 'autohand-squad-bridge');
  assert.equal(health.pid, bridge.pid);
  assert.equal(health.stateDir, join(directory, 'squad'));
  assert.equal(typeof health.startedAt, 'string');
  assert.equal('autohandPath' in health, false, 'health must not run CLI/configuration discovery');
  const before = (await (await fetch(origin+'/api/runtime')).json()).data;
  assert.equal(before.available, false, 'the fixture must have no CLI from the machine or app');
  if (process.argv.includes('--browser')) {
    browser = await startBrowser();
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `if(!localStorage.getItem('bootstrap.seeded')){localStorage.clear();localStorage.setItem('autohandSquad.v1.onboarding',JSON.stringify({version:1,status:'active',selectedWorkspace:${JSON.stringify(workspace)},selectedRepositories:[${JSON.stringify(workspace)}]}));localStorage.setItem('bootstrap.seeded','true');}` });
    await browser.navigate(origin+'/welcome');
  } else {
    const response = await fetch(origin+'/api/setup/runtime', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.ok(response.ok, `A first-time installation must be able to prepare its CLI; POST /api/setup/runtime returned ${response.status}: ${await response.text()}`);
  }
  const snapshot = async () => (await (await fetch(origin+'/api/runtime')).json()).data;
  const failed = await until(async () => { const data = await snapshot(); return data.bootstrap.phase === 'error' && data; }, 'checksum refusal');
  assert.equal(failed.available, false);
  assert.match(failed.bootstrap.error, /verification failed/);
  const installed = join(directory, 'app/runtime/autohand-cli/0.9.7', `${process.platform}-${process.arch}`, target.binary);
  assert.equal(await stat(installed).then(() => true).catch(() => false), false, 'an unverified executable is never exposed');
  const downloads = async () => (await readFile(attempts, 'utf8')).trim().split('\n').length;
  assert.equal(await downloads(), 1);

  if (browser) {
    await until(() => browser.evaluate(`document.body.innerText.includes('verification failed')`), 'actionable download failure in onboarding', 30000);
    assert.deepEqual(await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.onboarding')).selectedRepositories`), [workspace]);
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('button')].find(button=>button.innerText.includes('Start with Chief of Staff'))?.disabled`), true);
    await rm(bad);
    await browser.click('Retry');
    await until(() => browser.evaluate(`[...document.querySelectorAll('button')].find(button=>button.innerText.includes('Start with Chief of Staff'))?.disabled === false`), 'onboarding recovers after verified CLI installation', 30000);
    assert.deepEqual(await browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.onboarding')).selectedRepositories`), [workspace], 'retry preserves repository choices');
    await browser.screenshot(join(root, '.codex-artifacts/runtime-bootstrap/onboarding-ready.png'));
    assert.deepEqual(browser.errors, []);
  } else {
    await rm(bad);
    await Promise.all(Array.from({ length: 5 }, () => fetch(origin+'/api/setup/runtime', { method: 'POST' })));
  }
  const ready = await until(async () => { const data = await snapshot(); return data.available && data; }, 'verified managed CLI');
  assert.equal(ready.autohandPath, installed);
  assert.equal(ready.autohandSource, 'managed');
  assert.equal(ready.version, '0.9.7');
  assert.equal(await downloads(), 2, 'concurrent setup calls share one download');
  await fetch(origin+'/api/setup/runtime', { method: 'POST' });
  assert.equal(await downloads(), 2, 'a ready runtime is idempotent');
  await stop(bridge);
  await launch();
  assert.equal((await snapshot()).autohandSource, 'managed', 'a restarted bridge finds the installed CLI without downloading');
  assert.equal(await downloads(), 2);
  await chmod(installed, 0o600);
  assert.equal((await snapshot()).available, false, 'a present but non-executable CLI is not ready');
  await fetch(origin+'/api/setup/runtime', { method: 'POST' });
  await until(async () => (await snapshot()).available, 'repairing a non-executable CLI');
  assert.equal(await downloads(), 3);
  const vendor = join(directory, 'empty-vendor');
  await mkdir(vendor);
  await cp(fixtureCli, join(vendor, target.binary));
  await chmod(join(vendor, target.binary), 0o700);
  assert.equal((await snapshot()).autohandSource, 'vendored', 'a healthy app works without a global CLI');
  await fetch(origin+'/api/setup/runtime', { method: 'POST' });
  assert.equal(await downloads(), 3, 'a bundled CLI needs no network download');
  console.log('Fresh-runtime checks passed: no global CLI, verified recovery, checksum refusal, concurrency, idempotency, restart persistence, executable readiness and bundled offline startup'+(browser?', plus automatic onboarding setup, rendered retry and preserved choices':'')+'.');
} catch (error) {
  if (browser) {
    await browser.screenshot(join(root, '.codex-artifacts/runtime-bootstrap/failure.png')).catch(() => {});
    console.error(await browser.evaluate('document.body.innerText').catch(() => 'No page text'));
  }
  console.error(logs.slice(-2000)); throw error;
}
finally { await browser?.close(); await stop(bridge); await rm(directory, { recursive: true, force: true }); }
