import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { createOwnedBridgeFixture } from './owned-bridge-fixture.mjs';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// GitHub's runners are several times slower than a developer machine for a
// bridge turn plus a browser render. Fixed bounds sized locally kept timing
// out there (model fallbacks, queued attachments, runtime bootstrap: CI on
// 2 November 2026 and the 0.1.15 release run), so on CI every wait is
// stretched; AUTOHAND_CHECK_WAIT_SCALE overrides the factor.
const WAIT_SCALE = Number(process.env.AUTOHAND_CHECK_WAIT_SCALE) > 0 ? Number(process.env.AUTOHAND_CHECK_WAIT_SCALE) : process.env.CI ? 3 : 1;
// AUTOHAND_CHECK_TRACE=1 prints each wait as it starts and ends, so a check
// that stalls shows the step it stalled on.
const TRACE = process.env.AUTOHAND_CHECK_TRACE === '1';
export async function until(fn, label, timeout = 10000) {
  const started = Date.now();
  const end = started + timeout * WAIT_SCALE;
  if (TRACE) console.error(`[wait] ${label}`);
  let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) { if (TRACE) console.error(`[done] ${label} ${Date.now() - started} ms`); return value; } } catch (error) { last = error; }
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

export async function startBridge({ signedIn = true, prepare, cwd = process.cwd(), development = true, liveIdentity = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'squad-reliability-'));
  let child, ownership, logs = '';
  const cleanup = async () => {
    try { await stop(child); } finally {
      try { await ownership?.close(); } finally { await rm(directory, { recursive: true, force: true }); }
    }
  };
  try {
    const port = await freePort();
    let hmrPort = await freePort();
    while (hmrPort === port) hmrPort = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const config = join(directory, 'config.json');
    await writeFile(config, JSON.stringify(signedIn ? { provider: 'autohandai', auth: { token: 'fixture-only-no-provider', email: 'reliability@example.test', expiresAt: '2099-01-01T00:00:00Z' } } : {}));
    const prepared = prepare ? await prepare(directory) : {};
    // Live release rehearsals verify the real account; ordinary checks retain
    // their isolated identity server and deliberately seeded fixture dataset.
    ownership = liveIdentity
      ? { paths: {}, env: { AUTOHAND_SQUAD_IDENTITY_ORIGIN: process.env.AUTOHAND_SQUAD_IDENTITY_ORIGIN || 'https://api.autohand.ai' }, close: async () => {} }
      : await createOwnedBridgeFixture({serviceRoot:join(directory,'squad'),appRoot:join(directory,'app')});
    // Bridges started for checks never post to the person's desktop (lane 72e49cb).
    const env = { AUTOHAND_SQUAD_NATIVE_NOTIFICATIONS: 'macos', ...process.env, ...prepared, ...ownership.env, AUTOHAND_HOME: join(directory, 'autohand'), AUTOHAND_SQUAD_HOME: join(directory, 'squad'), AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, 'app'), AUTOHAND_USER_CONFIG_PATH: config };
    const headers = async () => {
      const context=await fetch(origin+'/api/ownership/context').then(response=>response.json());
      return {'content-type':'application/json',...(context?.data?.generation?{'x-squad-context':context.data.generation}:{})};
    };
    // A bridge call stretches with the waits: a busy runner (or a dev bridge
    // compiling App.jsx on its main thread) can hold a ten-second reset call.
    const api = async (path, method = 'GET', body, timeout = 10000 * WAIT_SCALE) => {
      try {
        const context=path.startsWith('/api/ownership/context')?null:await fetch(origin+'/api/ownership/context',{signal:AbortSignal.timeout(timeout)}).then(response=>response.json());
        const response = await fetch(origin + path, { method, signal: AbortSignal.timeout(timeout), headers: { 'content-type': 'application/json',...(context?.data?.generation?{'x-squad-context':context.data.generation}:{}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: response.status, ...await response.json() };
      } catch (error) { throw new Error(`${method} ${path}: ${error.message}`, { cause: error }); }
    };
    const start = async () => {
      child = spawn(process.execPath, ['server.mjs', ...(development ? ['--dev'] : []), '--host', '127.0.0.1', '--port', String(port), '--hmr-port', String(hmrPort)], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
      await until(async () => {const context=await api('/api/ownership/context');return ['ready','unbound','signed_out','awaiting_restart'].includes(context.data?.state);},'isolated ownership verification',60000);
      if((await api('/api/ownership/context')).data.state==='ready')await until(async () => (await api('/api/runtime')).success, 'isolated bridge start', 60000);
    };
    await start();
    return { directory, origin, api, headers, get dataRoot(){return ownership.paths.dataRoot;},get appRoot(){return ownership.paths.appRoot;},get workspaceRoot(){return ownership.paths.workspaceRoot;}, get logs() { return logs; }, restart: async () => { await stop(child); await start(); }, close: cleanup };
  } catch (error) {
    await cleanup();
    throw new Error(`${error.message}\n${logs}`, { cause: error });
  }
}

// Full-navigation tests can opt out of frozen pages retaining SSE connections.
export async function startBrowser({ disableBackForwardCache = false } = {}) {
  const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  if (!chrome) throw new Error('Chrome is required for the rendered reliability checks. Set CHROME_PATH.');
  const directory = await mkdtemp(join(tmpdir(), 'squad-reliability-chrome-'));
  // These profiles are disposable; never depend on the person's macOS keychain.
  const child = spawn(chrome, ['--headless=new', ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), ...(disableBackForwardCache ? ['--disable-back-forward-cache'] : []), '--remote-debugging-port=0', `--user-data-dir=${directory}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-gpu', '--window-size=1440,1100', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stderr.on('data', data => { logs += data; });
  let ws, debugOrigin;
  try {
    const endpoint = await until(async () => {
      const [port] = (await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split('\n');
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      return targets.find(target => target.type === 'page')?.webSocketDebuggerUrl;
    }, 'Chrome start', 60000);
    debugOrigin = new URL(endpoint).origin.replace('ws:', 'http:');
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  } catch (error) { await stop(child); await rm(directory, { recursive: true, force: true }); throw new Error(`${error.message}\n${logs}`); }
  let id = 0;
  const pending = new Map();
  const errors = [];
  const requests = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Network.requestWillBeSent') requests.set(message.params.requestId, { url: message.params.request.url, status: 'pending' });
    if (message.method === 'Network.responseReceived' && requests.has(message.params.requestId)) Object.assign(requests.get(message.params.requestId), { status: message.params.response.status });
    if (message.method === 'Network.loadingFailed' && requests.has(message.params.requestId)) Object.assign(requests.get(message.params.requestId), { status: message.params.errorText });
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  });
  // A DevTools socket that closes (the headless page went away during a long
  // idle in the demo walkthrough) used to leave every later call waiting on
  // nothing; the pending calls fail at once and later ones fail without a wait.
  let socketClosed = '';
  ws.addEventListener('close', event => {
    socketClosed = `DevTools socket closed (${event.code || 'no code'})`;
    for (const [requestId, entry] of pending) { pending.delete(requestId); clearTimeout(entry.timer); entry.reject(new Error(socketClosed)); }
  });
  const send = (method, params = {}, timeout = 15000) => new Promise((resolve, reject) => {
    if (socketClosed) { reject(new Error(`${method}: ${socketClosed}`)); return; }
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
  // AUTOHAND_CHECK_CPU_THROTTLE=6 slows the page's CPU sixfold, to reproduce
  // on a developer machine what only failed on GitHub's slower runners.
  const throttle = Number(process.env.AUTOHAND_CHECK_CPU_THROTTLE);
  if (throttle > 1) await send('Emulation.setCPUThrottlingRate', { rate: throttle });
  return { send, evaluate, errors, requests, debugOrigin,
    // A navigation on a loaded machine (another suite at full CPU) took more
    // than the fifteen-second default; the page itself was fine.
    navigate: url => send('Page.navigate', { url }, 60000),
    click: text => evaluate(`(() => { const element = [...document.querySelectorAll('button')].find(item => (item.innerText.trim() === ${JSON.stringify(text)} || item.getAttribute('aria-label') === ${JSON.stringify(text)}) && item.getBoundingClientRect().width); if (!element) throw new Error('Missing button: ' + ${JSON.stringify(text)}); element.click(); })()`),
    fill: (selector, value) => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (!input) throw new Error('Missing input'); const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`),
    screenshot: async path => { await until(() => evaluate(`!document.getElementById('boot')`), 'startup overlay removed'); await mkdir(join(path, '..'), { recursive: true }); const result = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path, Buffer.from(result.data, 'base64')); },
    close: async () => { for (const entry of pending.values()) clearTimeout(entry.timer); ws.close(); await stop(child); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
  };
}
