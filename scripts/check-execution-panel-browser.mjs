#!/usr/bin/env node
// The Execution panel, rendered (ADR-0117). A throwaway bridge serves dist/
// with a seeded run history (finished chat replies and launched runs across
// three days), headless Chrome opens a member chat through the same
// `?panel=runs&run=<id>` link the member History uses, and the check expects
// the panel open on that run with its output disclosed, the Tasks and
// Automations tabs reachable, and no error boundary.
//
// With `--shots <dir>` it also saves one PNG per tab in light and dark, which
// is how the before/after evidence in the ADR was produced.
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
  if (process.env.AUTOHAND_REQUIRE_BROWSER) { console.error("check:execution-panel:browser: no Chrome or Chromium found and AUTOHAND_REQUIRE_BROWSER is set"); process.exit(1); }
  console.warn("check:execution-panel:browser: no Chrome or Chromium found; skipped (set CHROME_PATH to run it)");
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
const alex = {
  id: "asq_verify_alex", name: "Alex", role: "GTM lead", status: "online", staffId: "verify-alex", workspace: root,
  avatar: "/avatars/birds/kiwi.webp", description: "Browser fixture member.",
  projects: [{ id: "verify-project", name: "autohandSWE", label: "autohandSWE", path: root, kind: "project" }],
  memory: [], skills: [], permissions: {}, stats: {}, modelAssignment: { mode: "inherit" },
  harness: { id: "claude", executablePath: "", model: "", effort: "", access: "" },
  conversationStartedAt: at(60),
};
const noah = { ...alex, id: "asq_verify_noah", name: "Noah", role: "Frontend engineer", staffId: "verify-noah", avatar: "/avatars/birds/robin.webp", harness: { id: "autohand", executablePath: "", model: "", effort: "", access: "" } };
const logLines = (count, finished = "completed") => [
  { source: "stdout", line: "started read_file", at: at(5) },
  { source: "stdout", line: "read_file completed", at: at(5) },
  { source: "stdout", line: "started bash", at: at(4) },
  { source: "stdout", line: finished === "failed" ? "bash failed" : "bash completed", at: at(4) },
  ...Array.from({ length: Math.max(0, count - 4) }, (_, i) => ({ source: "stdout", line: `line ${i + 1} of the reply`, at: at(3) })),
];
function run({ id, title, minutesAgo, duration = 90_000, status = "completed", mode = "chat", harness = "claude", agentId = alex.id, effectiveModel = null, lines = 160, reply = "Done." }) {
  return {
    id, agentId, title, mode, kind: mode === "chat" ? "chat" : "launch", workspace: root, configPath: "", displayConfigPath: "", agentHome: "",
    effectiveModel, transport: harness === "autohand" ? "sdk" : harness, harness, harnessVersion: "", command: mode === "chat" ? "" : "autohand run --prompt …",
    logPath: "", status, exitCode: status === "failed" ? 1 : null, startedAt: at(minutesAgo), finishedAt: new Date(NOW - minutesAgo * 60000 + duration).toISOString(),
    durationMs: duration, channel: null, recipeId: null, canvasId: null, reply, sessionId: "", logs: logLines(lines, status),
  };
}
const FOCUS_ID = "run_verify_focus";
const runs = [
  run({ id: "run_verify_old_1", title: "Draft the Q3 partner outreach email for the three NZ accounts we discussed", minutesAgo: 3 * 24 * 60 + 40, lines: 42 }),
  run({ id: "run_verify_old_2", title: "Launch: nightly smoke test", minutesAgo: 3 * 24 * 60 + 10, mode: "prompt", harness: "autohand", effectiveModel: { provider: "anthropic", label: "Anthropic", model: "sonnet" }, lines: 12, status: "failed" }),
  run({ id: "run_verify_y_1", title: "Which of these accounts should we deprioritise given the churn numbers?", minutesAgo: 26 * 60, lines: 88 }),
  run({ id: "run_verify_y_2", title: "Summarise the pricing thread and list the open questions", minutesAgo: 25 * 60, lines: 31, status: "stopped" }),
  run({ id: "run_verify_t_1", title: "Switch plan mode off and write the NZ shortlist as a script we can rerun each week without touching the sheet", minutesAgo: 50, lines: 160 }),
  run({ id: FOCUS_ID, title: "Compare our onboarding flow with the two competitors' and tell me what we are missing", minutesAgo: 20, lines: 73, effectiveModel: { provider: "anthropic", label: "Anthropic", model: "opus" } }),
  run({ id: "run_verify_t_3", title: "Goal: keep the outreach sheet in sync", minutesAgo: 6, mode: "goal", harness: "claude", lines: 9 }),
];
const tasks = [{
  id: "task_verify_review",
  title: "Review the onboarding comparison before it goes to the team",
  agentId: alex.id, currentOwnerId: noah.id, originAgentId: alex.id, project: "autohandSWE", status: "handoff-pending", source: "local-chat",
  createdAt: at(30), updatedAt: at(12), summary: "Alex compared the onboarding flows; Noah checks the numbers against the product.",
  assignments: [
    { id: "assign_verify_1", agentId: alex.id, sourceAgentId: alex.id, status: "completed", reason: "Compare the flows.", requiredContext: "", expectedOutput: "", sourceEvidence: "", createdAt: at(30), updatedAt: at(20), attempt: 1 },
    { id: "assign_verify_2", agentId: noah.id, sourceAgentId: alex.id, status: "pending", reason: "Check the numbers.", requiredContext: "", expectedOutput: "", sourceEvidence: "", createdAt: at(12), updatedAt: at(12), attempt: 1, handoffId: "handoff_verify_1" },
  ],
  handoffs: [{ id: "handoff_verify_1", fromAgentId: alex.id, toAgentId: noah.id, status: "pending", reason: "Noah knows the product numbers better than I do.", requiredContext: "The comparison reply and the pricing sheet.", expectedOutput: "Corrections, or a go.", sourceEvidence: `Run ${FOCUS_ID}`, createdAt: at(12), updatedAt: at(12), checkpointId: "checkpoint_verify_1", attempt: 1 }],
  timeline: [{ id: "timeline_verify_1", type: "handoff.created", at: at(12), actorAgentId: alex.id, targetAgentId: noah.id, summary: "Alex handed the review to Noah." }],
}, {
  id: "task_verify_done", title: "Draft the partner outreach email", agentId: alex.id, currentOwnerId: alex.id, originAgentId: alex.id, project: "autohandSWE", status: "completed", source: "local-chat",
  createdAt: at(3 * 24 * 60 + 40), updatedAt: at(3 * 24 * 60 + 30), summary: "Sent to the three NZ accounts.", runtimeId: "run_verify_old_1", assignments: [], handoffs: [], timeline: [],
}];
const automations = [{ id: "tr_verify_smoke", agentId: alex.id, name: "Weekly outreach sync", schedule: "Every Monday", scheduleFrequency: "weekly", scheduleTime: "09:00", triggerType: "schedule", target: "local", workspace: root, status: "active", runCount: 3, createdAt: at(7 * 24 * 60), lastRun: at(2 * 24 * 60), prompt: "Sync the outreach sheet." }];
const fixtures = {
  agents: [alex, noah],
  removedAgents: initialAgents.map((agent) => agent.id),
  seedChannelIds: initialChannels.map((channel) => channel.id),
  messages: { [alex.id]: [
    { id: "verify-u1", role: "user", body: runs[5].title, status: "complete", startedAt: at(20), createdAt: at(20) },
    { id: "verify-a1", role: "agent", body: "They both let people skip the folder step; we do not.", status: "complete", startedAt: at(20), createdAt: at(20), completedAt: at(19), durationMs: 1200 },
  ] },
  tasks, automations, now: new Date(NOW).toISOString(),
};
function installFixtures(data, theme) {
  const store = (key, value) => localStorage.setItem(`autohandSquad.v1.${key}`, JSON.stringify(value));
  if (!localStorage.getItem("executionVerify.initialized")) {
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
    store("automations", data.automations);
    store("onboarding", { version: 1, status: "skipped", lastStep: "skipped" });
    store("theme", { mode: theme, lightTheme: "autohand-light", darkTheme: "autohand-dark" });
    localStorage.setItem("autohandSquad.v1.sidebarCollapsed", "false");
    localStorage.setItem("executionVerify.initialized", "true");
  }
}

