#!/usr/bin/env node
// The Tasks tab with a member's plan, rendered (ADR-0124). A throwaway bridge
// serves dist/ with a seeded work.json (a recurring task mid-run with its
// last outcome, one the person added, one blocked, one done) and one local
// launched task; headless Chrome opens the member chat on `?panel=tasks` and
// the check expects the plan rows, their statuses, the Add control and the
// launched task under its own label, with no error boundary.
//
// With `--shots <dir>` it also saves one PNG per theme, which is how the
// evidence in the ADR was produced.
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
const shotsDir = (() => {
  const index = process.argv.indexOf("--shots");
  return index >= 0 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : "";
})();
const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean).find(existsSync);
if (!chromePath) {
  if (process.env.AUTOHAND_REQUIRE_BROWSER) { console.error("check:work-plans:browser: no Chrome or Chromium found and AUTOHAND_REQUIRE_BROWSER is set"); process.exit(1); }
  console.warn("check:work-plans:browser: no Chrome or Chromium found; skipped (set CHROME_PATH to run it)");
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
const NOW = Date.now();
const at = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString();
const day = (offset) => new Date(NOW + offset * 86400000).toISOString().slice(0, 10);
const alex = {
  id: "asq_verify_alex", name: "Alex", role: "GTM APAC Leader", status: "online", staffId: "verify-alex", workspace: root,
  avatar: "/avatars/birds/kiwi.webp", description: "Browser fixture member.",
  projects: [{ id: "verify-project", name: "leads", label: "leads", path: root, kind: "project" }],
  memory: [], skills: [], permissions: {}, stats: {}, modelAssignment: { mode: "inherit" },
  harness: { id: "claude", executablePath: "", model: "", effort: "", access: "" },
  conversationStartedAt: at(60),
};
const noah = { ...alex, id: "asq_verify_noah", name: "Noah", role: "Frontend engineer", staffId: "verify-noah", avatar: "/avatars/birds/robin.webp", harness: { id: "autohand", executablePath: "", model: "", effort: "", access: "" } };
const history = (by, event, note, minutesAgo) => ({ at: at(minutesAgo), by, event, note });
const work = { version: 1, updatedAt: at(1), receipts: [], tasks: [
  { id: "t_nzbtch", memberId: alex.id, title: "Send the NZ batch", detail: "20 ICP-matched leads from the Tier 1 list, personalised opener, paid pilot as the ask.", status: "doing", due: day(0), recurring: "routine_verify_nz", source: "routine", outcome: "", lastOutcome: { at: at(24 * 60), status: "completed", preview: "18 sent, 2 bounced" }, createdAt: at(3 * 24 * 60), updatedAt: at(4), doneAt: null, history: [history("routine", "added", "created by a routine run", 3 * 24 * 60), history("routine", "run", "run completed: 18 sent, 2 bounced", 24 * 60), history("routine", "run", "run started (schedule)", 4)] },
  { id: "t_auacct", memberId: alex.id, title: "Research 20 AU accounts for the pilot", detail: "ICP tier 1, Sydney and Melbourne, note the champion on each.", status: "open", due: day(1), recurring: "", source: "person", outcome: "", lastOutcome: null, createdAt: at(50), updatedAt: at(50), doneAt: null, history: [history("person", "added", "", 50)] },
  { id: "t_replie", memberId: alex.id, title: "Check replies and log the warm ones", detail: "", status: "open", due: day(0), recurring: "", source: "member", outcome: "", lastOutcome: null, createdAt: at(40), updatedAt: at(40), doneAt: null, history: [history("member", "added", "", 40)] },
  { id: "t_stripe", memberId: alex.id, title: "Confirm the pilot price with Igor", detail: "Blocked until the pricing thread is answered.", status: "blocked", due: day(-2), recurring: "", source: "member", outcome: "", lastOutcome: null, createdAt: at(2 * 24 * 60), updatedAt: at(30), doneAt: null, history: [history("member", "added", "", 2 * 24 * 60), history("member", "updated", "status blocked", 30)] },
  { id: "t_icpdoc", memberId: alex.id, title: "Write icp.md and rules.md", detail: "", status: "done", due: "", recurring: "", source: "member", outcome: "Both files in the leads folder, reviewed.", lastOutcome: null, createdAt: at(5 * 24 * 60), updatedAt: at(2 * 24 * 60), doneAt: at(2 * 24 * 60), history: [history("member", "added", "", 5 * 24 * 60), history("member", "done", "outcome: Both files in the leads folder, reviewed.", 2 * 24 * 60)] },
] };
const routines = { version: 1, routines: [{ id: "routine_verify_nz", memberId: alex.id, title: "Morning NZ batch", instructions: "Send the NZ batch.", workspace: root, model: "", enabled: true, schedule: { kind: "weekdays", days: [1, 2, 3, 4, 5], time: "09:00", timeZone: "Pacific/Auckland" }, maxRunMinutes: 0, source: "editor", proposalId: "", nextAt: null, lastRunAt: at(4), runs: [], createdAt: at(3 * 24 * 60), updatedAt: at(4) }], proposals: [] };
const tasks = [{
  id: "task_verify_done", title: "Draft the partner outreach email", agentId: alex.id, currentOwnerId: alex.id, originAgentId: alex.id, project: "leads", status: "completed", source: "local-chat",
  createdAt: at(3 * 24 * 60 + 40), updatedAt: at(3 * 24 * 60 + 30), summary: "Sent to the three NZ accounts.", runtimeId: "", assignments: [], handoffs: [], timeline: [],
}];
const fixtures = {
  agents: [alex, noah],
  removedAgents: initialAgents.map((agent) => agent.id),
  seedChannelIds: initialChannels.map((channel) => channel.id),
  messages: { [alex.id]: [
    { id: "verify-u1", role: "user", body: "So give me a sitrep, what tasks are you working on?", status: "complete", startedAt: at(20), createdAt: at(20) },
    { id: "verify-a1", role: "agent", body: "Sending today's NZ batch now; yesterday's run sent 18 and bounced 2. Next I check replies, then the 20 AU accounts you added are due tomorrow. The pilot price is blocked on you.", status: "complete", startedAt: at(20), createdAt: at(20), completedAt: at(19), durationMs: 1200 },
  ] },
  tasks, now: new Date(NOW).toISOString(),
};
function installFixtures(data, theme) {
  const store = (key, value) => localStorage.setItem(`autohandSquad.v1.${key}`, JSON.stringify(value));
  if (!localStorage.getItem("workPlanVerify.initialized")) {
    localStorage.clear();
    store("agents", data.agents);
    store("removedAgents", data.removedAgents);
    store("tasks", data.tasks);
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
    localStorage.setItem("workPlanVerify.initialized", "true");
  }
}

// ---- bridge + browser -----------------------------------------------------
const directory = await mkdtemp(join(tmpdir(), "squad-work-plans-browser-"));
await mkdir(join(directory, "squad"), { recursive: true });
await mkdir(join(directory, "app"), { recursive: true });
await writeFile(join(directory, "squad", "config.json"), JSON.stringify({ apiAuthToken: "fixture-only-no-network", accountEmail: "fixture@example.com" }));
await writeFile(join(directory, "squad", "work.json"), JSON.stringify(work));
await writeFile(join(directory, "squad", "routines.json"), JSON.stringify(routines));
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
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", `--user-data-dir=${join(directory, "chrome")}`, `--remote-debugging-port=${chromePort}`, "about:blank"], { stdio: "ignore" });
let cdp = null;
try {
  await waitFor(async () => (await fetch(`${origin}/api/work`).catch(() => null))?.ok, "bridge", 30000);
  const listed = await (await fetch(`${origin}/api/work?memberId=${alex.id}`)).json();
  assert.equal(listed?.data?.tasks?.length, work.tasks.length, "the bridge loaded the seeded work plan");
  const target = await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json`).then((r) => r.json()).catch(() => []))?.find((item) => item.type === "page"), "Chrome DevTools", 30000);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: shotsDir ? 2 : 1, mobile: false });
  if (shotsDir) await mkdir(shotsDir, { recursive: true });

  const text = () => cdp.evaluate("document.body.innerText || ''");
  const sheetText = () => cdp.evaluate("(document.querySelector('[data-slot=\"sheet-content\"]') || {}).innerText || ''");
  const shoot = async (name) => {
    if (!shotsDir) return;
    await delay(600); // the sheet slides in over 500ms
    const rect = await cdp.evaluate("(() => { const el = document.querySelector('[data-slot=\"sheet-content\"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()");
    const clip = rect ? { ...rect, scale: 1 } : undefined;
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: false });
    await writeFile(join(shotsDir, `${name}.png`), Buffer.from(data, "base64"));
  };

  for (const theme of ["light", "dark"]) {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.removeItem("workPlanVerify.initialized"); (${installFixtures.toString()})(${JSON.stringify(fixtures)}, ${JSON.stringify(theme)});` });
    await cdp.send("Page.navigate", { url: `${origin}/conversations/new?member=${alex.id}&panel=tasks` });
    await waitFor(async () => (await text()).includes("Execution"), `the Execution panel (${theme})`, 30000);
    const boundary = (await text()).match(/could not render[^\n]{0,200}/i);
    assert.ok(!boundary, `error boundary: ${boundary?.[0]}`);
    // The group label is uppercased by CSS, and innerText reports it that way.
    // The label renders as soon as the panel opens; the rows arrive with the app's first /api/work poll.
    await waitFor(async () => { const sheet = await sheetText(); return /alex's plan/i.test(sheet) && sheet.includes("Send the NZ batch") && sheet.includes("Write icp.md and rules.md"); }, "the member's plan rows", 30000).catch(async (error) => { throw new Error(`${error.message}; sheet: ${JSON.stringify((await sheetText()).slice(0, 1500))}`); });
    const body = await sheetText();
    for (const title of ["Send the NZ batch", "Research 20 AU accounts for the pilot", "Check replies and log the warm ones", "Confirm the pilot price with Igor", "Write icp.md and rules.md"]) assert.ok(body.includes(title), `plan row "${title}"`);
    assert.ok(/last run completed: 18 sent, 2 bounced/.test(body), "the recurring row shows its last outcome");
    assert.ok(/overdue 2 days/.test(body), "an overdue task says so");
    assert.ok(/due tomorrow/.test(body) && /you added it/.test(body), "the person's task says when and who");
    assert.ok(body.includes("Add a task"), "the Add control");
    assert.ok(/launched and handed off/i.test(body) && body.includes("Draft the partner outreach email"), "the launched task sits under its own label");
    assert.ok(/4 open tasks/.test(body), `the summary counts the open plan tasks: ${body.split("\n").slice(0, 3).join(" | ")}`);
    const statuses = await cdp.evaluate("[...document.querySelectorAll('[data-testid=\"work-task\"]')].map((el) => el.dataset.status).join(',')");
    assert.equal(statuses, "doing,blocked,open,open,done", "rows are ordered doing, blocked, open by due, then the done group");
    // Hover the first row so its text actions are in the picture.
    const rect = await cdp.evaluate("(() => { const el = document.querySelector('[data-testid=\"work-task\"]'); const r = el.getBoundingClientRect(); return { x: r.x + 40, y: r.y + 12 }; })()");
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
    await waitFor(async () => (await sheetText()).includes("Ask Alex to work on it"), "the hover actions");
    await shoot(`${theme}-tasks`);
  }
  const thrown = cdp.events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text || "exception");
  assert.deepEqual(thrown, [], `uncaught exceptions: ${thrown.join(" | ")}`);
  console.log(`Work plan browser check passed: ${work.tasks.length} seeded plan tasks rendered in the Tasks tab with statuses, due dates, the last outcome, the Add control and the hover actions, in light and dark${shotsDir ? `; screenshots in ${shotsDir}` : ""}.`);
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
