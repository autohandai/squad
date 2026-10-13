#!/usr/bin/env node
// Needs you, rendered (ADR-0121). A throwaway bridge serves dist/ with every
// kind of thing the page can ask of a person seeded through the bridge's own
// files and the browser's storage: a workflow approval, a secret and a
// payment request, a folder request, a handoff, a member-opened channel
// proposal, an unread reply, a blocked task, and three failed runs (a chat
// reply, a goal, a launched run). Headless Chrome opens /work and the check
// expects decisions first, the failed chat reply as one line with no command
// text and "Retry in chat", Replay only on the launched run, and a sidebar
// count equal to the decision rows plus the unread rows.
//
// With `--shots <dir>` it saves one PNG per theme, which is how the
// before/after evidence in the ADR was produced; `--no-assert` only shoots
// (used for the "before" pictures of the old page).
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
import { initialAgents, initialChannels, initialMemoryInbox, initialTasks } from "../src/data.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const shotsDir = (() => {
  const index = process.argv.indexOf("--shots");
  return index >= 0 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : "";
})();
const assertions = !process.argv.includes("--no-assert");
const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean).find(existsSync);
if (!chromePath) {
  if (process.env.AUTOHAND_REQUIRE_BROWSER) { console.error("check:inbox:browser: no Chrome or Chromium found and AUTOHAND_REQUIRE_BROWSER is set"); process.exit(1); }
  console.warn("check:inbox:browser: no Chrome or Chromium found; skipped (set CHROME_PATH to run it)");
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
  id: "asq_inbox_alex", name: "Alex", role: "GTM lead", status: "online", staffId: "inbox-alex", workspace: root,
  avatar: "/avatars/birds/kiwi.webp", description: "Browser fixture member.",
  projects: [{ id: "inbox-project", name: "autohandSWE", label: "autohandSWE", path: root, kind: "project" }],
  memory: [], skills: [], permissions: {}, stats: {}, modelAssignment: { mode: "inherit" },
  harness: { id: "claude", executablePath: "", model: "", effort: "", access: "" },
  conversationStartedAt: at(60),
};
const noah = { ...alex, id: "asq_inbox_noah", name: "Noah", role: "Frontend engineer", staffId: "inbox-noah", avatar: "/avatars/birds/robin.webp", harness: { id: "autohand", executablePath: "", model: "", effort: "", access: "" } };
const iris = { ...alex, id: "asq_inbox_iris", name: "Iris", role: "Reviewer", staffId: "inbox-iris", avatar: "/avatars/birds/wren.webp" };
const CHANNEL_ID = "channel-inbox-ops";
const COMMAND = "claude -p 'changed go ahead' --output-format stream-json --verbose --mcp-config '<squad-managed-mcp-config>'";
const FAILED_CHAT_ID = "run_inbox_failed_chat";
const FAILED_LAUNCH_ID = "run_inbox_failed_launch";
const FAILED_GOAL_ID = "run_inbox_failed_goal";
const logLines = (status) => [
  { source: "stdout", line: "started read_file", at: at(5) },
  { source: "stdout", line: "read_file completed", at: at(5) },
  { source: "stderr", line: status === "failed" ? "exit 1: the engine reported an unexpected error" : "bash completed", at: at(4) },
];
function run({ id, title, minutesAgo, status = "completed", mode = "chat", harness = "claude", agentId = alex.id, command = "", reply = "" }) {
  return {
    id, agentId, title, mode, kind: mode === "chat" ? "chat" : "launch", workspace: root, configPath: "", displayConfigPath: "", agentHome: "",
    effectiveModel: null, transport: harness === "autohand" ? "sdk" : harness, harness, harnessVersion: "", command,
    logPath: "", status, exitCode: status === "failed" ? 1 : null, startedAt: at(minutesAgo), finishedAt: new Date(NOW - minutesAgo * 60000 + 5000).toISOString(),
    durationMs: 5000, channel: null, recipeId: null, canvasId: null, reply, sessionId: "", logs: logLines(status),
  };
}
const runs = [
  run({ id: "run_inbox_done", title: "Summarise the pricing thread and list the open questions", minutesAgo: 240, reply: "Three questions are open." }),
  run({ id: FAILED_GOAL_ID, title: "Goal: keep the outreach sheet in sync with the CRM every evening", minutesAgo: 95, mode: "goal", status: "failed", command: COMMAND }),
  run({ id: FAILED_LAUNCH_ID, title: "Launch: nightly smoke test", minutesAgo: 40, mode: "prompt", harness: "autohand", agentId: noah.id, status: "failed", command: "autohand run --prompt 'nightly smoke test'" }),
  run({ id: FAILED_CHAT_ID, title: "changed go ahead and ship the pricing page copy we agreed on this morning", minutesAgo: 8, status: "failed", command: COMMAND }),
];
const tasks = [{
  id: "task_inbox_handoff",
  title: "QA to Frontend to Reviewer handoff chain",
  agentId: noah.id, currentOwnerId: iris.id, originAgentId: noah.id, project: "autohandSWE", status: "handoff-pending", source: "local-chat",
  createdAt: at(50), updatedAt: at(14), summary: "Noah completed the UI fix and needs a review pass before DevOps validation.",
  assignments: [
    { id: "assign_inbox_1", agentId: noah.id, sourceAgentId: noah.id, status: "completed", reason: "Fix the UI.", requiredContext: "", expectedOutput: "", sourceEvidence: "", createdAt: at(50), updatedAt: at(20), attempt: 1 },
    { id: "assign_inbox_2", agentId: iris.id, sourceAgentId: noah.id, status: "pending", reason: "Review the fix.", requiredContext: "", expectedOutput: "", sourceEvidence: "", createdAt: at(14), updatedAt: at(14), attempt: 1, handoffId: "handoff_inbox_1" },
  ],
  handoffs: [{ id: "handoff_inbox_1", fromAgentId: noah.id, toAgentId: iris.id, status: "pending", reason: "Noah completed the UI fix and needs a review pass before DevOps validation.", requiredContext: "The diff and the QA notes.", expectedOutput: "A go, or corrections.", sourceEvidence: "", createdAt: at(14), updatedAt: at(14), checkpointId: "checkpoint_inbox_1", attempt: 1 }],
  timeline: [{ id: "timeline_inbox_1", type: "handoff.created", at: at(14), actorAgentId: noah.id, targetAgentId: iris.id, summary: "Noah handed the review to Iris." }],
}, {
  id: "task_inbox_blocked", title: "Migrate the billing webhooks to the new signing key", agentId: noah.id, currentOwnerId: noah.id, originAgentId: noah.id, project: "autohandSWE", status: "blocked", source: "local-chat",
  createdAt: at(300), updatedAt: at(120), summary: "The staging key is missing from the environment, so the webhook test cannot run.", assignments: [], handoffs: [], timeline: [],
}, {
  id: "task_inbox_running", title: "Draft the partner outreach email", agentId: alex.id, currentOwnerId: alex.id, originAgentId: alex.id, project: "autohandSWE", status: "running", source: "local-chat",
  createdAt: at(30), updatedAt: at(2), summary: "Writing the three NZ variants.", assignments: [], handoffs: [], timeline: [],
}];
const folderRequests = [{ id: "fr-inbox-1", memberId: alex.id, folder: "/Users/igor/Documents/leads", prompt: "Look at ~/Documents/leads and tell me which accounts went quiet", createdAt: at(25), status: "pending" }];
const vaultRequests = { version: 1, requests: [
  { id: "vrq_inbox_secret", type: "secret", status: "pending", memberId: alex.id, runId: "", channelId: "", createdAt: at(33), request: { kind: "login", label: "GitHub login", reason: "To open the pull request for the pricing page.", saveToVault: true } },
  { id: "vrq_inbox_payment", type: "payment", status: "pending", memberId: alex.id, runId: "", channelId: "", createdAt: at(12), request: { merchant: "Fastmail", amount: "19.99", currency: "USD", site: "fastmail.com", reason: "Renew the shared inbox." } },
] };
const channelsState = { version: 1, revision: 1, updatedAt: at(60), channels: [{ id: CHANNEL_ID, name: "ops", visibility: "public", memberIds: [alex.id, noah.id, iris.id], section: "", createdAt: at(600), updatedAt: at(60) }], threads: [], messages: [],
  agentChannelActions: [{ id: "channel-action-inbox-1", actorId: noah.id, requestId: "req-inbox-1", workspace: root, depth: 0, identityValid: true, digest: "inbox-fixture", status: "proposed", message: "Approve creation of #client-abc with 2 teammates?", action: { name: "client-abc", purpose: "A place for the ABC rollout.", memberIds: [alex.id, noah.id] }, createdAt: at(45), updatedAt: at(45), expiresAt: new Date(NOW + 86400000).toISOString() }] };
