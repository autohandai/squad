#!/usr/bin/env node
// Always-on members, rendered (ADR-0125). A throwaway bridge serves dist/;
// a Claude Code member (with a disposable fake Claude executable, so no
// provider is called) has one earlier reply. Headless Chrome opens its chat
// and expects the header meta line to name Claude, not "Autohand AI / moa";
// then opens New Automation from the header and expects the plain-English
// field first with the old fields under "Fill in by hand", drafts one
// sentence through the member's engine (the fake answers with a schedule
// action) and expects the proposal in the schedule control.
//
// With `--shots <dir>` it saves PNGs of the header and the dialog.
//
// Needs Chrome; without one it warns and exits 0 (AUTOHAND_REQUIRE_BROWSER=1
// makes that a failure).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initialAgents, initialChannels } from "../src/data.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const shotsDir = (() => {
  const index = process.argv.indexOf("--shots");
  return index >= 0 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : "";
})();
const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean).find(existsSync);
if (!chromePath) {
  if (process.env.AUTOHAND_REQUIRE_BROWSER) { console.error("check:always-on:browser: no Chrome or Chromium found and AUTOHAND_REQUIRE_BROWSER is set"); process.exit(1); }
  console.warn("check:always-on:browser: no Chrome or Chromium found; skipped (set CHROME_PATH to run it)");
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

// ---- fixtures -------------------------------------------------------------
const directory = await mkdtemp(join(tmpdir(), "squad-always-on-browser-"));
const fake = join(directory, "fixture-claude");
const NOW = Date.now();
const at = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString();
const alex = {
  id: "asq_verify_alex", name: "Alex", role: "GTM APAC Leader", status: "online", staffId: "verify-alex", workspace: root,
  avatar: "/avatars/birds/kiwi.webp", description: "Browser fixture member.",
  projects: [{ id: "verify-project", name: "leads", label: "leads", path: root, kind: "project" }],
  memory: [], skills: [], permissions: {}, stats: {}, modelAssignment: { mode: "inherit" },
  harness: { id: "claude", executablePath: fake, model: "", effort: "", access: "" },
  conversationStartedAt: at(60),
};
const fixtures = {
  agents: [alex],
  removedAgents: initialAgents.map((agent) => agent.id),
  seedChannelIds: initialChannels.map((channel) => channel.id),
  messages: { [alex.id]: [
    { id: "verify-u1", role: "user", body: "Pull yesterday's signups for me again.", status: "complete", startedAt: at(20), createdAt: at(20) },
    { id: "verify-a1", role: "agent", body: "Done: 42 signups yesterday, 9 from NZ. Shall I do this every weekday? What time, and should the summary come here?", status: "complete", startedAt: at(20), createdAt: at(20), completedAt: at(19), durationMs: 1200, effectiveModel: { provider: "anthropic", model: "fable" } },
  ] },
  now: new Date(NOW).toISOString(),
};
function installFixtures(data, theme) {
  const store = (key, value) => localStorage.setItem(`autohandSquad.v1.${key}`, JSON.stringify(value));
  if (!localStorage.getItem("alwaysOnVerify.initialized")) {
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
    store("theme", { mode: theme, lightTheme: "autohand-light", darkTheme: "autohand-dark" });
    localStorage.setItem("autohandSquad.v1.sidebarCollapsed", "false");
    localStorage.setItem("alwaysOnVerify.initialized", "true");
  }
}

// ---- bridge + browser -----------------------------------------------------
await mkdir(join(directory, "squad"), { recursive: true });
await mkdir(join(directory, "app"), { recursive: true });
await mkdir(join(directory, "claude"), { recursive: true });
await writeFile(join(directory, "squad", "config.json"), JSON.stringify({ apiAuthToken: "fixture-only-no-network", accountEmail: "fixture@example.com" }));
// The fake answers a draft with a schedule action and anything else with a line.
await writeFile(fake, `#!${process.execPath}
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('claude 1.0.0');process.exit(0);}
const prompt=String(args[1]||'');
const emit=x=>console.log(JSON.stringify(x));
emit({type:'system',subtype:'init',session_id:'fixture-session',model:'claude-fixture'});
const text=prompt.startsWith('Draft an automation:')?'SQUAD_ACTION: {"type":"schedule","title":"Signups summary","instructions":"Pull yesterday\\'s signups, count them by country and post a short summary here.","schedule":{"kind":"weekdays","days":[1,2,3,4,5],"time":"08:00"},"timezone":"Pacific/Auckland"}':'Noted.';
emit({type:'assistant',message:{id:'reply',content:[{type:'text',text}]}});
emit({type:'result',subtype:'success',result:text,session_id:'fixture-session',usage:{input_tokens:400,output_tokens:10}});
`);
await chmod(fake, 0o700);
const port = await freePort();
const chromePort = await freePort();
const origin = `http://127.0.0.1:${port}`;
let logs = "";
const bridge = spawn(process.execPath, ["server.mjs", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  env: { ...process.env, AUTOHAND_SQUAD_HOME: join(directory, "squad"), AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, "app"), AUTOHAND_HOME: join(directory, "autohand"), AUTOHAND_USER_CONFIG_PATH: join(directory, "config.json"), CLAUDE_CONFIG_DIR: join(directory, "claude"), ANTHROPIC_API_KEY: "fixture-only-no-provider" },
  stdio: ["ignore", "pipe", "pipe"],
});
bridge.stdout.on("data", (d) => { logs += d; }); bridge.stderr.on("data", (d) => { logs += d; });
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", `--user-data-dir=${join(directory, "chrome")}`, `--remote-debugging-port=${chromePort}`, "about:blank"], { stdio: "ignore" });
let cdp = null;
try {
  await waitFor(async () => (await fetch(`${origin}/api/agenda`).catch(() => null))?.ok, "bridge", 30000);
  const target = await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json`).then((r) => r.json()).catch(() => []))?.find((item) => item.type === "page"), "Chrome DevTools", 30000);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: shotsDir ? 2 : 1, mobile: false });
  if (shotsDir) await mkdir(shotsDir, { recursive: true });

  const text = () => cdp.evaluate("document.body.innerText || ''");
  const dialogText = () => cdp.evaluate("(document.querySelector('[role=\"dialog\"]') || {}).innerText || ''");
  const shoot = async (name, selector) => {
    if (!shotsDir) return;
    await delay(500);
    const rect = selector ? await cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`) : null;
    const clip = rect ? { ...rect, scale: 1 } : undefined;
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: false });
    await writeFile(join(shotsDir, `${name}.png`), Buffer.from(data, "base64"));
  };

  for (const theme of ["light", "dark"]) {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.removeItem("alwaysOnVerify.initialized"); (${installFixtures.toString()})(${JSON.stringify(fixtures)}, ${JSON.stringify(theme)});` });
    await cdp.send("Page.navigate", { url: `${origin}/conversations/new?member=${alex.id}` });
    await waitFor(async () => (await text()).includes("Shall I do this every weekday"), `the chat (${theme})`, 30000);
    const boundary = (await text()).match(/could not render[^\n]{0,200}/i);
    assert.ok(!boundary, `error boundary: ${boundary?.[0]}`);
    const label = await waitFor(async () => cdp.evaluate("(document.querySelector('[data-testid=\"chat-model-label\"]') || {}).innerText || ''"), "the model label");
    assert.ok(/^Claude( · |\s+default)/.test(label), `the header names Claude, got "${label}"`);
    assert.ok(!/Autohand AI/.test(label), `the header must not name the Autohand provider: "${label}"`);
    assert.ok(/Claude · fable/.test(await text()), "the reply's model reads Claude · fable");
    await shoot(`${theme}-chat-header`, "header");
    if (shotsDir) { const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(join(shotsDir, `${theme}-chat.png`), Buffer.from(data, "base64")); }

    await cdp.evaluate("document.querySelector('button[aria-label=\"Automation\"]').click()");
    await waitFor(async () => (await dialogText()).includes("What should happen, and when?"), "the plain-English field");
    const first = await dialogText();
    assert.ok(first.includes("Fill in by hand") && !first.includes("Workspace source") && !first.includes("Automation Description"), `the old fields sit under the disclosure: ${first.slice(0, 400)}`);
    assert.ok(/Alex turns this into a schedule with Claude Code/.test(first), "the hint names the member and its engine");
    await shoot(`${theme}-new-automation`, "[role=\"dialog\"]");
    await cdp.evaluate(`(() => { const el = document.querySelector('#automation-plain-english'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(el, "Every weekday at 8am pull yesterday's signups and post a short summary here."); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await cdp.evaluate("[...document.querySelectorAll('[role=\"dialog\"] button')].find((b) => b.innerText.trim() === 'Draft it').click()");
    await waitFor(async () => (await dialogText()).includes("Each run, Alex will"), "the drafted proposal", 30000).catch(async (error) => { throw new Error(`${error.message}; dialog: ${JSON.stringify((await dialogText()).slice(0, 1200))}; bridge: ${logs.slice(-1500)}`); });
    const drafted = await dialogText();
    assert.ok(/Pacific\/Auckland/.test(drafted) && /Mon|Weekdays/.test(drafted), `the schedule control shows the proposal: ${drafted.slice(0, 800)}`);
    const name = await cdp.evaluate("[...document.querySelectorAll('[data-testid=\"automation-draft\"] input')][0]?.value || ''");
    assert.equal(name, "Signups summary", "the name came from the member's proposal");
    await shoot(`${theme}-new-automation-drafted`, "[role=\"dialog\"]");
    await cdp.evaluate("[...document.querySelectorAll('[role=\"dialog\"] button')].find((b) => b.innerText.trim() === 'Fill in by hand').click()");
    await waitFor(async () => (await dialogText()).includes("Workspace source"), "the hand-filled fields");
    assert.ok((await dialogText()).includes("Webhook"), "Event and Webhook are still there");
  }
  const thrown = cdp.events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text || "exception");
  assert.deepEqual(thrown, [], `uncaught exceptions: ${thrown.join(" | ")}`);
  console.log(`Always-on browser check passed: the Claude Code member's header names Claude, the reply names Claude · fable, New Automation opens on one plain-English field, the member's engine drafted name and schedule into the editor, and the old fields are under Fill in by hand, in light and dark${shotsDir ? `; screenshots in ${shotsDir}` : ""}.`);
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