// ---- bridge + browser -----------------------------------------------------
const directory = await mkdtemp(join(tmpdir(), "squad-execution-panel-"));
await mkdir(join(directory, "squad"), { recursive: true });
await mkdir(join(directory, "app"), { recursive: true });
await writeFile(join(directory, "squad", "config.json"), JSON.stringify({ apiAuthToken: "fixture-only-no-network", accountEmail: "fixture@example.com" }));
await writeFile(join(directory, "app", "run-history.json"), JSON.stringify({ version: 1, runs }));
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
  await waitFor(async () => (await fetch(`${origin}/api/runs`).catch(() => null))?.ok, "bridge", 30000);
  const listedBody = await (await fetch(`${origin}/api/runs`)).json();
  const listed = Array.isArray(listedBody) ? listedBody : listedBody?.data;
  assert.equal(listed?.length, runs.length, "the bridge restored the seeded run history");
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
  // A real pointer press: Radix tab triggers activate on mousedown, not click.
  // The sheet slides in; a press at a rect read mid-transition lands on the
  // overlay, which Radix treats as "outside" and closes the sheet. Wait until
  // the tab has stopped moving before pressing.
  const settledRect = async (read) => {
    let last = null;
    for (let i = 0; i < 20; i += 1) {
      const next = await read();
      if (next && last && Math.abs(next.x - last.x) < 0.5 && Math.abs(next.y - last.y) < 0.5) return next;
      last = next;
      await delay(120);
    }
    return last;
  };
  const clickTab = async (label) => {
    const rect = await settledRect(() => cdp.evaluate(`(() => { const sheet = document.querySelector('[data-slot="sheet-content"]'); const el = [...(sheet || document).querySelectorAll('button,[role="tab"]')].find((b) => (b.textContent || '').trim() === ${JSON.stringify(label)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`));
    if (!rect) return false;
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await waitFor(async () => cdp.evaluate(`(() => { const sheet = document.querySelector('[data-slot="sheet-content"]'); const el = [...(sheet || document).querySelectorAll('[role="tab"]')].find((b) => (b.textContent || '').trim() === ${JSON.stringify(label)}); return Boolean(el && (el.getAttribute("aria-selected") === "true" || el.dataset.state === "active")); })()`), `the ${label} tab to be active`);
    return true;
  };

  for (const theme of ["light", "dark"]) {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.removeItem("executionVerify.initialized"); (${installFixtures.toString()})(${JSON.stringify(fixtures)}, ${JSON.stringify(theme)});` });
    await cdp.send("Page.navigate", { url: `${origin}/conversations/new?member=${alex.id}&panel=runs&run=${FOCUS_ID}` });
    await waitFor(async () => (await text()).includes("Execution"), `the Execution panel (${theme})`, 30000);
    const boundary = (await text()).match(/could not render[^\n]{0,200}/i);
    assert.ok(!boundary, `error boundary: ${boundary?.[0]}`);
    await waitFor(async () => (await sheetText()).includes("Compare our onboarding flow"), "the focused run row", 20000);
    const body = await sheetText();
    assert.ok(/Output · \d+ lines/.test(body), "a run row carries its output disclosure");
    const opened = await cdp.evaluate(`(() => { const el = document.getElementById("run-${FOCUS_ID}"); const d = el && el.querySelector("details"); return Boolean(d && d.open); })()`);
    assert.ok(opened, "the linked run's output is open");
    await shoot(`${theme}-runs`);

    assert.ok(await clickTab("Tasks"), "a Tasks tab");
    await waitFor(async () => /Handoff|handoff/.test(await sheetText()), "the task list");
    await shoot(`${theme}-tasks`);

    assert.ok(await clickTab("Automations"), "an Automations tab");
    await waitFor(async () => (await sheetText()).includes("Weekly outreach sync"), "the automation row");
    await shoot(`${theme}-automations`);
  }
  const thrown = cdp.events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text || "exception");
  assert.deepEqual(thrown, [], `uncaught exceptions: ${thrown.join(" | ")}`);
  console.log(`Execution panel browser check passed: ${runs.length} seeded runs listed, the linked run opened with its output, Tasks and Automations rendered in light and dark${shotsDir ? `; screenshots in ${shotsDir}` : ""}.`);
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