const workflows = { version: 1, channels: { [CHANNEL_ID]: [{
  id: "wf_inbox_release", name: "Release checklist", enabled: true, dispatch: "app", trigger: { type: "manual" }, createdAt: at(900), updatedAt: at(900),
  steps: [{ id: "step_inbox_1", kind: "member", memberId: noah.id, prompt: "Run the release checks", approval: true }],
  runs: [{ id: "wfrun_inbox_1", workflowId: "wf_inbox_release", channelId: CHANNEL_ID, startedAt: at(18), status: "waiting_approval", stepIndex: 0, stepResults: [], pendingApproval: { id: "approval_step_inbox_1", stepId: "step_inbox_1", by: "user", emoji: "✅", requestedAt: at(18), messageId: "" }, trigger: { type: "manual" } }],
}] } };
// The demo seeds merge back in unless a stored record carries their ids, so
// each seed task is stored settled and each seed memory proposal decided.
const settledSeeds = initialTasks.map((item) => ({ ...item, status: "completed", handoffs: (item.handoffs || []).map((handoff) => ({ ...handoff, status: "accepted" })), assignments: (item.assignments || []).map((assignment) => ({ ...assignment, status: "completed", failureReason: "" })) }));
const decidedMemory = initialMemoryInbox.map((item) => ({ ...item, status: item.status === "pending" ? "rejected" : item.status }));
const fixtures = {
  agents: [alex, noah, iris],
  removedAgents: initialAgents.map((agent) => agent.id),
  settledSeeds, decidedMemory,
  // The recovered pie-shop channel (src/App.jsx RECOVERED_CHANNELS) merges in
  // like the seeds, so it is marked read too.
  seedChannelIds: [...initialChannels.map((channel) => channel.id), "channel-6eb6c6df-afc4-48c4-bac5-b3ceb9fe3e55", CHANNEL_ID],
  messages: {
    [alex.id]: [
      { id: "inbox-u1", role: "user", body: runs[3].title, status: "complete", startedAt: at(8), createdAt: at(8) },
      { id: "inbox-a1", role: "agent", body: "Alex could not answer: An unknown error occurred (Unexpected)", status: "error", startedAt: at(8), createdAt: at(8), completedAt: at(8), durationMs: 5000, command: COMMAND },
    ],
    [noah.id]: [
      { id: "inbox-u2", role: "user", body: "Where are we on the billing webhooks?", status: "complete", startedAt: at(6), createdAt: at(6) },
      { id: "inbox-a2", role: "agent", body: "Blocked on the staging signing key; I wrote the migration and the test, both wait on the key.", status: "complete", startedAt: at(6), createdAt: at(5), completedAt: at(5), durationMs: 40000 },
    ],
  },
  folderRequests, tasks, now: new Date(NOW).toISOString(),
};
function installFixtures(data, theme) {
  const store = (key, value) => localStorage.setItem(`autohandSquad.v1.${key}`, JSON.stringify(value));
  if (!localStorage.getItem("inboxVerify.initialized")) {
    localStorage.clear();
    store("agents", data.agents);
    store("removedAgents", data.removedAgents);
    store("tasks", [...data.settledSeeds, ...data.tasks]);
    store("memoryInbox", data.decidedMemory);
    store("channels", []);
    store("channelMessages", {});
    store("channelThreads", {});
    store("channelReads", Object.fromEntries(data.seedChannelIds.map((id) => [id, data.now])));
    store("agentReads", {});
    store("messages", data.messages);
    store("folderRequests", data.folderRequests);
    store("automations", []);
    store("onboarding", { version: 1, status: "skipped", lastStep: "skipped" });
    store("theme", { mode: theme, lightTheme: "autohand-light", darkTheme: "autohand-dark" });
    localStorage.setItem("autohandSquad.v1.sidebarCollapsed", "false");
    localStorage.setItem("inboxVerify.initialized", "true");
  }
}

