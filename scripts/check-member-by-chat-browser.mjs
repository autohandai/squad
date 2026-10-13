#!/usr/bin/env node
// "Chat with a new member" in a real browser (ADR-0126): a throwaway bridge
// serving dist/, headless Chrome over the DevTools protocol, one seeded
// member so the app opens on the Squad page. Then:
//   1. the Squad page shows the secondary action beside New member;
//   2. the sidebar's Direct messages "+" lists "Chat with a new member" first;
//   3. clicking it creates "New member", opens its chat, and the first
//      message is the greeting;
//   4. the new member is pointed at the disposable fake Claude Code harness
//      (the same fixture as check-chats), the person writes "you're going to
//      be my GTM Leader", the fake replies with the confirm line, the four
//      questions and a `profile` SQUAD_ACTION; the real bridge applies it,
//      and the browser shows the sidebar row renamed to Alex, the quiet line
//      "Alex is now your GTM Leader" under the reply, the action line nowhere,
//      and the member's role saved.
// Screenshots land under .codex-artifacts/lanes/bot-by-chat/.
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
const artifacts = join(root, ".codex-artifacts", "lanes", "bot-by-chat");
const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean).find(existsSync);
if (!chromePath) {
  if (process.env.AUTOHAND_REQUIRE_BROWSER) { console.error("check:member-by-chat:browser: no Chrome or Chromium found and AUTOHAND_REQUIRE_BROWSER is set"); process.exit(1); }
  console.warn("check:member-by-chat:browser: no Chrome or Chromium found; skipped (set CHROME_PATH to run it)");
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

const directory = await mkdtemp(join(tmpdir(), "squad-member-by-chat-browser-"));
const fake = join(directory, "fixture-claude");
const now = new Date().toISOString();
const member = {
  id: "asq_verify_eva", name: "Eva", role: "QA Engineer", status: "online", staffId: "verify-eva", workspace: root,
  avatar: "/avatars/birds/kiwi.webp", description: "Browser fixture member.", employeeType: "common-qa-engineer",
  projects: [{ id: "verify-project", name: "autohandSWE", label: "autohandSWE", path: root, kind: "project" }],
  memory: [], skills: [], permissions: {}, stats: {}, modelAssignment: { mode: "inherit" },
  harness: { id: "autohand", executablePath: "", model: "", effort: "", access: "" },
};
const fixtures = { agents: [member], removedAgents: initialAgents.map((agent) => agent.id), seedChannelIds: initialChannels.map((channel) => channel.id), now };
function installFixtures(data) {
  const store = (key, value) => localStorage.setItem(`autohandSquad.v1.${key}`, JSON.stringify(value));
  if (!localStorage.getItem("memberByChatVerify.initialized")) {
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
    store("theme", { mode: "light", lightTheme: "autohand-light", darkTheme: "autohand-dark" });
    localStorage.setItem("autohandSquad.v1.sidebarCollapsed", "false");
    localStorage.setItem("memberByChatVerify.initialized", "true");
  }
}

// The fake engine answers the role request the way the instruction asks.
const action = 'SQUAD_ACTION: {"type":"profile","op":"set","name":"Alex","role":"GTM Leader","instructions":"You own the go-to-market plan.","personality":"Direct and practical.","skills":["go-to-market strategy","market research"]}';
const shapedReply = ["Done, I'm your GTM Leader from here on. To start building the plan I need a few things:", "1. What's the product and who is it for?", "2. Stage: pre-launch, early customers, or scaling?", "3. Any existing assets (site, deck, pricing, customer list)?", "4. Main goal for the next 90 days?", "Send what you have, even rough.", action].join("\n");
await writeFile(fake, `#!${process.execPath}
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('claude 1.0.0');process.exit(0);}
const member=process.env.AUTOHAND_SQUAD_MEMBER;
const session='fixture-'+member+'-'+Date.now().toString(36);
const prompt=String(args[1]||'');
const emit=x=>console.log(JSON.stringify(x));
emit({type:'system',subtype:'init',session_id:session,model:'claude-fixture'});
const text=/GTM Leader/.test(prompt)?${JSON.stringify(shapedReply)}:"Hey! I'm New member. What can I help you with?";
emit({type:'assistant',message:{id:'reply',content:[{type:'text',text}]}});
emit({type:'result',subtype:'success',result:text,session_id:session,usage:{input_tokens:400,output_tokens:10}});
process.exit(0);
`);
await chmod(fake, 0o700);
await mkdir(join(directory, "squad"), { recursive: true });
await mkdir(join(directory, "claude"), { recursive: true });
await writeFile(join(directory, "squad", "config.json"), JSON.stringify({ apiAuthToken: "fixture-only-no-network", accountEmail: "fixture@example.com" }));
// New member prepares a default-engine member only for a signed-in account;
// a local token stands in (preparing writes files, it calls no service).
await writeFile(join(directory, "config.json"), JSON.stringify({ auth: { token: "fixture-only-no-network" } }));
await mkdir(artifacts, { recursive: true });
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
  const save = async (name) => { await delay(300); const path = join(artifacts, name); await cdp.screenshot(path); saved.push(path); };
  const agentsStored = () => cdp.evaluate("JSON.parse(localStorage.getItem('autohandSquad.v1.agents') || '[]')");
  const sidebarNames = () => cdp.evaluate("[...document.querySelectorAll('aside button[aria-label]')].map((el) => el.getAttribute('aria-label')).join(' | ')");

  // 1. The Squad page: the secondary action beside New member.
  await waitFor(async () => (await text()).includes("New member") && (await text()).includes("Eva"), "the Squad directory", 30000);
  assert.ok(!/could not render/i.test(await text()), "no error boundary");
  assert.ok(await cdp.evaluate(`Boolean(document.querySelector('[data-testid="chat-new-member"]'))`), "Chat with a new member sits beside New member on the Squad page");
  await save("squad-page-actions.png");

  // 2. The sidebar's Direct messages "+": Chat with a new member, first.
  const opened = await cdp.evaluate(`(() => { const header = [...document.querySelectorAll('aside *')].find((el) => el.children.length === 0 && /^Direct messages$/i.test((el.textContent || '').trim())); let node = header; while (node && !node.querySelector('button[aria-label="Create"]')) node = node.parentElement; const plus = node && node.querySelector('button[aria-label="Create"]'); if (!plus) return false; plus.click(); return true; })()`);
  assert.ok(opened, "the Direct messages + opens");
  await waitFor(async () => cdp.evaluate(`Boolean(document.querySelector('[data-testid="chat-new-member-menu"]'))`), "the create menu");
  const order = await cdp.evaluate(`[...document.querySelector('[data-testid="chat-new-member-menu"]').parentElement.querySelectorAll('button')].map((el) => el.textContent.trim())`);
  assert.deepEqual(order, ["Chat with a new member", "New member", "New team…", "Templates…"], `menu order: ${order.join(", ")}`);
  await save("sidebar-create-menu.png");

  // 3. Click it: a blank member, its chat, the greeting.
  assert.ok(await cdp.evaluate(`(() => { document.querySelector('[data-testid="chat-new-member-menu"]').click(); return true; })()`));
  const created = await waitFor(async () => (await agentsStored()).find((agent) => agent.name === "New member"), "the new member to be saved", 30000);
  assert.equal(created.role, "", "the new member has no role");
  await waitFor(async () => (await text()).includes("Hey! I'm New member. What can I help you with?"), "the greeting in the new member's chat", 30000);
  assert.ok((await cdp.evaluate("location.pathname + location.search")).includes(created.id), "the new member's chat is open");
  assert.ok((await sidebarNames()).includes("New member"), "the sidebar lists New member");
  await save("new-member-greeting.png");

  // 4. Point it at the fake engine, ask for a role, and watch it shape itself.
  await cdp.evaluate(`(() => { const agents = JSON.parse(localStorage.getItem('autohandSquad.v1.agents')); const target = agents.find((agent) => agent.id === ${JSON.stringify(created.id)}); target.harness = { ...target.harness, id: 'claude', executablePath: ${JSON.stringify(fake)} }; localStorage.setItem('autohandSquad.v1.agents', JSON.stringify(agents)); return true; })()`);
  await cdp.send("Page.navigate", { url: `${origin}/conversations/new?member=${created.id}` });
  await waitFor(async () => cdp.evaluate("Boolean(document.querySelector('textarea'))") && (await text()).includes("Hey! I'm New member."), "the composer after reload", 30000);
  await cdp.evaluate(`(() => { const field = document.querySelector('textarea'); field.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, "you're going to be my GTM Leader"); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await delay(200);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await waitFor(async () => cdp.evaluate(`(document.querySelector('[data-testid="profile-note"]') || {}).innerText || ''`), "the quiet profile line", 45000);
  const note = await cdp.evaluate(`document.querySelector('[data-testid="profile-note"]').innerText`);
  assert.equal(note, "Alex is now your GTM Leader", "the quiet line under the reply");
  const page = await text();
  assert.ok(page.includes("Done, I'm your GTM Leader from here on.") && page.includes("Main goal for the next 90 days?"), "the reply shows the confirm line and the questions");
  assert.ok(!page.includes("SQUAD_ACTION"), "the action line is not shown");
  assert.ok(!page.includes("Alex is now your GTM Leader."), "the receipt line is lifted out of the body (only the quiet line, without the full stop, remains)");
  await waitFor(async () => (await sidebarNames()).includes("Alex") && !(await sidebarNames()).includes("New member"), "the sidebar row renamed to Alex");
  const shaped = await waitFor(async () => (await agentsStored()).find((agent) => agent.id === created.id && agent.role === "GTM Leader"), "the role saved on the member");
  assert.equal(shaped.name, "Alex");
  assert.equal(shaped.instructions, "You own the go-to-market plan.");
  assert.equal(shaped.skills.length, 2, `the two skills were saved: ${JSON.stringify(shaped.skills)}`);
  assert.ok((shaped.profileFiles || []).some((file) => file.section === "persona" && /Direct and practical\./.test(file.content)), "personality became PERSONALITY.md");
  await save("member-shaped.png");

  const thrown = cdp.events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text || "exception");
  assert.deepEqual(thrown, [], `uncaught exceptions: ${thrown.join(" | ")}`);
  console.log(`Member-by-chat browser check passed: the Squad page action, the sidebar menu with Chat with a new member first, a blank New member opened on its greeting, and after a real bridge turn with a profile action the sidebar row renamed to Alex with "Alex is now your GTM Leader" under the reply. Screenshots: ${saved.join(", ")}`);
} catch (error) {
  try { if (cdp) await cdp.screenshot(join(artifacts, "failure.png")); } catch {}
  console.error(`bridge log tail: ${logs.slice(-2500)}`);
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
