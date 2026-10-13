import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(fn, label, timeout = 10000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await delay(50);
  }
  throw new Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
}

async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

export async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(2000)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
}

export async function startBridge({ signedIn = true, prepare } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'squad-reliability-'));
  const port = await freePort();
  let hmrPort = await freePort();
  while (hmrPort === port) hmrPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const config = join(directory, 'config.json');
  await writeFile(config, JSON.stringify(signedIn ? { provider: 'autohandai', auth: { token: 'fixture-only-no-provider', email: 'reliability@example.test', expiresAt: '2099-01-01T00:00:00Z' } } : {}));
  const prepared = prepare ? await prepare(directory) : {};
  const env = { ...process.env, ...prepared, AUTOHAND_HOME: join(directory, 'autohand'), AUTOHAND_SQUAD_HOME: join(directory, 'squad'), AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, 'app'), AUTOHAND_USER_CONFIG_PATH: config };
  let child;
  let logs = '';
  const api = async (path, method = 'GET', body) => {
    const response = await fetch(origin + path, { method, signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, ...await response.json() };
  };
  const start = async () => {
    child = spawn(process.execPath, ['server.mjs', '--dev', '--host', '127.0.0.1', '--port', String(port), '--hmr-port', String(hmrPort)], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
    await until(async () => (await api('/api/runtime')).success, 'isolated bridge start', 60000);
  };
  try { await start(); } catch (error) { await stop(child); await rm(directory, { recursive: true, force: true }); throw new Error(`${error.message}\n${logs}`); }
  return { directory, origin, api, get logs() { return logs; }, restart: async () => { await stop(child); await start(); }, close: async () => { await stop(child); await rm(directory, { recursive: true, force: true }); } };
}

export async function startBrowser() {
  const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  if (!chrome) throw new Error('Chrome is required for the rendered reliability checks. Set CHROME_PATH.');
  const directory = await mkdtemp(join(tmpdir(), 'squad-reliability-chrome-'));
  const child = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${directory}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-gpu', '--window-size=1440,1100', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stderr.on('data', data => { logs += data; });
  let ws;
  try {
    const endpoint = await until(async () => {
      const [port] = (await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split('\n');
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      return targets.find(target => target.type === 'page')?.webSocketDebuggerUrl;
    }, 'Chrome start', 60000);
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  } catch (error) { await stop(child); await rm(directory, { recursive: true, force: true }); throw new Error(`${error.message}\n${logs}`); }
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  });
  const send = (method, params = {}, timeout = 15000) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, timeout);
    pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  try { await send('Page.enable', {}, 60000); await send('Runtime.enable', {}, 60000); }
  catch (error) { ws.close(); await stop(child); await rm(directory, { recursive: true, force: true }); throw error; }
  return { send, evaluate, errors,
    navigate: url => send('Page.navigate', { url }),
    click: text => evaluate(`(() => { const element = [...document.querySelectorAll('button')].find(item => (item.innerText.trim() === ${JSON.stringify(text)} || item.getAttribute('aria-label') === ${JSON.stringify(text)}) && item.getBoundingClientRect().width); if (!element) throw new Error('Missing button: ' + ${JSON.stringify(text)}); element.click(); })()`),
    fill: (selector, value) => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (!input) throw new Error('Missing input'); const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`),
    screenshot: async path => { await until(() => evaluate(`!document.getElementById('boot')`), 'startup overlay removed'); await mkdir(join(path, '..'), { recursive: true }); const result = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path, Buffer.from(result.data, 'base64')); },
    close: async () => { for (const entry of pending.values()) clearTimeout(entry.timer); ws.close(); await stop(child); await rm(directory, { recursive: true, force: true }); },
  };
}
