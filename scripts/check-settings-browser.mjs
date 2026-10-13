#!/usr/bin/env node
// Settings as its own shell, in a real browser (ADR-0119). Opens /settings
// against a throwaway bridge serving dist/, then proves what the stacked page
// could not: the app sidebar is gone, exactly one section is on the page,
// clicking a row swaps that section and pushes /settings/<id>, browser Back
// moves between sections, the old ?section= and #settings-<id> links land on
// their section, Escape returns to where Settings was opened from, and the
// list collapses to a row below the md breakpoint.
//
// SETTINGS_SHOTS_DIR=<dir> also saves screenshots there (used for the ADR).
// No engine runs. Needs Chrome; without one it warns and exits 0
// (AUTOHAND_REQUIRE_BROWSER=1 makes that a failure).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initialAgents, initialChannels } from "../src/data.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean).find(existsSync);
if (!chromePath) {
  if (process.env.AUTOHAND_REQUIRE_BROWSER) { console.error("check:settings:browser: no Chrome or Chromium found and AUTOHAND_REQUIRE_BROWSER is set"); process.exit(1); }
  console.warn("check:settings:browser: no Chrome or Chromium found; skipped (set CHROME_PATH to run it)");
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
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method) {
        if (message.method === "Runtime.exceptionThrown") this.errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "exception");
        return;
      }
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

const member = {
  id: "asq_verify_alex", name: "Alex", role: "GTM lead", status: "online", staffId: "verify-alex", workspace: root,
  avatar: "/avatars/birds/kiwi.webp", description: "Browser fixture member.",
  projects: [{ id: "verify-project", name: "autohandSWE", label: "autohandSWE", path: root, kind: "project" }],
  memory: [], skills: [], permissions: {}, stats: {}, modelAssignment: { mode: "inherit" },
  harness: { id: "claude", executablePath: "", model: "", effort: "", access: "" },
};
const fixtures = { agents: [member], removedAgents: initialAgents.map((agent) => agent.id), seedChannelIds: initialChannels.map((channel) => channel.id), now: new Date().toISOString() };
function installFixtures(data) {
  const store = (key, value) => localStorage.setItem(`autohandSquad.v1.${key}`, JSON.stringify(value));
  if (!localStorage.getItem("settingsVerify.initialized")) {
    localStorage.clear();
    store("agents", data.agents);
    store("removedAgents", data.removedAgents);
    store("tasks", []); store("memoryInbox", []); store("channels", []); store("channelMessages", {}); store("channelThreads", {});
    store("channelReads", Object.fromEntries(data.seedChannelIds.map((id) => [id, data.now])));
    store("agentReads", {}); store("messages", {}); store("automations", []);
    store("onboarding", { version: 1, status: "skipped", lastStep: "skipped" });
    localStorage.setItem("autohandSquad.v1.sidebarCollapsed", "false");
    localStorage.setItem("settingsVerify.initialized", "true");
  }
}