// ---- bridge + browser -----------------------------------------------------
const directory = await mkdtemp(join(tmpdir(), "squad-inbox-"));
await mkdir(join(directory, "squad"), { recursive: true });
await mkdir(join(directory, "app"), { recursive: true });
await writeFile(join(directory, "squad", "config.json"), JSON.stringify({ apiAuthToken: "fixture-only-no-network", accountEmail: "fixture@example.com" }));
await writeFile(join(directory, "squad", "channels.json"), JSON.stringify(channelsState));
await writeFile(join(directory, "squad", "channel-workflows.json"), JSON.stringify(workflows));
// The app merges the demo memory seed back in as pending whenever the bridge
// answers with nothing, so the bridge carries the seed already decided.
await writeFile(join(directory, "squad", "memory-inbox.json"), JSON.stringify({ version: 1, items: decidedMemory }));
await writeFile(join(directory, "app", "run-history.json"), JSON.stringify({ version: 1, runs }));
await writeFile(join(directory, "app", "vault-requests.json"), JSON.stringify(vaultRequests));
await writeFile(join(directory, "squad", "vault-requests.json"), JSON.stringify(vaultRequests));
const port = await freePort();
const chromePort = await freePort();
const origin = `http://127.0.0.1:${port}`;
let logs = "";
const bridge = spawn(process.execPath, ["server.mjs", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  env: { ...process.env, AUTOHAND_SQUAD_HOME: join(directory, "squad"), AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, "app"), AUTOHAND_HOME: join(directory, "autohand"), AUTOHAND_USER_CONFIG_PATH: join(directory, "config.json"), AUTOHAND_SQUAD_VAULT_KEY_SOURCE: "file", AUTOHAND_SQUAD_VAULT_KEY_FILE: join(directory, "squad-vault.key") },
  stdio: ["ignore", "pipe", "pipe"],
});
bridge.stdout.on("data", (d) => { logs += d; }); bridge.stderr.on("data", (d) => { logs += d; });
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", `--user-data-dir=${join(directory, "chrome")}`, `--remote-debugging-port=${chromePort}`, "about:blank"], { stdio: "ignore" });
let cdp = null;
try {
  await waitFor(async () => (await fetch(`${origin}/api/runs`).catch(() => null))?.ok, "bridge", 30000);
  const pendingVault = await (await fetch(`${origin}/api/vault/requests?status=pending`)).json();
  assert.equal((pendingVault?.data?.requests || pendingVault?.requests || []).length, 2, `the bridge lists the two seeded vault requests: ${JSON.stringify(pendingVault).slice(0, 300)}`);
  const target = await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json`).then((r) => r.json()).catch(() => []))?.find((item) => item.type === "page"), "Chrome DevTools", 30000);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: shotsDir ? 2 : 1, mobile: false });
  if (shotsDir) await mkdir(shotsDir, { recursive: true });

  const mainText = () => cdp.evaluate("(document.querySelector('main') || document.body).innerText || ''");
  const shoot = async (name) => {
    if (!shotsDir) return;
    await delay(500);
    // The whole page, however long the list is: the viewport is resized to
    // the document so nothing below the fold is left out of the evidence.
    const height = await cdp.evaluate("Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 960)");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: Math.min(height, 4000), deviceScaleFactor: 2, mobile: false });
    await delay(200);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(join(shotsDir, `${name}.png`), Buffer.from(data, "base64"));
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 2, mobile: false });
  };

  for (const theme of ["light", "dark"]) {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.removeItem("inboxVerify.initialized"); (${installFixtures.toString()})(${JSON.stringify(fixtures)}, ${JSON.stringify(theme)});` });
    await cdp.send("Page.navigate", { url: `${origin}/work` });
    await waitFor(async () => cdp.evaluate("Boolean(document.querySelector('[data-testid=needs-you-list]'))"), `Needs you (${theme})`, 30000);
    // Every seeded kind must have arrived from the bridge before the picture.
    await waitFor(async () => { const t = await mainText(); return t.includes("Release checklist") && t.includes("Fastmail") && t.includes("GitHub login") && t.includes("leads") && t.includes("handoff chain") && t.includes("nightly smoke test"); }, `every seeded row (${theme})`, 30000);
    await delay(400);
    const boundary = (await mainText()).match(/could not render[^\n]{0,200}/i);
    assert.ok(!boundary, `error boundary: ${boundary?.[0]}`);
    await shoot(`${theme}-needs-you`);

    if (!assertions) continue;
    const text = await mainText();
    const headings = await cdp.evaluate("[...document.querySelectorAll('[data-testid=needs-you-list] h2')].map((h) => h.textContent.trim())");
    assert.deepEqual(headings.map((h) => h.replace(/\s*\d+$/, "")), ["Decisions", "Unread", "Work that stopped"], `sections in order: ${JSON.stringify(headings)}`);
    assert.ok(!text.includes("--output-format") && !text.includes("claude -p") && !text.includes("autohand run --prompt"), "no command line on the page");
    assert.ok(!text.includes("Standalone run failed"), "a failed reply is not a standalone run");
    assert.ok(!text.includes("Work to review"), "the old heading is gone");
    const counts = await cdp.evaluate(`(() => {
      const list = document.querySelector('[data-testid=needs-you-list]');
      const n = (kind) => list.querySelectorAll('[data-row-kind="' + kind + '"]').length;
      const badge = document.querySelector('aside [data-testid=needs-you-count]');
      return { decisions: n('decision'), unread: n('unread'), stopped: n('stopped'), badge: badge ? Number(badge.textContent.trim()) : null, retry: [...list.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Retry in chat').length, replay: [...list.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Replay').length, openChat: [...list.querySelectorAll('button, a')].filter((b) => b.textContent.trim() === 'Open chat').length };
    })()`);
    assert.equal(counts.decisions, 6, `six decision rows (approval, secret, payment, folder, handoff, channel proposal): ${JSON.stringify(counts)}`);
    assert.equal(counts.unread, 3, `three unread (Alex's failed reply, Noah's answer, the approval prompt the bridge posted in #ops): ${JSON.stringify(counts)}`);
    assert.equal(counts.stopped, 4, `four stopped rows (blocked task, chat reply, goal, launched run): ${JSON.stringify(counts)}`);
    assert.equal(counts.badge, counts.decisions + counts.unread, `the sidebar count equals decisions plus unread: ${JSON.stringify(counts)}`);
    assert.equal(counts.retry, 1, `one Retry in chat, on the failed chat reply: ${JSON.stringify(counts)}`);
    assert.equal(counts.replay, 1, `one Replay, on the failed launched run: ${JSON.stringify(counts)}`);
    for (const word of ["Approve", "Open secure form", "Decide payment", "Allow or decline", "Review handoff", "Approve channel"]) assert.ok(text.includes(word), `the action word "${word}" is on the page`);
    // Within the list only: the vault form and the channel proposal block above
    // the page mention the same names first.
    const listText = await cdp.evaluate("document.querySelector('[data-testid=needs-you-list]').innerText");
    const order = ["Decisions", "Release checklist", "Fastmail", "leads", "handoff chain", "client-abc", "Unread", "Work that stopped"].map((needle) => listText.indexOf(needle));
    assert.ok(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])), `decisions by kind, then unread, then stopped: ${JSON.stringify(order)}`);
    // The retry opens the conversation at the failed message.
    await cdp.evaluate("[...document.querySelectorAll('[data-testid=needs-you-list] button')].find((b) => b.textContent.trim() === 'Retry in chat').click()");
    await waitFor(async () => cdp.evaluate(`location.pathname === '/conversations/new' && new URLSearchParams(location.search).get('member') === ${JSON.stringify(alex.id)}`), "Retry in chat opens Alex's conversation");
    await delay(1500);
    await shoot(`${theme}-retry-in-chat`);
    await waitFor(async () => /could not answer/i.test(await mainText()), "the failed reply is on screen");
    assert.ok(/\bRetry\b/.test(await mainText()), "the conversation offers Retry on the failed reply");
  }
  const thrown = cdp.events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text || "exception");
  assert.deepEqual(thrown, [], `uncaught exceptions: ${thrown.join(" | ")}`);
  console.log(`Needs you browser check ${assertions ? "passed" : "shot"}: decisions first, no command text, one Retry in chat, one Replay, sidebar count = decisions + unread, in light and dark${shotsDir ? `; screenshots in ${shotsDir}` : ""}.`);
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
