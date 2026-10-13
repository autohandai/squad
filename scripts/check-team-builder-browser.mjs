#!/usr/bin/env node
// New team and Templates in a real browser (ADR-0118): a throwaway bridge
// serving dist/, headless Chrome over the DevTools protocol, a seeded
// member, then: open New team from the Squad page, type an objective, expect
// the proposal (members, a lead, a channel, paused routines), and save a
// screenshot; open Templates from the overflow, expect the built-in rows,
// save a screenshot; load one, expect the detail, save a screenshot; press
// Add team, expect the dialog to close at once and the directory to show
// the first member as "Preparing…" (the non-blocking path), save a
// screenshot. Screenshots land under .codex-artifacts/lanes/team-builder/.
//
// Needs Chrome; without one it warns and exits 0 (AUTOHAND_REQUIRE_BROWSER=1
// makes that a failure).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initialAgents, initialChannels } from "../src/data.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const artifacts = join(root, ".codex-artifacts", "lanes", "team-builder");
const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean).find(existsSync);
if (!chromePath) {
  if (process.env.AUTOHAND_REQUIRE_BROWSER) { console.error("check:team-builder:browser: no Chrome or Chromium found and AUTOHAND_REQUIRE_BROWSER is set"); process.exit(1); }
  console.warn("check:team-builder:browser: no Chrome or Chromium found; skipped (set CHROME_PATH to run it)");
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
  async screenshot(path) {
    const result = await this.send("Page.captureScreenshot", { format: "png" });
    await writeFile(path, Buffer.from(result.data, "base64"));
  }
}

const now = new Date().toISOString();
const member = {
  id: "asq_verify_eva", name: "Eva", role: "QA Engineer", status: "online", staffId: "verify-eva", workspace: root,
  avatar: "/avatars/birds/kiwi.webp", description: "Browser fixture member.", employeeType: "common-qa-engineer",
  projects: [{ id: "verify-project", name: "autohandSWE", label: "autohandSWE", path: root, kind: "project" }],
  memory: [], skills: [], permissions: {}, stats: {}, modelAssignment: { mode: "inherit" },
  harness: { id: "autohand", executablePath: "", model: "", effort: "", access: "" },
};
const fixtures = {
  agents: [member],
  removedAgents: initialAgents.map((agent) => agent.id),
  seedChannelIds: initialChannels.map((channel) => channel.id),
  now,
};
function installFixtures(data) {
  const store = (key, value) => localStorage.setItem(`autohandSquad.v1.${key}`, JSON.stringify(value));
  if (!localStorage.getItem("teamBuilderVerify.initialized")) {
    localStorage.clear();
    store("agents", data.agents);
    store("removedAgents", data.removedAgents);
    store("tasks", []);
    store("memoryInbox", []);
    store("channels", []);
    store("channelMessages", {});
    store("channelThreads", {});
    store("channelReads", Object.fromEntries(data.seedChannelIds.map((id) => [id, data.now])));
    store("agentReads", {});
    store("messages", {});
    store("automations", []);
    store("onboarding", { version: 1, status: "skipped", lastStep: "skipped" });
    localStorage.setItem("autohandSquad.v1.sidebarCollapsed", "false");
    localStorage.setItem("teamBuilderVerify.initialized", "true");
  }
}

