import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { stageRuntimeSources } from './lib/stage-runtime-sources.mjs';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(process.argv[2], 'Pass the compiled squad executable to check');
const executable = resolve(process.argv[2]);
const runtime = resolve(process.argv[3] || repository);
const root = await mkdtemp(join(tmpdir(), 'squad-installed-mcp-'));
const required = ['list_members', 'message_member', 'get_conversation', 'wait_for_message'];
let child;
let timer;
let lines;
let closed;
let isClosed = false;
try {
  // These paths intentionally live outside the source checkout and any of its
  // ancestors. Otherwise the development fallback can hide a broken package.
  const bin = process.platform === 'darwin' ? join(root, 'Squad.app', 'Contents', 'MacOS')
    : process.platform === 'win32' ? join(root, 'installed') : join(root, 'usr', 'bin');
  const resources = process.platform === 'darwin' ? join(bin, '..', 'Resources', 'runtime')
    : process.platform === 'win32' ? join(bin, 'runtime') : join(bin, '..', 'lib', 'autohand-squad-ui');
  const home = join(root, 'home'), cwd = join(root, 'launch');
  for (const path of [bin, resources, home, cwd]) await mkdir(path, { recursive: true });
  const cli = join(bin, process.platform === 'win32' ? 'squad.exe' : 'squad');
  await copyFile(executable, cli);
  // Runner Node may use sibling shared libraries. Relocating only its binary
  // creates a broken interpreter unrelated to the Squad resource lookup.
  const bundledNode = join(dirname(executable), process.platform === 'win32' ? 'node.exe' : 'node');
  const nodeRuntime = (await stat(bundledNode).catch(() => null))?.isFile() ? bundledNode : process.execPath;
  await copyFile(join(runtime, 'server.mjs'), join(resources, 'server.mjs'));
  await cp(join(runtime, 'server', 'control-plane'), join(resources, 'server', 'control-plane'), { recursive: true });
  // Releases stage shared JS beside server modules. Omitting this tree made
  // the neutral-directory fixture fail on the first MCP shared-helper import.
  await stageRuntimeSources(join(runtime, 'src', 'lib'), join(resources, 'src', 'lib'), 'lib');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('AUTOHAND_') || ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH'].includes(key)) delete env[key];
  Object.assign(env, { HOME: home, USERPROFILE: home, AUTOHAND_HOME: join(home, '.autohand'), AUTOHAND_SQUAD_HOME: join(home, '.autohand', 'squad'), AUTOHAND_SQUAD_NODE: nodeRuntime });
  child = spawn(cli, ['mcp', '--bridge', 'http://127.0.0.1:19821'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  closed = new Promise(resolveClosed => child.once('close', () => { isClosed = true; resolveClosed(); }));
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4000); });
  lines = createInterface({ input: child.stdout });
  const result = new Promise((resolveResult, reject) => {
    timer = setTimeout(() => reject(new Error(`Installed MCP handshake timed out: ${stderr}`)), 10000);
    child.once('error', reject);
    child.stdin.on('error', reject);
    child.once('exit', code => reject(new Error(`Installed MCP exited (${code}): ${stderr}`)));
    lines.on('line', line => {
      try {
        const response = JSON.parse(line);
        if (response.error) throw new Error(JSON.stringify(response.error));
        if (response.id === 1) {
          assert.ok(response.result?.protocolVersion, 'MCP must initialize');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
        } else if (response.id === 2) {
          const names = response.result?.tools?.map(tool => tool.name) || [];
          for (const name of required) assert.ok(names.includes(name), `Installed MCP must expose ${name}`);
          resolveResult(names.length);
        }
      } catch (error) { reject(error); }
    });
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'installed-package-check', version: '1.0.0' } } }) + '\n');
  const count = await result;
  console.log(`PASS installed MCP initializes from a neutral directory with a fresh home; ${count} tools include Desktop direct messaging. No member messages sent.`);
} finally {
  clearTimeout(timer);
  lines?.close();
  if (child?.pid && !isClosed) {
    // On Windows the Rust CLI waits for its Node child. EOF lets both exit;
    // killing only the wrapper would orphan Node and lock the fixture files.
    child.stdin.end();
    await waitForClose(2000);
    if (!isClosed) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 });
      else child.kill('SIGKILL');
      await waitForClose(3000);
      assert.ok(isClosed, 'MCP fixture process must stop before cleanup');
    }
  }
  await rm(root, { recursive: true, force: true });
}

async function waitForClose(ms) {
  let timeout;
  try { await Promise.race([closed, new Promise(resolveTimeout => { timeout = setTimeout(resolveTimeout, ms); })]); }
  finally { clearTimeout(timeout); }
}
