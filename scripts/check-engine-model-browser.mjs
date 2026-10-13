#!/usr/bin/env node
// The member Model page for an engine member (ADR-0125, revision): a Claude
// Code member shows its engine and model, not the Autohand provider. The
// scaffold below is shared with check-chats-browser.mjs.
// Previous chats, end to end in a real browser (ADR-0113). Two installs in a
// row showed "No previous chats yet" after New chat while every bridge check
// passed: the first because the body limit refused the archive, the second
// because nothing had been put away yet. Only a browser clicking New chat
// proves the whole path, so this does exactly that: a throwaway bridge
// serving dist/, headless Chrome over the DevTools protocol, a seeded member
// with a conversation, click New chat, expect the chat to be listed, open it,
// expect the messages back.
//
// No engine runs: New chat only archives and resets. Needs Chrome; without
// one it warns and exits 0 (AUTOHAND_REQUIRE_BROWSER=1 makes that a failure).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initialAgents, initialChannels } from "../src/data.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean).find(existsSync);
if (!chromePath) {
  if (process.env.AUTOHAND_REQUIRE_BROWSER) { console.error("check:chats:browser: no Chrome or Chromium found and AUTOHAND_REQUIRE_BROWSER is set"); process.exit(1); }
  console.warn("check:chats:browser: no Chrome or Chromium found; skipped (set CHROME_PATH to run it)");
  process.exit(0);
}
assert.ok(existsSync(join(root, "dist", "index.html")), "dist/index.html must exist (run bun run build first)");

const PREFIX = "/squad-members";
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

const now = new Date().toISOString();
const earlier = new Date(Date.now() - 60000).toISOString();
const member = {
  id: "asq_verify_alex", name: "Alex", role: "GTM lead", status: "online", staffId: "verify-alex", workspace: root,
  avatar: "/avatars/birds/kiwi.webp", description: "Browser fixture member.",
  projects: [{ id: "verify-project", name: "autohandSWE", label: "autohandSWE", path: root, kind: "project" }],
  memory: [], skills: [], permissions: {}, stats: {}, modelAssignment: { mode: "inherit" },
  harness: { id: "claude", executablePath: "", model: "", effort: "", access: "" },
  conversationStartedAt: earlier,
};
const QUESTION = "Switch plan mode off and write the NZ shortlist";
const REPLY = "Shortlist written to scripts/nz_shortlist.py; plan mode is off.";
const fixtures = {
  agents: [member],
  removedAgents: initialAgents.map((agent) => agent.id),
  seedChannelIds: initialChannels.map((channel) => channel.id),
  messages: { [member.id]: [
    { id: "verify-u1", role: "user", body: QUESTION, status: "complete", startedAt: earlier, createdAt: earlier },
    { id: "verify-a1", role: "agent", body: REPLY, status: "complete", startedAt: earlier, createdAt: earlier, completedAt: earlier, durationMs: 1200 },
  ] },
  now,
};
function installFixtures(data) {
  const store = (key, value) => localStorage.setItem(`autohandSquad.v1.${key}`, JSON.stringify(value));
  if (!localStorage.getItem("chatsVerify.initialized")) {
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
    store("messages", data.messages);
    store("automations", []);
    store("onboarding", { version: 1, status: "skipped", lastStep: "skipped" });
    localStorage.setItem("autohandSquad.v1.sidebarCollapsed", "false");
    localStorage.setItem("chatsVerify.initialized", "true");
  }
}

const directory = await mkdtemp(join(tmpdir(), "squad-chats-browser-"));
// The app shows its sign-in gate until the bridge reports an account; the
// bridge reads <squadStateDir>/config.json for that. No network is touched.
await mkdir(join(directory, "squad"), { recursive: true });
await writeFile(join(directory, "squad", "config.json"), JSON.stringify({ apiAuthToken: "fixture-only-no-network", accountEmail: "fixture@example.com" }));
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
const api = async (path) => (await fetch(origin + path)).json();
let cdp = null;
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
  const text = () => cdp.evaluate("document.body.innerText || ''");
  // A Claude Code member: the Model page shows the engine, never the Autohand provider.
  await cdp.send("Page.navigate", { url: `${origin}${PREFIX}/${member.id}/model` });
  await waitFor(async () => (await text()).includes("runs with Claude Code"), "the engine Model page", 30000);
  const page = await text();
  assert.ok(await cdp.evaluate(`Boolean(document.querySelector('[data-testid="engine-model-page"]'))`), "the engine Model page renders");
  const label = await cdp.evaluate(`document.querySelector('[data-testid="engine-model-label"]')?.textContent || ''`);
  assert.ok(/^Claude/.test(label), `the effective model names the engine: ${label}`);
  assert.ok(!/Autohand AI/.test(label), "not the Autohand provider");
  assert.ok(page.includes("Engine settings") && page.includes("applies only if"), "engine settings and the provider note are shown");
  assert.ok(!page.includes("Choose whether this squad member inherits the workspace default"), "the Autohand provider form is not shown");
  const shotDir = join(root, ".codex-artifacts", "engine-model");
  await mkdir(shotDir, { recursive: true });
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(shotDir, "engine-model-page.png"), Buffer.from(data, "base64"));
  console.log(`Engine Model page browser check passed: "${label}".`);
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