const directory = await mkdtemp(join(tmpdir(), "squad-team-builder-browser-"));
await mkdir(join(directory, "squad"), { recursive: true });
await writeFile(join(directory, "squad", "config.json"), JSON.stringify({ apiAuthToken: "fixture-only-no-network", accountEmail: "fixture@example.com" }));
await mkdir(artifacts, { recursive: true });
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
const saved = [];
try {
  await waitFor(async () => (await fetch(`${origin}/api/runs`).catch(() => null))?.ok, "bridge", 30000);
  const target = await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json`).then((r) => r.json()).catch(() => []))?.find((item) => item.type === "page"), "Chrome DevTools", 30000);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${installFixtures.toString()})(${JSON.stringify(fixtures)});` });
  await cdp.send("Page.navigate", { url: `${origin}/squad` });
  const text = () => cdp.evaluate("document.body.innerText || ''");
  const clickTestId = (id) => cdp.evaluate(`(() => { const el = document.querySelector('[data-testid="${id}"]'); if (!el) return false; el.click(); return true; })()`);
  const clickButton = (pattern) => cdp.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((el) => ${pattern}.test((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')) && el.getBoundingClientRect().width); if (!button) return false; button.click(); return true; })()`);
  const typeInto = (selector, value) => cdp.evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (!input) return false; const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const save = async (name) => { const path = join(artifacts, name); await cdp.screenshot(path); saved.push(path); };

  await waitFor(async () => (await text()).includes("New member") && (await text()).includes("Eva"), "the Squad directory", 30000);
  assert.ok(!/could not render/i.test(await text()), "no error boundary");

  // 1. New team from an objective.
  assert.ok(await clickTestId("new-team"), "the New team button sits beside New member");
  await waitFor(async () => cdp.evaluate(`Boolean(document.querySelector('[data-testid="new-team-objective"]'))`), "the New team dialog");
  assert.ok(await typeInto('[data-testid="new-team-objective"]', "Marketing team for our NZ launch"));
  await waitFor(async () => { const t = await text(); return t.includes("Marketing Lead") && t.includes("#marketing-team") && t.includes("arrives paused"); }, "the proposal");
  const proposal = await text();
  assert.ok(/Content Operations Specialist/.test(proposal), "a role template member is proposed");
  assert.ok(/leads/.test(proposal), "a lead is named");
  await delay(300);
  await save("new-team-dialog.png");
  await cdp.evaluate("document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitFor(async () => !(await text()).includes("Primary objective"), "the dialog to close");

  // 2. Templates from the overflow.
  assert.ok(await clickButton("/Team actions/"), "the overflow menu beside New member");
  await waitFor(async () => (await text()).includes("Templates…"), "the menu");
  assert.ok(await clickButton("/^\\s*Templates…\\s*$/"), "the Templates item");
  await waitFor(async () => { const t = await text(); return t.includes("Built-in templates") && t.includes("Engineering team") && t.includes("Inbox follow-up"); }, "the Templates dialog");
  const list = await text();
  for (const name of ["Marketing campaign team", "SEO growth team", "Lead research team", "Competitor watch"]) assert.ok(list.includes(name), `${name} is listed`);
  assert.ok(/4 members · 2 routines · needs GitHub, Sentry/.test(list), "the Engineering row carries its meta line");
  await delay(300);
  await save("templates-dialog.png");

  // 3. A template's detail.
  const loaded = await cdp.evaluate(`(() => { const row = [...document.querySelectorAll('li')].find((el) => /Engineering team/.test(el.textContent || '')); const button = row && [...row.querySelectorAll('button')].find((el) => /Load/.test(el.textContent || '')); if (!button) return false; button.click(); return true; })()`);
  assert.ok(loaded, "Load on the Engineering row");
  await waitFor(async () => { const t = await text(); return t.includes("Team members") && t.includes("Atlas leads") && t.includes("What gets created") && t.includes("stays off"); }, "the template detail");
  const detail = await text();
  assert.ok(/existing member and their conversations stay unchanged/.test(detail), "the footer names the existing member");
  assert.ok(/arrives paused/.test(detail), "routines are shown paused");
  await delay(300);
  await save("template-detail.png");

  // 4. Add team is non-blocking: the dialog closes and the directory shows the preparing rows.
  assert.ok(await clickTestId("template-add-team"), "Add team");
  await waitFor(async () => !(await text()).includes("What gets created"), "the dialog to close at once", 5000);
  await waitFor(async () => cdp.evaluate(`document.querySelectorAll('[data-testid="team-build-row"]').length >= 4`), "four preparing rows in the directory", 10000);
  const preparing = await text();
  assert.ok(/4 preparing/.test(preparing), "the summary counts them");
  assert.ok(/Preparing… \(0 of 4 ready\)/.test(preparing), "the first row says it is being prepared");
  assert.ok(/Joining Engineering team/.test(preparing));
  await delay(300);
  await save("directory-preparing.png");
  const stored = await cdp.evaluate("localStorage.getItem('autohandSquad.v1.teamBuilds') || ''");
  assert.ok(stored.includes('"status":"preparing"'), "the build record is persisted for a reload");

  console.log(`Team builder browser check passed; screenshots: ${saved.map((path) => path.replace(`${root}/`, "")).join(", ")}`);
} catch (error) {
  console.error(`bridge log tail: ${logs.slice(-1500)}`);
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
