#!/usr/bin/env node
// The built app must render (ADR-0113, "what was learnt").
//
// `bun run ci` passed 79 steps on 2026-10-13 while the installed app showed
// "Autohand Squad could not render — Cannot access uninitialized variable":
// a state hook in src/App.jsx was read before its declaration, which no check
// executed because nothing ran the bundle in a browser. This serves `dist/`
// through a throwaway bridge, opens it in headless Chrome over the DevTools
// protocol (like the other browser checks), and fails on the error boundary,
// on any uncaught exception, or when nothing is mounted under #root.
//
// `--dump-dom` is not used: the running app polls the bridge, virtual time
// never settles, and Chrome prints nothing, which looks exactly like success.
//
// Needs Google Chrome or Chromium. Without one it prints a warning and exits
// 0 so the chain can run on a machine with no browser; set
// AUTOHAND_REQUIRE_BROWSER=1 to make that a failure.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean).find(existsSync);
if (!chromePath) {
  if (process.env.AUTOHAND_REQUIRE_BROWSER) { console.error("check:render: no Chrome or Chromium found and AUTOHAND_REQUIRE_BROWSER is set"); process.exit(1); }
  console.warn("check:render: no Chrome or Chromium found; the render check was skipped (set CHROME_PATH to run it)");
  process.exit(0);
}
assert.ok(existsSync(join(root, "dist", "index.html")), "dist/index.html must exist (run bun run build first)");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 20000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try { last = await fn(); if (last) return last; } catch (error) { last = error.message; }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}; last probe: ${JSON.stringify(last)}`);
}
async function freePort() {
  const socket = createServer();
  await new Promise((r) => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  return port;
}
class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method) { this.events.push(message); return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
}

const directory = await mkdtemp(join(tmpdir(), "squad-render-"));
const port = await freePort();
const chromePort = await freePort();
const origin = `http://127.0.0.1:${port}`;
let logs = "";
const bridge = spawn(process.execPath, ["server.mjs", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  env: { ...process.env, AUTOHAND_SQUAD_HOME: join(directory, "squad"), AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, "app"), AUTOHAND_HOME: join(directory, "autohand"), AUTOHAND_USER_CONFIG_PATH: join(directory, "config.json") },
  stdio: ["ignore", "pipe", "pipe"],
});
bridge.stdout.on("data", (d) => { logs += d; }); bridge.stderr.on("data", (d) => { logs += d; });
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(directory, "chrome")}`, `--remote-debugging-port=${chromePort}`, "about:blank"], { stdio: "ignore" });
let cdp = null;
try {
  await waitFor(async () => (await fetch(`${origin}/api/runs`).catch(() => null))?.ok, "bridge", 30000);
  const target = await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json`).then((r) => r.json()).catch(() => []))?.find((item) => item.type === "page"), "Chrome DevTools", 30000);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: `${origin}/` });
  // The app is up once #root holds elements and the boot text is gone, or
  // once the error boundary has rendered; either way the verdict is ready.
  const probe = `(() => { const root = document.getElementById("root"); const text = document.body.innerText || ""; return { mounted: Boolean(root && root.children.length), boundary: /could not render/i.test(text) ? text.slice(0, 300) : "", booting: /Waking the squad/i.test(text), length: text.length }; })()`;
  const state = await waitFor(async () => { const s = await cdp.evaluate(probe); return (s.mounted && !s.booting) || s.boundary ? s : null; }, "the app to mount", 30000);
  await delay(1500); // let the first effects (bridge polls, member hydration) run and throw if they will
  const final = await cdp.evaluate(probe);
  const thrown = cdp.events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text || "exception");
  const consoleErrors = cdp.events.filter((e) => e.method === "Runtime.consoleAPICalled" && e.params.type === "error").map((e) => e.params.args.map((a) => a.value ?? a.description ?? "").join(" ")).filter((text) => /ReferenceError|TypeError|SyntaxError|could not render/.test(text));
  const problems = [];
  if (final.boundary) problems.push(`error boundary: ${final.boundary.replace(/\s+/g, " ")}`);
  for (const line of [...thrown, ...consoleErrors].slice(0, 6)) problems.push(`script error: ${String(line).split("\n")[0].slice(0, 300)}`);
  if (!final.mounted) problems.push("nothing mounted under #root");
  if (problems.length) {
    console.error("check:render: the app did not render");
    for (const line of problems) console.error(`  ${line}`);
    console.error("  Tip: `npx vite build --minify false --outDir /tmp/dist-plain` keeps the real identifier in the message.");
    process.exit(1);
  }
  console.log(`Render check passed: dist/ mounts in headless Chrome with no error boundary and no script errors (${state.length} characters of text, ${cdp.events.length} DevTools events).`);
} finally {
  try { cdp?.ws.close(); } catch {}
  chrome.kill("SIGTERM");
  bridge.kill("SIGTERM");
  await Promise.race([new Promise((r) => bridge.once("exit", r)), delay(4000)]);
  if (bridge.exitCode === null) bridge.kill("SIGKILL");
  await Promise.race([new Promise((r) => chrome.once("exit", r)), delay(3000)]);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(directory, { recursive: true, force: true }).catch(() => {});
}
