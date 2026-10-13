#!/usr/bin/env node
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
  await cdp.send("Page.navigate", { url: `${origin}/conversations/new?member=${member.id}` });
  const text = () => cdp.evaluate("document.body.innerText || ''");
  await waitFor(async () => (await text()).includes(REPLY), "the seeded conversation to show", 30000);
  const boundary = (await text()).match(/could not render[^\n]{0,200}/i);
  assert.ok(!boundary, `error boundary: ${boundary?.[0]}`);

  // 1. Previous chats is empty before anything was put away.
  const clickTestId = (id) => cdp.evaluate(`(() => { const el = document.querySelector('[data-testid="${id}"]'); if (!el) return false; el.click(); return true; })()`);
  assert.ok(await clickTestId("previous-chats"), "the Previous chats control is in the chat header");
  await waitFor(async () => (await text()).includes("No previous chats yet"), "the empty list");
  await cdp.evaluate("document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");

  // 2. New chat puts the conversation away on the bridge.
  const clickedNew = await cdp.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((el) => /New chat/.test(el.textContent || '')); if (!button) return false; button.click(); return true; })()`);
  assert.ok(clickedNew, "the New chat button is in the chat header");
  const listed = await waitFor(async () => { const data = (await api(`/api/members/${member.id}/chats`)).data; return data?.chats?.length ? data.chats : null; }, "the chat to be put away on the bridge", 20000);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, QUESTION, "the chat is named after the first question");
  assert.equal(listed[0].turns, 1);
  await waitFor(async () => !(await text()).includes(REPLY), "the conversation to reset");
  assert.ok(!(await text()).includes("could not be kept"), "no failure note in the fresh chat");

  // 3. The list shows it; opening it brings the messages back and empties the list.
  assert.ok(await clickTestId("previous-chats"));
  await waitFor(async () => (await text()).includes(QUESTION) && (await text()).includes("1 turn"), "the row in the popover");
  const opened = await cdp.evaluate(`(() => { const row = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').includes(${JSON.stringify(QUESTION)}) && !/New chat/.test(el.textContent)); if (!row) return false; row.click(); return true; })()`);
  assert.ok(opened, "the row is clickable");
  await waitFor(async () => (await text()).includes(REPLY), "the archived reply back in the conversation", 20000);
  await waitFor(async () => (await api(`/api/members/${member.id}/chats`)).data.chats.length === 0, "the opened chat left the list");
  const stored = JSON.parse(await readFile(join(directory, "app", "run-history.json"), "utf8").catch(() => '{"runs":[]}'));
  assert.equal(stored.runs.length, 0, "no engine ran during this check");
  console.log(`Previous chats browser check passed: New chat put "${QUESTION}" away, the list showed it, opening it restored the reply.`);
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