const directory = await mkdtemp(join(tmpdir(), "squad-settings-browser-"));
// The sign-in gate stays shut while the bridge reports an account; it reads
// <squadStateDir>/config.json for that. No network is touched.
await mkdir(join(directory, "squad"), { recursive: true });
await writeFile(join(directory, "squad", "config.json"), JSON.stringify({ apiAuthToken: "fixture-only-no-network", accountEmail: "fixture@example.com" }));
const shots = process.env.SETTINGS_SHOTS_DIR ? resolve(process.env.SETTINGS_SHOTS_DIR) : "";
if (shots) await mkdir(shots, { recursive: true });
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
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${installFixtures.toString()})(${JSON.stringify(fixtures)});` });
  const viewport = (width, height = 960) => cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await viewport(1440);

  const state = () => cdp.evaluate(`({
    path: location.pathname + location.search,
    sidebar: !!document.querySelector('.app-sidebar'),
    menuButton: !!document.querySelector('button[aria-label="Open account menu"]'),
    back: !!document.querySelector('button[aria-label="Back from Settings"]'),
    sections: [...document.querySelectorAll('section[id^="settings-"]')].map((el) => el.id),
    headings: [...document.querySelectorAll('section[id^="settings-"] h3')].map((el) => el.textContent.trim()),
    current: document.querySelector('[data-testid="settings-sections"] [aria-current="page"] span')?.textContent.trim() || '',
    rows: [...document.querySelectorAll('[data-testid="settings-sections"] a')].map((el) => el.dataset.section),
    listIsRow: (() => { const nav = document.querySelector('[data-testid="settings-sections"]'); const [a, b] = nav ? nav.querySelectorAll('a') : []; return !!(a && b && Math.abs(a.getBoundingClientRect().top - b.getBoundingClientRect().top) < 2); })(),
  })`);
  const settled = (section) => waitFor(async () => { const s = await state(); return s.back && s.sections.length === 1 && s.sections[0] === `settings-${section}` ? s : null; }, `Settings on ${section}`);
  const clickRow = (id) => cdp.evaluate(`(() => { const row = document.querySelector('[data-testid="settings-sections"] a[data-section="${id}"]'); if (!row) return false; row.click(); return true; })()`);
  // A fresh document sometimes sits on the boot screen for well over ten
  // seconds before the bundle runs (seen on main too, in every browser check
  // that loads several documents in one tab), so a load that has not mounted
  // after eight seconds is asked for again rather than failed.
  const mounted = () => cdp.evaluate("!document.getElementById('boot') && !!document.querySelector('#root *')");
  const load = async (path) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await cdp.send("Page.navigate", { url: origin + path }).catch(() => {});
      try { await waitFor(mounted, `${path} to mount`, 8000); return; }
      catch (error) { if (attempt === 3) throw error; console.warn(`check:settings:browser: ${path} did not mount within 8 s (attempt ${attempt}); loading it again`); }
    }
  };
  const shot = async (name) => {
    if (!shots) return;
    await delay(300);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(shots, `${name}.png`), Buffer.from(data, "base64"));
  };

  // 1. Open Settings from a member chat, the way the account menu does.
  const chatRoute = `/conversations/new?member=${member.id}`;
  await load(chatRoute);
  await waitFor(async () => (await state()).menuButton, "the member chat", 30000);
  await cdp.evaluate(`window.dispatchEvent(new CustomEvent('autohand-squad:menu',{detail:{action:'settings'}}))`);
  let s = await settled("appearance");
  assert.equal(s.path, "/settings", "plain /settings opens the default section");
  assert.equal(s.sidebar, false, "the app sidebar is gone on Settings");
  assert.equal(s.menuButton, false, "no account gear on Settings; Back is the way out");
  assert.deepEqual(s.headings, ["Appearance"], "exactly one section heading is on the page");
  assert.equal(s.current, "Appearance", "the list marks the open section");
  assert.equal(s.rows.length, 17, "every section is in the list");
  assert.equal(s.listIsRow, false, "wide: the list is a column");
  await shot("settings-appearance-1440");

  // 2. Two rows: each swaps the section and pushes its path.
  assert.ok(await clickRow("connectors"));
  s = await settled("connectors");
  assert.equal(s.path, "/settings/connectors");
  assert.deepEqual(s.headings, ["Connectors"]);
  assert.equal(s.current, "Connectors");
  await shot("settings-connectors-1440");
  assert.ok(await clickRow("vault"));
  s = await settled("vault");
  assert.equal(s.path, "/settings/vault");
  assert.deepEqual(s.headings, ["Vault"]);

  // 3. Browser Back and Forward move between sections.
  await cdp.evaluate("history.back()");
  s = await settled("connectors");
  assert.equal(s.path, "/settings/connectors", "browser Back returns to the previous section");
  await cdp.evaluate("history.forward()");
  s = await settled("vault");

  // 4. Keyboard: Down from the open row focuses the next, Enter opens it; Escape goes Back.
  await cdp.evaluate(`document.querySelector('[data-testid="settings-sections"] a[aria-current="page"]').focus()`);
  const key = async (k, code, vk) => { await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk }); await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); };
  await key("ArrowDown", "ArrowDown", 40);
  assert.equal(await cdp.evaluate("document.activeElement?.dataset.section"), "improvement", "Down moves focus to the next row without opening it");
  assert.equal((await state()).sections[0], "settings-vault");
  await key("Enter", "Enter", 13);
  s = await settled("improvement");
  assert.equal(s.path, "/settings/improvement", "Enter opens the focused row");
  await key("Escape", "Escape", 27);
  await waitFor(async () => (await state()).path === chatRoute, "Escape returns to the member chat");
  assert.equal((await state()).sidebar, true, "the sidebar is back outside Settings");

  // 5. The links other screens already use land on their section: one as a
  // fresh document, the rest as history entries the app's popstate handler
  // resolves (a fourth fresh document in one tab stalls on the boot screen
  // for about forty seconds; see the note on load above and ADR-0119).
  await load("/settings/vault");
  s = await settled("vault");
  assert.deepEqual(s.sections, ["settings-vault"], "/settings/vault opens Vault as a fresh document");
  for (const [url, section] of [["/settings?section=updates", "updates"], ["/settings#settings-voice", "voice"], ["/settings/nope", "appearance"], ["/settings/connectors", "connectors"]]) {
    await cdp.evaluate(`history.pushState(null, "", ${JSON.stringify(url)}); dispatchEvent(new PopStateEvent("popstate"))`);
    s = await settled(section);
    assert.deepEqual(s.sections, [`settings-${section}`], `${url} opens ${section}`);
  }
  await cdp.evaluate(`document.querySelector('button[aria-label="Back from Settings"]').click()`);
  await waitFor(async () => (await state()).path === "/squad", "a direct link's Back goes to Squad");

  // 6. Narrow: the list is one row, the section still swaps.
  await viewport(900);
  await load("/settings/appearance");
  s = await settled("appearance");
  assert.equal(s.listIsRow, false, "900px keeps two columns");
  await shot("settings-appearance-900");
  assert.ok(await clickRow("connectors"));
  s = await settled("connectors");
  await shot("settings-connectors-900");
  await viewport(640);
  s = await waitFor(async () => { const now = await state(); return now.listIsRow ? now : null; }, "the list to become a row at 640px");
  assert.equal(s.sidebar, false);
  await shot("settings-connectors-640");
  assert.ok(await clickRow("voice"));
  s = await settled("voice");
  assert.equal(s.listIsRow, true);
  await shot("settings-voice-640");

  const boundary = (await cdp.evaluate("document.body.innerText || ''")).match(/could not render[^\n]{0,200}/i);
  assert.ok(!boundary, `error boundary: ${boundary?.[0]}`);
  assert.deepEqual(cdp.errors, [], "no script errors");
  console.log(`Settings browser check passed: no sidebar, one section at a time, rows push /settings/<id>, Back/Forward and Escape behave, old links land, list is a row at 640px${shots ? `; screenshots in ${shots}` : ""}.`);
} catch (error) {
  console.error(`bridge log tail: ${logs.slice(-1500)}`);
  if (cdp) { try { console.error(`page state: ${JSON.stringify(await cdp.evaluate(`({ path: location.pathname + location.search, text: (document.body.innerText || '').slice(0, 600) })`))}`); } catch {} }
  if (cdp && shots) { try { const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }); await writeFile(join(shots, "failure.png"), Buffer.from(data, "base64")); } catch {} }
  throw error;
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
