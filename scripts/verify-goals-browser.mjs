import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialAgents, initialTasks, initialMemoryInbox, initialChannels } from "../src/data.js";
import { commandsForHarness, slashCommandFrom } from "../src/lib/composer-syntax.js";

// Browser-only fixture: all API calls are intercepted; no provider or live worker is contacted.
const root = process.cwd();
const appPort = Number(process.env.AUTOHAND_VERIFY_APP_PORT || 19850);
const chromePort = Number(process.env.AUTOHAND_VERIFY_CHROME_PORT || 9250);
const baseUrl = process.env.AUTOHAND_VERIFY_BASE_URL || `http://127.0.0.1:${appPort}`;
const artifacts = process.env.AUTOHAND_VERIFY_ARTIFACTS || "/tmp/autohand-goals-browser";
const quickOnly = process.argv.includes("--quick-only");
const recoveryOnly = process.argv.includes("--chat-recovery-only");
const observerOnly = process.argv.includes("--project-observer-only");
const reportName = observerOnly ? "report-project-observer.json" : recoveryOnly ? "report-chat-recovery.json" : quickOnly ? "report-quick-only.json" : "report.json";
const now = new Date().toISOString();
const agents = ["Eva", "Noah"].map((name, index) => ({
  id: `asq_verify_${name.toLowerCase()}`, name, role: index ? "Frontend engineer" : "QA Engineer", status: "online",
  avatar: index ? "/avatars/birds/kakapo.webp" : "/avatars/birds/kiwi.webp",
  staffId: `verify-${index}`, workspace: root,
  description: index ? "Builds the product interface." : "Reproduces defects and records browser evidence.",
  projects: [{ id: "verify-project", name: "autohandSWE", label: "autohandSWE", path: root, kind: "project" }],
  memory: [], skills: [], permissions: {}, stats: {}, modelAssignment: { mode: "inherit" },
}));
const task = (id, title, status, extra = {}) => ({ id, title, status, agentId: agents[0].id, currentOwnerId: agents[0].id, project: root, summary: title, createdAt: now, updatedAt: now, ...extra });
const tasks = initialTasks.map((item) => ({ ...item, status: "completed", handoffs: [], assignments: [] }));
const memory = initialMemoryInbox.map((item) => ({ ...item, status: "rejected" }));
const channels = [{ id: "channel-browser-goal", name: "browser-goal", memberIds: agents.map((agent) => agent.id), createdAt: now, updatedAt: now }];
const fixtures = { agents, tasks, memory, channels, seedChannelIds: initialChannels.map((channel) => channel.id), removedAgents: initialAgents.map((agent) => agent.id), root, now, recoveryOnly, observerOnly };

function installFixtures(data) {
  const store = (key, value) => localStorage.setItem(`autohandSquad.v1.${key}`, JSON.stringify(value));
  const persist = () => localStorage.setItem("goalsVerify.server", JSON.stringify(window.__goalServer));
  if (!localStorage.getItem("goalsVerify.initialized")) {
    localStorage.clear();
    for (const key of ["agents", "removedAgents", "tasks", "channels"]) store(key, data[key]);
    store("memoryInbox", data.memory);
    store("messages", Object.fromEntries(data.agents.map((agent) => [agent.id, []])));
    if (data.recoveryOnly) {
      const old = new Date(Date.parse(data.now) - 60000).toISOString();
      const recent = new Date(Date.parse(data.now) + 60000).toISOString();
      store("messages", { [data.agents[0].id]: [
        { id: "recovery-user", role: "user", status: "complete", body: "Browser fixture interrupted task", startedAt: old },
        { id: "recovery-stale", role: "agent", status: "loading", body: "Browser fixture inspecting stale request", startedAt: old, activityLabel: "Using a stale tool", progress: { items: [{ id: "inspected", title: "Inspect the interrupted work", status: "completed" }, { id: "pending", title: "Finish interrupted verification", status: "in_progress" }] } },
        { id: "recovery-current", role: "agent", status: "loading", body: "Browser fixture current request survives", startedAt: recent },
        { id: "recovery-unknown", role: "agent", status: "loading", body: "Browser fixture unknown request survives" },
        { id: "recovery-finished", role: "agent", status: "complete", body: "Browser fixture finished request stays complete", startedAt: old },
        { id: "recovery-goal", role: "agent", status: "loading", body: "Browser fixture durable goal survives", goalId: "recovery-durable-goal", startedAt: old },
      ], [data.agents[1].id]: [] });
    }
    store("channelMessages", {}); store("channelThreads", {}); store("agentReads", {});
    store("channelReads", Object.fromEntries(data.seedChannelIds.map((id) => [id, data.now])));
    store("automations", []);
    store("onboarding", { version: 1, status: "skipped", lastStep: "skipped" });
    localStorage.setItem("autohandSquad.v1.sidebarCollapsed", "false");
    localStorage.setItem("goalsVerify.initialized", "true");
  }
  window.__verifyRequests = [];
  window.__goalServer = JSON.parse(localStorage.getItem("goalsVerify.server") || '{"goals":[],"breaks":{}}');
  window.__goalVerify = { observerFixture: data.observerOnly, reply: "Browser fixture ordinary answer.", events: null, ...JSON.parse(localStorage.getItem("goalsVerify.scenario") || "{}") };
  if (window.__goalVerify.badgeFixture) {
    const at = new Date().toISOString();
    store('messages', Object.fromEntries(data.agents.map(agent => [agent.id, [{ id: 'badge-unread-' + agent.id, role: 'agent', body: 'Badge fixture unread ' + agent.name + ' update', status: 'complete', createdAt: at }]])));
    store('agentReads', {});
    store('channelReads', Object.fromEntries([...data.seedChannelIds, ...data.channels.map(channel => channel.id), 'channel-6eb6c6df-afc4-48c4-bac5-b3ceb9fe3e55'].map(id => [id, at])));
  }
  window.__verifyInvokes = [];
  if (window.__goalVerify.nativeNotifications) {
    let callbackId = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: window.__goalVerify.windowLabel || "main" }, currentWebview: { label: window.__goalVerify.windowLabel || "main" } },
      transformCallback: () => ++callbackId,
      unregisterCallback: () => {},
      invoke: async (command, args = {}) => {
        window.__verifyInvokes.push({ command, args });
        if (command === "squad_notification_permission") {
          if (args.request) window.__goalVerify.nativePermission = window.__goalVerify.requestResult || "denied";
          return { permission: window.__goalVerify.nativePermission || "unknown" };
        }
        if (command === "squad_notification_test") return { posted: true, method: "macos-user-notifications", message: "macOS accepted the test notification. Banner display follows your notification settings and Focus mode." };
        if (command === "squad_notification_settings") return null;
        if (command === "squad_set_attention_badge") return { supported: true, count: args.count };
        // Event/window subscriptions in the mocked desktop bridge stay local.
        if (command.includes("listen")) return ++callbackId;
        return {};
      },
    };
  }
  window.__setGoal = (patch) => {
    const goal = window.__goalServer.goals.at(-1);
    Object.assign(goal, patch, { updatedAt: new Date().toISOString() }); persist();
    if (goal.status !== "running") window.__finishGoalStream?.(goal);
  };
  window.__observerMock = JSON.parse(localStorage.getItem('goalsVerify.observerServer') || 'null') || { settings: { observeAssignedProjects: true }, members: [], observations: [], running: true, activeMemberId: null, notices: [{ id: 'observation-browser-fixture', memberId: data.agents[0].id, memberName: data.agents[0].name, project: data.root, title: 'Browser fixture project opportunity', body: 'Browser fixture project opportunity: add an accessible label to the project action.\n\nReview the proposed change before implementation.\n\nEvidence: src/ObserverFixture.jsx:12.', evidence: [{ path: 'src/ObserverFixture.jsx', line: 12 }], createdAt: data.now, source: 'project-observer', status: 'suggested', outcome: 'observed' }] };
  const originalFetch = window.fetch.bind(window);
  const response = (payload) => new Response(JSON.stringify({ success: true, data: payload }), { headers: { "content-type": "application/json" } });
  const sse = (events) => new Response(new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      for (const item of events) {
        if (item.delayMs) await new Promise((resolve) => setTimeout(resolve, item.delayMs));
        controller.enqueue(encoder.encode(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`));
      }
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.origin);
    if (!url.pathname.startsWith("/api/")) return originalFetch(input, options);
    const body = options.body ? JSON.parse(options.body) : null;
    const method = options.method || "GET";
    window.__verifyRequests.push({ path: url.pathname, query: url.search, method, body });
    if (url.pathname === "/api/project-observer" && window.__goalVerify.observerFixture) {
      if (method === 'PUT') { window.__observerMock.settings = { ...window.__observerMock.settings, ...body.settings }; window.__observerMock.members = body.members || []; localStorage.setItem('goalsVerify.observerServer', JSON.stringify(window.__observerMock)); }
      return response(window.__observerMock);
    }
    if (url.pathname === "/api/goals") return response(window.__goalServer.goals.filter((goal) => !url.searchParams.get("agentId") || goal.agentId === url.searchParams.get("agentId")).slice().reverse());
    const control = url.pathname.match(/^\/api\/goals\/([^/]+)\/(pause|resume|cancel)$/);
    if (control) {
      if (window.__goalVerify.controlError) return new Response(JSON.stringify({ success: false, error: "Browser fixture goal control failed" }), { status: 500, headers: { "content-type": "application/json" } });
      const goal = window.__goalServer.goals.find((goal) => goal.id === control[1]);
      if (!goal) return new Response(JSON.stringify({ success: false, error: "No fixture goal" }), { status: 404 });
      Object.assign(goal, { status: { pause: "paused", resume: "running", cancel: "cancelled" }[control[2]], updatedAt: new Date().toISOString() });
      persist(); if (goal.status !== "running") window.__finishGoalStream?.(goal); return response(goal);
    }
    if (url.pathname === "/api/members/breaks") return response(window.__goalServer.breaks);
    const breakMember = url.pathname.match(/^\/api\/members\/([^/]+)\/break$/);
    if (breakMember) {
      window.__goalServer.breaks[breakMember[1]] = { memberId: breakMember[1], onBreak: body.active, breakStartedAt: body.active ? new Date().toISOString() : "", endedAt: body.active ? "" : new Date().toISOString(), reply: "I'm on my break, so I'm not accepting new work or handoffs. Use /break off when you want me back." };
      if (body.active) for (const goal of window.__goalServer.goals) if (goal.agentId === breakMember[1] && goal.status === "running") goal.status = "paused";
      persist(); return response({ agentId: breakMember[1], ...window.__goalServer.breaks[breakMember[1]] });
    }
    if (url.pathname === "/api/chat/stream") {
      if (body.mode === "goal") {
        const goal = { id: `goal-verify-${window.__goalServer.goals.length + 1}`, agentId: body.agentId, prompt: body.prompt, workspace: body.workspace, harness: body.agent.harness?.id || "autohand", status: "running", checklist: [{ id: "inspect", title: "Inspect the browser fixture", status: "completed" }, { id: "implement", title: "Implement the requested change", status: "in_progress" }, { id: "verify", title: "Verify the completed behavior", status: "pending" }], summary: "Working through the browser fixture", latestReply: "", evidence: [], turnCount: 1, maxTurns: 10, maxRuntimeMs: 600000, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), finishedAt: "", pauseReason: "", error: "" };
        window.__goalServer.goals.push(goal); persist();
        return new Response(new ReadableStream({ start(controller) {
          const encoder = new TextEncoder();
          const emit = (event, value) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));
          emit("start", { startedAt: goal.startedAt, workspace: body.workspace });
          emit("goal", goal);
          emit("progress", { items: goal.checklist, summary: goal.summary, outcome: "running" });
          window.__finishGoalStream = (snapshot) => {
            emit("goal", snapshot);
            emit("done", { reply: snapshot.latestReply || `Browser fixture goal ${snapshot.status}.`, goal: snapshot, goalId: snapshot.id, workspace: body.workspace, transport: goal.harness });
            controller.close(); window.__finishGoalStream = null;
          };
        } }), { headers: { "content-type": "text/event-stream" } });
      }
      if (window.__goalVerify.hold) return new Response(new ReadableStream({ start(controller) {
        const encoder = new TextEncoder();
        const emit = (event, value) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));
        const old = new Date(Date.now() - 65000).toISOString();
        emit("start", { startedAt: old, workspace: body.workspace });
        emit("sdk", { type: "plan_update", plan: [{ id: "check", step: "Check existing behavior", status: "completed" }, { id: "repair", step: "Repair the browser fixture", status: "in_progress" }], timestamp: old });
        emit("sdk", { type: "tool_start", tool: { id: "long-tool", name: "Bash", args: { command: "fixture test" }, timestamp: old }, timestamp: old });
        window.__finishOrdinaryStream = () => { emit("done", { reply: "Browser fixture tool finished; verification still pending.", workspace: body.workspace }); controller.close(); };
      } }), { headers: { "content-type": "text/event-stream" } });
      return sse(window.__goalVerify.events || [{ event: "start", data: { startedAt: new Date().toISOString(), workspace: body.workspace } }, { event: "done", data: { reply: window.__goalVerify.reply, workspace: body.workspace, transport: body.agent.harness?.id || "autohand" } }]);
    }
    if (url.pathname === "/api/updates") {
      const available = window.__goalVerify.updateStatus === "available";
      return response({ daemonReachable: true, appVersion: "0.1.5", status: available ? "available" : "never-checked", repository: "autohandai/squad", releasesUrl: "https://github.com/autohandai/squad/releases", fresh: available, snapshot: available ? { success: true, source: "github:autohandai/squad", updateAvailable: true, latestAllowedVersion: "0.1.6", checkedAt: `unix-ms:${Date.now()}`, downloadUrl: "https://github.com/autohandai/squad/releases/download/v0.1.6/autohand-squad-0.1.6-macos-arm64.dmg", downloadName: "autohand-squad-0.1.6-macos-arm64.dmg", downloadSha256: "a".repeat(64) } : null });
    }
    if (url.pathname === "/api/updates/upgrade") return response({ version: "0.1.6", verified: true, opened: true, message: "The verified installer is open. Finish your work, follow the installer instructions, then reopen Autohand Squad to use the upgrade." });
    if (url.pathname === "/api/runtime") { if (window.__goalVerify.runtimeDelayMs) await new Promise(resolve => setTimeout(resolve, window.__goalVerify.runtimeDelayMs)); return response({ available: true, version: "browser-fixture", defaultWorkspace: data.root, workspaceRoot: data.root.split("/").slice(0, -1).join("/"), serverStartedAt: data.now, account: { signedIn: !window.__goalVerify.signedOut, email: window.__goalVerify.signedOut ? "" : "browser@example.test" }, limits: { maxProjectsPerMember: 5 } }); }
    if (url.pathname === "/api/provider-settings") return response({ version: 1, defaultProvider: "openrouter", providers: { openrouter: { id: "openrouter", enabled: true, model: "browser-fixture", apiKeyConfigured: true } }, definitions: [] });
    if (url.pathname === "/api/workspaces") return response([{ name: "autohandSWE", label: "autohandSWE", path: data.root, kind: "project", launchable: true }]);
    if (url.pathname === "/api/members/presence") return response({ presence: Object.fromEntries(data.agents.map((agent) => [agent.id, { state: "idle" }])) });
    if (url.pathname === "/api/runs") return response([]);
    if (url.pathname === "/api/memory-inbox") return response({ items: window.__goalVerify.badgeFixture ? JSON.parse(localStorage.getItem("autohandSquad.v1.memoryInbox")) : data.memory });
    if (url.pathname === "/api/channels") return response({ channels: data.channels, threads: [] });
    if (url.pathname === "/api/workflows") return response({ channels: window.__goalVerify.badgeFixture ? { [data.channels[0].id]: [{ id: 'badge-workflow', name: 'Badge fixture approval', steps: [{ id: 'badge-approval-step', memberId: data.agents[0].id }], runs: [{ id: 'badge-approval-run', status: 'waiting_approval', startedAt: data.now, pendingApproval: { stepId: 'badge-approval-step', requestedAt: data.now } }] }] } : {} });
    if (url.pathname === "/api/workflows/pending") return response({ pending: [] });
    if (url.pathname === "/api/notifications") return response({ items: [] });
    if (url.pathname === "/api/remote/members") return response({ members: [] });
    if (url.pathname === "/api/relay/config") return response({ enabled: false });
    if (url.pathname === "/api/relay/status") return response({ connected: false, configured: false, peers: [] });
    if (url.pathname === "/api/canvases") return response([]);
    if (url.pathname === "/api/harnesses") return response({ harnesses: [], defaultId: "autohand" });
    if (/\/activity$/.test(url.pathname)) return response({ records: [], hasMore: false });
    return response({});
  };
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, label, timeout = 12000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try { last = await fn(); if (last) return last; } catch (error) { last = error.message; }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}; last probe: ${JSON.stringify(last)}`);
}
class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
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

async function main() {
  const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean).find(existsSync);
  assert(chromePath, "Chrome or Chromium must be installed");
  await mkdir(artifacts, { recursive: true });
  const profile = await mkdtemp(join(tmpdir(), "goals-chrome-"));
  const output = [];
  const vite = process.env.AUTOHAND_VERIFY_BASE_URL ? null : spawn("node", ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(appPort), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  vite?.stdout.on("data", (chunk) => output.push(String(chunk)));
  vite?.stderr.on("data", (chunk) => output.push(String(chunk)));
  const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${chromePort}`, "about:blank"], { stdio: "ignore" });
  let cdp;
  const report = { fixtureOnly: true, scope: observerOnly ? "project-observer" : recoveryOnly ? "chat-recovery" : quickOnly ? "quick-chat-signin-attention-native-notifications" : "full", screenshots: [] };
  try {
    await waitFor(async () => (await fetch(baseUrl).catch(() => null))?.ok, "Vite");
    const target = await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json`).then((result) => result.json()).catch(() => []))?.find((item) => item.type === "page"), "Chrome CDP");
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
    cdp = new Cdp(ws);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36 AutohandSquadDesktop/1.0", platform: "MacIntel" });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${installFixtures.toString()})(${JSON.stringify(fixtures)});` });
    const navigate = async (path) => { await cdp.send("Page.navigate", { url: `${baseUrl}${path}` }); await waitFor(() => cdp.evaluate("Boolean(document.querySelector('.app-sidebar') && document.querySelector('main') && !document.body.innerText.includes('Waking the squad'))"), path); };
    const screenshot = async (name) => { await delay(250); const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); const path = join(artifacts, `${name}.png`); await writeFile(path, Buffer.from(shot.data, "base64")); report.screenshots.push(path); };

    for (const harness of ["autohand", "codex", "claude"]) {
      for (const name of ["goal", "break"]) assert(commandsForHarness(harness).some((command) => command.name === name && command.scope === "app"), `${name} is app-owned for ${harness}`);
    }
    assert.deepEqual(slashCommandFrom("/goal Repair the demo\nthen verify it"), { name: "goal", args: "Repair the demo\nthen verify it" });
    assert.deepEqual(slashCommandFrom("/break off"), { name: "break", args: "off" });
    const dmPath = (agent) => `/conversations/new?member=${agent.id}`;
    const bodyText = () => cdp.evaluate("document.body.innerText");
    const submit = async (value) => {
      await cdp.evaluate(`(() => { const field = document.querySelector('textarea'); if (!field) throw new Error('DM textarea absent'); field.focus(); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await delay(150);
      const isQuick = await cdp.evaluate("location.pathname === '/quick-chat'");
      if (isQuick && value.startsWith('/')) { await cdp.evaluate("document.querySelector('form').requestSubmit()"); return; }
      // Main DM command completion is dismissed before Enter. Quick chat's
      // native Escape closes its window, so ordinary messages use Enter and
      // explicit slash commands use the same form submit as its send button.
      if (!isQuick) {
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      }
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    };
    const clickButton = async (label) => {
      await waitFor(() => cdp.evaluate(`Array.from(document.querySelectorAll('button')).some(node => !node.disabled && (node.textContent.trim() === ${JSON.stringify(label)} || node.getAttribute('aria-label') === ${JSON.stringify(label)}))`), `enabled ${label}`);
      await cdp.evaluate(`(() => { const button = Array.from(document.querySelectorAll('button')).find((node) => !node.disabled && (node.textContent.trim() === ${JSON.stringify(label)} || node.getAttribute('aria-label') === ${JSON.stringify(label)})); button.click(); })()`);
    };
    const requests = () => cdp.evaluate("window.__verifyRequests");
    await navigate(dmPath(agents[0]));
    await waitFor(() => cdp.evaluate("Boolean(document.querySelector('textarea'))"), "DM composer");
    await delay(350);
    assert(!(await requests()).some((request) => request.path === "/api/chat/stream" || request.path === "/api/runs" && request.method === "POST"), "Opening the DM must never start work");
    report.noUnpromptedWorker = true;
    await screenshot("dm-before-goal");
    if (observerOnly) {
      await waitFor(() => cdp.evaluate("window.__verifyRequests.some(request => request.path === '/api/project-observer' && request.method === 'PUT' && request.body.settings.observeAssignedProjects === true)"), 'main window publishes enabled observer assignments');
      const registration = await cdp.evaluate("window.__verifyRequests.find(request => request.path === '/api/project-observer' && request.method === 'PUT')?.body");
      assert.equal(registration.members.length, 2);
      assert(registration.members.every(member => member.projects.some(project => project.path === root) && typeof member.profile === 'string' && member.profile.includes(member.name) && member.profile.includes(root)), 'Observer registration preserves assigned project, role profile and member identities');
      const noticeCount = () => cdp.evaluate(`(JSON.parse(localStorage.getItem('autohandSquad.v1.messages'))[${JSON.stringify(agents[0].id)}] || []).filter(message => message.id === 'observation-browser-fixture').length`);
      await waitFor(async () => await noticeCount() === 1 && (await bodyText()).includes('Evidence: src/ObserverFixture.jsx:12'), 'one evidence-backed opportunity appears in its member DM');
      assert.equal(await cdp.evaluate("document.querySelectorAll('article[data-message-id=observation-browser-fixture]').length"), 1);
      await screenshot('observer-evidence-backed-dm');
      await navigate('/work'); await navigate(dmPath(agents[0]));
      await waitFor(async () => await noticeCount() === 1 && await cdp.evaluate("document.querySelectorAll('article[data-message-id=observation-browser-fixture]').length === 1"), 'durable notice remains deduplicated after full navigation reload');
      const notice = await cdp.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.messages'))[${JSON.stringify(agents[0].id)}].find(message => message.id === 'observation-browser-fixture')`);
      assert(notice.projectObservation === true && notice.status === 'complete' && notice.body.includes('Review the proposed change'), 'Observation stays a suggestion rather than claiming work was applied');
      assert(!(await requests()).some(request => request.path === '/api/chat/stream' || request.path === '/api/runs' && request.method === 'POST'), 'Rendering durable observation never launches provider work');
      await navigate('/settings?section=improvement');
      await waitFor(() => cdp.evaluate("document.querySelector('#observe-projects')?.getAttribute('aria-checked') === 'true'"), 'observe assigned projects preference');
      await cdp.evaluate("document.querySelector('#observe-projects').click()");
      await waitFor(() => cdp.evaluate("window.__verifyRequests.some(request => request.path === '/api/project-observer' && request.method === 'PUT' && request.body.settings.observeAssignedProjects === false)"), 'turning observation off reaches server settings');
      assert.equal(await cdp.evaluate("window.__observerMock.settings.observeAssignedProjects"), false);
      await waitFor(async () => (await bodyText()).includes('Project observation is paused'), 'observer preference acknowledges pause');
      await screenshot('observer-settings-paused');
      report.projectObserver = { assignmentsPublished: true, evidenceBackedNoticeOnce: true, deduplicatedAcrossReload: true, remainsSuggestion: true, toggleOffReachesServer: true, noProviderActions: true };
      await writeFile(join(artifacts, reportName), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ passed: true, report: join(artifacts, reportName), screenshots: report.screenshots.length }));
      return;
    }
    if (recoveryOnly) {
      await waitFor(() => cdp.evaluate(`(JSON.parse(localStorage.getItem('autohandSquad.v1.messages'))[${JSON.stringify(agents[0].id)}] || []).find(message => message.id === 'recovery-stale')?.interrupted === true`), "stale ordinary request recovers on bridge restart");
      const messages = await cdp.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.messages'))[${JSON.stringify(agents[0].id)}]`);
      const byId = Object.fromEntries(messages.map((message) => [message.id, message]));
      assert.equal(byId["recovery-stale"].status, "error");
      assert.equal(byId["recovery-stale"].progress.outcome, "interrupted");
      assert.equal(byId["recovery-stale"].progress.items[1].status, "in_progress", "Restart recovery cannot fabricate task completion");
      assert.equal(byId["recovery-stale"].activityLabel, "");
      for (const id of ["recovery-current", "recovery-unknown", "recovery-goal"]) assert.equal(byId[id].status, "loading", `${id} must be preserved`);
      assert.equal(byId["recovery-finished"].status, "complete");
      const staleSelector = 'article[data-message-id="recovery-stale"]';
      await cdp.evaluate(`document.querySelector(${JSON.stringify(staleSelector)}).scrollIntoView({ block: 'start', behavior: 'instant' })`);
      await waitFor(() => cdp.evaluate(`document.querySelector(${JSON.stringify(staleSelector)})?.innerText.includes('This request was interrupted when Squad restarted')`), "rendered interruption is explicit");
      assert(await cdp.evaluate(`Array.from(document.querySelector(${JSON.stringify(staleSelector)}).querySelectorAll('button')).some(button => button.textContent.trim() === 'Retry')`), "Interrupted request offers Retry");
      await screenshot("chat-recovery-interrupted");
      await cdp.evaluate(`Array.from(document.querySelector(${JSON.stringify(staleSelector)}).querySelectorAll('button')).find(button => button.textContent.trim() === 'Retry').click()`);
      await waitFor(() => cdp.evaluate("window.__verifyRequests.some(request => request.path === '/api/chat/stream' && request.body.prompt.includes('Browser fixture interrupted task'))"), "Retry dispatches the original request");
      report.chatRecovery = { staleOrdinaryInterrupted: true, currentUnknownFinishedAndGoalsPreserved: true, incompleteTaskPreserved: true, retryOriginalPrompt: true };
      report.checks = "Bridge restart marks only stale ordinary loading requests interrupted, preserves current/unknown/finished/goal messages and actual task states, and Retry dispatches the original prompt";
      await writeFile(join(artifacts, reportName), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ passed: true, report: join(artifacts, reportName), screenshots: report.screenshots.length }));
      return;
    }
    if (!quickOnly) {
    report.harnesses = [];
    for (const harness of ["autohand", "codex", "claude"]) {
      if (harness !== "autohand") {
        await submit(`/harness ${harness}`);
        await waitFor(() => cdp.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.agents')).find(agent => agent.id === ${JSON.stringify(agents[0].id)}).harness.id === ${JSON.stringify(harness)}`), `${harness} selection`);
      }
      const objective = `Browser fixture ${harness}: repair the demo and verify it`;
      await submit(`/goal ${objective}`);
      await waitFor(() => cdp.evaluate(`window.__verifyRequests.some(request => request.path === '/api/chat/stream' && request.body.mode === 'goal' && request.body.prompt.includes(${JSON.stringify(objective)}))`), `${harness} goal launch`);
      const launch = (await requests()).filter((request) => request.path === "/api/chat/stream").at(-1).body;
      assert.equal(launch.agent.harness?.id || "autohand", harness);
      assert.equal(launch.workspace, root);
      assert(!launch.prompt.startsWith("/goal"), "The harness receives the objective, not an unsupported slash command");
      await waitFor(() => cdp.evaluate("Boolean(document.querySelector('[data-testid=agent-task-checklist]'))"), "live checklist");
      const checklist = await cdp.evaluate("Array.from(document.querySelectorAll('[data-testid=agent-task-checklist]')).at(-1).innerText");
      for (const title of ["Inspect the browser fixture", "Implement the requested change", "Verify the completed behavior"]) assert(checklist.includes(title));
      const lines = await cdp.evaluate("Array.from(document.querySelectorAll('[data-testid=agent-task-checklist]')).at(-1) && Array.from(Array.from(document.querySelectorAll('[data-testid=agent-task-checklist]')).at(-1).querySelectorAll('li')).map(row => ({ status: row.dataset.taskStatus, crossed: Boolean(row.querySelector('.line-through')) }))");
      assert(lines.length === 3 && lines.every((line) => line.crossed === (line.status === "completed")), "Only explicitly completed tasks are crossed out");
      await screenshot(`goal-${harness}-running`);
      if (harness === "autohand") {
        await cdp.evaluate("window.__goalVerify.controlError = true");
        await clickButton("Pause goal");
        await waitFor(async () => (await bodyText()).includes("Browser fixture goal control failed"), "goal control error");
        assert.equal(await cdp.evaluate("window.__goalServer.goals.at(-1).status"), "running", "A failed pause must not falsely pause the goal");
        await cdp.evaluate("window.__goalVerify.controlError = false");
        await clickButton("Pause goal");
      } else await submit("/goal pause");
      await waitFor(() => cdp.evaluate("window.__goalServer.goals.at(-1).status === 'paused'"), "slash pause");
      if (harness === "autohand") await clickButton("Resume goal");
      else await submit("/goal resume");
      await waitFor(() => cdp.evaluate("window.__goalServer.goals.at(-1).status === 'running'"), "slash resume");
      if (harness === "autohand") await clickButton("Cancel goal");
      else await submit("/goal cancel");
      await waitFor(() => cdp.evaluate("window.__goalServer.goals.at(-1).status === 'cancelled'"), "slash cancel");
      report.harnesses.push({ harness, objectiveDispatched: true, completedItemsOnlyCrossed: true, pauseResumeCancel: true });
    }
    await submit("/goal Browser fixture survives navigation");
    await waitFor(() => cdp.evaluate("window.__goalServer.goals.at(-1).prompt.includes('survives navigation')"), "persisted goal launch");
    const durableId = await cdp.evaluate("window.__goalServer.goals.at(-1).id");
    await navigate("/work");
    await navigate(dmPath(agents[0]));
    await waitFor(() => cdp.evaluate("Boolean(document.querySelector('[data-testid=agent-task-checklist]'))"), "reload restored goal checklist");
    assert.equal(await cdp.evaluate("window.__goalServer.goals.at(-1).id"), durableId);
    assert(!(await requests()).some((request) => request.path === "/api/chat/stream"), "Reopening a goal only fetches it; it cannot duplicate a worker");
    await cdp.evaluate("window.__setGoal({ checklist: [{ id: 'inspect', title: 'Inspect the browser fixture', status: 'completed' }, { id: 'implement', title: 'Implement the requested change', status: 'completed' }, { id: 'verify', title: 'Verify the completed behavior', status: 'blocked' }], status: 'blocked', summary: 'Browser fixture needs your test credentials' })");
    await waitFor(async () => (await bodyText()).includes("Browser fixture needs your test credentials"), "polled blocked progress");
    await screenshot("goal-blocked-restored");
    report.durableGoalRehydratedWithoutLaunch = true;
    await submit("/goal status");
    await waitFor(async () => (await bodyText()).toLowerCase().includes("blocked"), "goal status reply");
    await submit("/goal resume");
    await waitFor(() => cdp.evaluate("window.__goalServer.goals.at(-1).status === 'running'"), "blocked goal resume");
    await submit("/break");
    await waitFor(() => cdp.evaluate(`window.__goalServer.breaks[${JSON.stringify(agents[0].id)}]?.onBreak === true && window.__goalServer.goals.at(-1).status === 'paused'`), "break pauses active goal");
    await waitFor(() => cdp.evaluate("Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Resume goal' && button.disabled)"), "on-break resume disabled");
    await screenshot("break-pauses-goal");
    await submit("/break off");
    await waitFor(() => cdp.evaluate(`window.__goalServer.breaks[${JSON.stringify(agents[0].id)}]?.onBreak === false`), "goal member returns from break");
    await waitFor(() => cdp.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.agents')).find(agent => agent.id === ${JSON.stringify(agents[0].id)}).status !== 'paused'`), "returned member persisted locally");
    assert.equal(await cdp.evaluate("window.__goalServer.goals.at(-1).status"), "paused", "Ending a break cannot silently resume persistent work");
    report.breakPausesGoalWithoutAutoResume = true;
    await navigate(dmPath(agents[1]));
    await submit("/break");
    await waitFor(() => cdp.evaluate(`window.__goalServer.breaks[${JSON.stringify(agents[1].id)}]?.onBreak === true`), "break endpoint");
    await submit("Please accept this new work");
    await waitFor(async () => (await bodyText()).includes("I'm on my break"), "break refusal");
    assert(!(await requests()).some((request) => request.path === "/api/chat/stream" && request.body.agentId === agents[1].id), "On-break DM refusal starts no harness");
    await screenshot("break-refuses-dm");
    await navigate(dmPath(agents[0]));
    const tasksBefore = await cdp.evaluate("JSON.parse(localStorage.getItem('autohandSquad.v1.tasks'))");
    await cdp.evaluate("window.__goalVerify.reply = 'Browser fixture source completed its ordinary work.'");
    await submit("@Noah Please review this browser fixture handoff");
    await waitFor(async () => (await bodyText()).includes("Browser fixture source completed"), "source reply after declined mention");
    await waitFor(() => cdp.evaluate(`(JSON.parse(localStorage.getItem('autohandSquad.v1.messages'))[${JSON.stringify(agents[0].id)}] || []).some(message => message.id.startsWith('handoff-declined-') && message.authorName === 'Noah' && message.body.includes("I'm on my break"))`), "receiver refusal is visible to the source");
    await delay(350);
    const afterRequests = await requests();
    assert(!afterRequests.some((request) => request.path === "/api/chat/stream" && request.body.agentId === agents[1].id), "Mention refuses before receiver runtime dispatch");
    const tasksAfter = await cdp.evaluate("JSON.parse(localStorage.getItem('autohandSquad.v1.tasks'))");
    assert(!tasksAfter.some((task) => task.currentOwnerId === agents[1].id && !tasksBefore.some((prior) => prior.id === task.id && prior.currentOwnerId === agents[1].id)), "Declined handoff cannot transfer ownership");
    assert(!tasksAfter.some((task) => (task.handoffs || []).some((handoff) => handoff.toAgentId === agents[1].id && ["accepted", "completed"].includes(handoff.status))), "Refusal cannot become accepted/completed handoff");
    await screenshot("break-refuses-handoff");
    await navigate(dmPath(agents[1]));
    assert.equal(await cdp.evaluate(`window.__goalServer.breaks[${JSON.stringify(agents[1].id)}].onBreak`), true, "Break is durable across navigation");
    await submit("/break off");
    await waitFor(() => cdp.evaluate(`window.__goalServer.breaks[${JSON.stringify(agents[1].id)}]?.onBreak === false`), "return from break");
    await waitFor(() => cdp.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.agents')).find(agent => agent.id === ${JSON.stringify(agents[1].id)}).status !== 'paused'`), "returned receiver persisted locally");
    await submit("Browser fixture back to ordinary work");
    await waitFor(() => cdp.evaluate(`window.__verifyRequests.some(request => request.path === '/api/chat/stream' && request.body.agentId === ${JSON.stringify(agents[1].id)})`), "work resumes only after break off");
    await waitFor(async () => (await bodyText()).includes("Browser fixture ordinary answer"), "ordinary reply complete");
    await cdp.evaluate("window.__goalVerify.hold = true");
    await submit("Browser fixture slow tool execution");
    await waitFor(async () => /still.*(working|running)|tool.*running|running.*tool|(?:using|running) Bash/i.test(await bodyText()), "honest stalled tools label");
    assert(!/no first response|first response yet|still waiting for.*provider/i.test(await bodyText()), "An observed tool is not a missing first provider response");
    const stalled = await cdp.evaluate("Array.from(document.querySelectorAll('[data-testid=agent-task-checklist]')).at(-1)?.innerText");
    assert(stalled?.includes("Repair the browser fixture"), "Native SDK plan_update supplies the checklist");
    await screenshot("ordinary-plan-slow-tool");
    await cdp.evaluate("window.__finishOrdinaryStream(); window.__goalVerify.hold = false");
    await waitFor(async () => (await bodyText()).includes("verification still pending"), "ordinary final summary");
    assert(await cdp.evaluate("Array.from(document.querySelectorAll('[data-testid=agent-task-checklist]')).at(-1).querySelector('[data-task-id=repair]')?.dataset.taskStatus === 'in_progress'"), "Turn ending cannot fabricate completion of pending work");
    report.slowToolHonestyAndFinalIncompletePlan = true;
    report.breakRefusesRuntimeAndOwnership = true;
    assert(!await cdp.evaluate("Boolean(document.querySelector('[data-testid=sidebar-update-notice]'))"), "Unknown update state has no download notice");
    await cdp.evaluate("localStorage.setItem('goalsVerify.scenario', JSON.stringify({ updateStatus: 'available' }))");
    await navigate(dmPath(agents[0]));
    await waitFor(() => cdp.evaluate("Boolean(document.querySelector('[data-testid=sidebar-update-notice]'))"), "available update banner");
    report.banner = await cdp.evaluate("(() => { const notice = document.querySelector('[data-testid=sidebar-update-notice]'); const rect = notice.getBoundingClientRect(); const account = Array.from(document.querySelectorAll('.app-sidebar button')).find(button => button.getAttribute('aria-haspopup') === 'menu'); return { text: notice.innerText, bottom: rect.bottom, accountY: account?.getBoundingClientRect().y }; })()");
    assert(report.banner.bottom <= report.banner.accountY, "Update notice belongs above the account");
    assert(!await cdp.evaluate("Array.from(document.querySelectorAll('.app-sidebar button')).some(button => button.textContent.trim() === 'Check for upgrades')"), "Sidebar uses the contextual download notice");
    await screenshot("sidebar-update-available");
    await clickButton("Download Squad update");
    await waitFor(() => cdp.evaluate("window.__verifyRequests.some(request => request.path === '/api/updates/upgrade' && request.method === 'POST')"), "mock verified download endpoint");
    report.contextualUpdateBanner = true;
    }
    await cdp.evaluate(`(() => { localStorage.setItem('goalsVerify.scenario', JSON.stringify({ runtimeDelayMs: 1200, nativeNotifications: true, windowLabel: 'quick-chat' })); const members = JSON.parse(localStorage.getItem('autohandSquad.v1.agents')); members.find(member => member.id === ${JSON.stringify(agents[1].id)}).avatar = ''; for (let index = 1; index <= 6; index++) members.push({ ...members[0], id: 'asq_verify_extra_' + index, name: 'Guest ' + index, role: 'Browser tester' }); localStorage.setItem('autohandSquad.v1.agents', JSON.stringify(members)); })()`);
    await cdp.send("Network.setUserAgentOverride", { userAgent: "AutohandSquadQuickChat/0.1.5 (macos; aarch64)", platform: "MacIntel" });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 380, height: 520, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: `${baseUrl}/quick-chat?member=${agents[1].id}` });
    await waitFor(async () => (await bodyText()).includes("Connecting to Squad"), "compact bridge connection state");
    report.quickFirstPaint = await cdp.evaluate("({ text: document.body.innerText, portraits: document.querySelectorAll('img').length, connectingLines: (document.body.innerText.match(/Connecting to Squad/g) || []).length })");
    assert(report.quickFirstPaint.portraits === 0 && report.quickFirstPaint.connectingLines === 1 && !report.quickFirstPaint.text.includes('Waking the squad'), "Initial compact connection paint has one line without logo/checklist overlap");
    await waitFor(() => cdp.evaluate("!document.querySelector('#boot')"), "initial static boot exits before steady compact connection");
    report.quickStartup = await cdp.evaluate("({ text: document.body.innerText, spinners: document.querySelectorAll('.animate-spin').length, portraits: document.querySelectorAll('img').length, overflow: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth })");
    assert.equal(report.quickStartup.portraits, 0, "Connecting quick chat does not render the full squad portrait wall");
    assert(report.quickStartup.spinners <= 1 && !report.quickStartup.overflow, "Compact startup has at most one waiting indicator and fits the window");
    assert(!report.quickStartup.text.includes("Waking the squad"), "Compact startup does not repeat the main boot checklist");
    await screenshot("quick-chat-connecting-380x520");
    await waitFor(() => cdp.evaluate("Boolean(document.querySelector('[data-testid=mac-quick-chat] textarea'))"), "quick chat plain composer");
    const selectedPortrait = '[data-testid=quick-chat-member-carousel] button[data-member-id][aria-pressed=true]';
    const selectedMember = () => cdp.evaluate(`document.querySelector(${JSON.stringify(selectedPortrait)})?.dataset.memberId`);
    const visiblePlaceholder = () => cdp.evaluate(`(() => { const svg = document.querySelector(${JSON.stringify(selectedPortrait + ' svg.lucide-circle-user-round')}); const rect = svg?.getBoundingClientRect(); const style = svg && getComputedStyle(svg); return Boolean(rect?.width > 0 && rect?.height > 0 && style.visibility === 'visible' && style.opacity !== '0'); })()`);
    const chooseMember = async (memberId, viaAvatar = false) => {
      await delay(450);
      await waitFor(async () => (await visibleMemberIds()).includes(memberId), "portrait settles inside clipped carousel viewport before clicking");
      const point = await cdp.evaluate(`(() => { const button = document.querySelector('[data-testid=quick-chat-member-carousel] button[data-member-id=${memberId}]'); const rect = ((${viaAvatar} && button.querySelector('img')) || button).getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
      await waitFor(async () => await selectedMember() === memberId, "portrait changes recipient");
    };
    const key = async (keyName, keyCode) => {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: keyName, code: keyName, windowsVirtualKeyCode: keyCode });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code: keyName, windowsVirtualKeyCode: keyCode });
    };
    const visibleMemberIds = () => cdp.evaluate("(() => { const viewport = document.querySelector('[data-testid=quick-chat-member-carousel] [data-slot=carousel-content]').getBoundingClientRect(); return Array.from(document.querySelectorAll('[data-testid=quick-chat-member-carousel] button[data-member-id]')).filter(button => { const rect = button.getBoundingClientRect(); return rect.left >= viewport.left - 1 && rect.right <= viewport.right + 1; }).map(button => button.dataset.memberId); })()");
    assert.equal(await selectedMember(), agents[1].id);
    await waitFor(visiblePlaceholder, "avatarless member uses a painted CircleUser placeholder");
    assert(await cdp.evaluate("document.querySelectorAll('[data-testid=quick-chat-selected-member]').length === 1 && !document.querySelector('[data-testid=quick-chat-member-trigger]')"), "One selected-member line accompanies the visible portrait carousel");
    assert(await cdp.evaluate("Boolean(document.querySelector('[data-testid=quick-chat-composer] textarea[data-slot=input-group-control]')) && document.querySelector('#quick-chat-composer-hint')?.innerText.includes('Enter')"), "Quick composer uses the registry InputGroup and a concise Enter hint");
    assert(await cdp.evaluate("!document.querySelector('header') && !document.querySelector('button[aria-label^=Preview]') && document.querySelector('form').querySelectorAll('button').length === 1"), "Compact chat has no second profile header or composer auxiliary controls");
    report.carousel = await cdp.evaluate("Array.from(document.querySelectorAll('[data-testid=quick-chat-member-carousel] button[data-member-id]')).map(button => { const dot = button.querySelector('[data-presence]'); const rect = dot?.getBoundingClientRect(); return { id: button.dataset.memberId, label: button.getAttribute('aria-label'), selected: button.getAttribute('aria-pressed'), dot: dot?.dataset.presence, dotPainted: rect?.width > 0 && rect?.height > 0 && getComputedStyle(dot).opacity !== '0' }; })");
    assert.equal(report.carousel.length, 8, "Overflow fixture includes eight members");
    assert(report.carousel.every(choice => choice.label.includes(choice.id === agents[0].id ? 'QA Engineer' : choice.id === agents[1].id ? 'Frontend engineer' : 'Browser tester') && choice.dotPainted), "Every portrait exposes role and an always-painted presence dot");
    await waitFor(() => cdp.evaluate("Boolean(document.querySelector('button[aria-label=\"Next squad members\"]'))"), "overflow carousel navigation");
    await screenshot("quick-chat-members-380x520");
    await cdp.evaluate(`document.querySelector(${JSON.stringify(selectedPortrait)}).focus()`);
    await key("End", 35);
    await waitFor(async () => await selectedMember() === 'asq_verify_extra_6' && (await visibleMemberIds()).includes('asq_verify_extra_6'), "End selects and reveals last member");
    assert.equal(await cdp.evaluate("document.activeElement.dataset.memberId"), 'asq_verify_extra_6', "Keyboard selection preserves roving focus");
    await key("Home", 36);
    await waitFor(async () => await selectedMember() === agents[0].id, "Home selects first member");
    await key("ArrowRight", 39);
    await waitFor(async () => await selectedMember() === agents[1].id, "Right selects next member");
    await key("ArrowLeft", 37);
    await waitFor(async () => await selectedMember() === agents[0].id, "Left selects previous member");
    await chooseMember(agents[1].id);
    await delay(400);
    const carouselPoint = await cdp.evaluate("(() => { const rect = document.querySelector('[data-testid=quick-chat-member-carousel] [data-slot=carousel-content]').getBoundingClientRect(); return { start: rect.right - 20, end: rect.left + 20, y: rect.top + rect.height / 2 }; })()");
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: carouselPoint.start, y: carouselPoint.y, button: "left", clickCount: 1 });
    for (let step = 1; step <= 8; step++) { await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: carouselPoint.start + (carouselPoint.end - carouselPoint.start) * step / 8, y: carouselPoint.y, button: "left", buttons: 1 }); await delay(25); }
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: carouselPoint.end, y: carouselPoint.y, button: "left", clickCount: 1 });
    await waitFor(async () => (await visibleMemberIds()).includes('asq_verify_extra_6'), "mouse drag reveals later portraits");
    assert.equal(await selectedMember(), agents[1].id, "Dragging does not accidentally select a portrait");
    await cdp.evaluate(`document.querySelector(${JSON.stringify(selectedPortrait)}).focus()`); await key("Home", 36); await chooseMember(agents[1].id); await delay(400);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: (carouselPoint.start + carouselPoint.end) / 2, y: carouselPoint.y, deltaX: 640, deltaY: 0 });
    await waitFor(async () => (await visibleMemberIds()).includes('asq_verify_extra_6'), "horizontal wheel reveals later portraits");
    assert.equal(await selectedMember(), agents[1].id, "Horizontal scrolling preserves recipient");
    await cdp.evaluate(`document.querySelector(${JSON.stringify(selectedPortrait)}).focus()`); await key("Home", 36); await chooseMember(agents[1].id); await delay(400);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: carouselPoint.start, y: carouselPoint.y }] });
    for (let step = 1; step <= 8; step++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: carouselPoint.start + (carouselPoint.end - carouselPoint.start) * step / 8, y: carouselPoint.y }] }); await delay(25); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await waitFor(async () => (await visibleMemberIds()).includes('asq_verify_extra_6'), "touch swipe reveals later portraits");
    assert.equal(await selectedMember(), agents[1].id, "Touch swiping preserves recipient");
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    Object.assign(report, { carouselMouseDrag: true, carouselTouchSwipe: true, carouselHorizontalWheel: true, carouselRovingKeyboard: true });
    await screenshot("quick-chat-carousel-overflow-380x520");
    await cdp.evaluate(`document.querySelector(${JSON.stringify(selectedPortrait)}).focus()`); await key("Home", 36); await delay(300);
    const setDraft = async (value) => cdp.evaluate(`(() => { const field = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await setDraft("Eva unsent browser fixture draft");
    await chooseMember(agents[1].id);
    assert.equal(await cdp.evaluate("document.querySelector('textarea').value"), "", "Unsent Eva draft stays with Eva");
    await setDraft("Noah unsent browser fixture draft");
    await chooseMember(agents[0].id);
    assert.equal(await cdp.evaluate("document.querySelector('textarea').value"), "Eva unsent browser fixture draft", "Switching away and back preserves the draft");
    await submit("Browser fixture quick carousel sends to Eva");
    await waitFor(() => cdp.evaluate(`window.__verifyRequests.some(request => request.path === '/api/chat/stream' && request.body.agentId === ${JSON.stringify(agents[0].id)} && request.body.prompt.includes('quick carousel sends to Eva'))`), "quick carousel selected Eva payload");
    await chooseMember(agents[1].id);
    assert.equal(await cdp.evaluate("document.querySelector('textarea').value"), "Noah unsent browser fixture draft");
    await waitFor(visiblePlaceholder, "avatarless placeholder remains visibly painted after switching from a loaded photo");
    await submit("Browser fixture quick carousel sends to Noah");
    await waitFor(() => cdp.evaluate(`window.__verifyRequests.some(request => request.path === '/api/chat/stream' && request.body.agentId === ${JSON.stringify(agents[1].id)} && request.body.prompt.includes('quick carousel sends to Noah'))`), "quick carousel selected Noah payload");
    await waitFor(async () => (await bodyText()).includes("Browser fixture ordinary answer"), "quick ordinary answer");
    await submit("/goal Browser fixture quick checklist");
    await waitFor(() => cdp.evaluate("window.__goalServer.goals.at(-1)?.prompt.includes('quick checklist') && document.querySelector('[data-testid=agent-goal-progress]')?.dataset.goalId === window.__goalServer.goals.at(-1)?.id"), "quick goal uses current shared controls");
    const currentGoalArticle = `(() => { const goal = window.__goalServer.goals.at(-1); const message = (JSON.parse(localStorage.getItem('autohandSquad.v1.messages'))[goal.agentId] || []).find(item => item.goalId === goal.id); return message && Array.from(document.querySelectorAll('article[data-message-id]')).find(article => article.dataset.messageId === message.id); })()`;
    await waitFor(() => cdp.evaluate(`Boolean((${currentGoalArticle})?.querySelector('[data-testid=agent-task-checklist]'))`), "current quick goal checklist rendered");
    const quickChronology = await cdp.evaluate(`(() => { const goal = window.__goalServer.goals.at(-1); const messages = JSON.parse(localStorage.getItem('autohandSquad.v1.messages'))[goal.agentId] || []; const user = messages.find(message => message.role === 'user' && message.body.includes('Browser fixture quick checklist')); const userArticle = user && Array.from(document.querySelectorAll('article[data-message-id]')).find(article => article.dataset.messageId === user.id); const agentArticle = (${currentGoalArticle}); return { userBeforeReply: Boolean(userArticle && agentArticle && (userArticle.compareDocumentPosition(agentArticle) & Node.DOCUMENT_POSITION_FOLLOWING)), limit: document.querySelector('[data-testid=agent-goal-progress]')?.innerText }; })()`);
    assert(quickChronology.userBeforeReply, "The user's goal prompt must appear before its corresponding agent checklist/reply");
    assert(quickChronology.limit.includes("10m limit"), "A ten-minute goal cap must display 10m, never 0h");
    await cdp.evaluate(`(${currentGoalArticle}).scrollIntoView({ block: 'start', behavior: 'instant' })`);
    await waitFor(() => cdp.evaluate(`(() => { const article = (${currentGoalArticle}); const list = article?.querySelector('[data-testid=agent-task-checklist]'); const rect = list?.getBoundingClientRect(); const controls = document.querySelector('[data-testid=agent-goal-progress]').getBoundingClientRect(); return rect && rect.top >= controls.bottom && rect.bottom <= document.querySelector('form').getBoundingClientRect().top && controls.top >= 0 && controls.bottom < innerHeight; })()`), "current goal and pinned controls visible above composer");
    report.quickChat = await cdp.evaluate("(() => { const chat = document.querySelector('[data-testid=mac-quick-chat]'); const rect = chat.getBoundingClientRect(); return { width: innerWidth, height: innerHeight, chatHeight: rect.height, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, selected: document.querySelector('[data-testid=quick-chat-member-carousel] button[aria-pressed=true]')?.dataset.memberId }; })()");
    assert.equal(report.quickChat.selected, agents[1].id);
    Object.assign(report.quickChat, { userPromptBeforeGoalReply: true, tenMinuteLimitVisible: true });
    assert(report.quickChat.scrollWidth <= report.quickChat.width && report.quickChat.scrollHeight <= report.quickChat.height, "380x520 quick chat keeps both axes inside the native window");
    assert.equal(report.quickChat.chatHeight, 520);
    assert(await visiblePlaceholder(), "Selected avatarless member keeps a visible CircleUser during goal progress");
    assert(await cdp.evaluate("document.querySelectorAll('[data-testid=mac-quick-chat] .animate-spin').length <= 1"), "Compact goal has one progress spinner without duplicate loading metadata");
    await screenshot("quick-chat-goal-380x520");
    await clickButton("Pause goal");
    await waitFor(() => cdp.evaluate("document.querySelector('[data-testid=agent-goal-progress]')?.dataset.goalStatus === 'paused'"), "quick shared goal pause");
    await screenshot("quick-chat-paused-380x520");
    await submit("/break");
    await waitFor(() => cdp.evaluate(`window.__goalServer.breaks[${JSON.stringify(agents[1].id)}]?.onBreak === true`), "quick selected member break");
    await cdp.send("Page.navigate", { url: `${baseUrl}/quick-chat?member=${agents[1].id}` });
    await waitFor(() => cdp.evaluate("document.querySelector('[data-testid=quick-chat-selected-member]')?.innerText.includes('On a break')"), "explicit on-break choice survives quick reload");
    assert.equal(await selectedMember(), agents[1].id, "An explicit on-break selection must not silently select another member");
    assert(await cdp.evaluate("document.querySelector('[data-testid=quick-chat-member-carousel] button[aria-pressed=true] [data-presence]')?.dataset.presence === 'offline'"), "On-break selected portrait has the grey presence state");
    await screenshot("quick-chat-on-break-380x520");
    await submit("/break off");
    await waitFor(() => cdp.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.agents')).find(agent => agent.id === ${JSON.stringify(agents[1].id)}).status !== 'paused'`), "quick member returns without resuming goal");
    assert(!await cdp.evaluate("window.__verifyInvokes.some(call => call.command === 'squad_set_attention_badge')"), "Exact QuickChat native UA never overwrites main Dock badge");
    report.quickNoBadgeWrites = true;
    await cdp.evaluate(`(() => { const all = JSON.parse(localStorage.getItem('autohandSquad.v1.messages')); all[${JSON.stringify(agents[1].id)}].push({ id: 'quick-interrupted-user', role: 'user', status: 'complete', body: 'Browser fixture compact interrupted request', startedAt: new Date(Date.parse(${JSON.stringify(now)}) - 60000).toISOString() }, { id: 'quick-interrupted-reply', role: 'agent', status: 'loading', body: 'Noah is thinking...', startedAt: new Date(Date.parse(${JSON.stringify(now)}) - 60000).toISOString() }); localStorage.setItem('autohandSquad.v1.messages', JSON.stringify(all)); localStorage.setItem('goalsVerify.scenario', '{}'); })()`);
    await cdp.send("Page.navigate", { url: `${baseUrl}/quick-chat?member=${agents[1].id}` });
    await waitFor(() => cdp.evaluate("document.querySelector('article[data-message-id=quick-interrupted-reply]')?.innerText.includes('Retry')"), "compact interrupted request has inline retry");
    await cdp.evaluate("document.querySelector('article[data-message-id=quick-interrupted-reply]').scrollIntoView({ block: 'end', behavior: 'instant' })");
    report.quickInterrupted = await cdp.evaluate("(() => { const article = document.querySelector('article[data-message-id=quick-interrupted-reply]'); return { text: article.innerText, spinners: article.querySelectorAll('.animate-spin').length, tintedAlert: Boolean(article.querySelector('[role=alert].bg-muted, [role=alert].bg-destructive')), status: JSON.parse(localStorage.getItem('autohandSquad.v1.messages')).asq_verify_noah.find(item => item.id === 'quick-interrupted-reply').status }; })()");
    assert.equal(report.quickInterrupted.status, 'error');
    assert(!report.quickInterrupted.text.includes('Noah is thinking...') && report.quickInterrupted.spinners === 0 && !report.quickInterrupted.tintedAlert, "Interrupted quick chat has no stale thinking placeholder, spinner, or oversized alert card");
    await screenshot("quick-chat-interrupted-380x520");
    assert(!await cdp.evaluate("window.__verifyInvokes.some(call => call.command === 'squad_set_attention_badge')"), "Quick-chat window cannot overwrite the main Dock badge");
    await cdp.send("Network.setUserAgentOverride", { userAgent: "AutohandSquadDesktop/0.1.5 (macos; aarch64)", platform: "MacIntel" });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await cdp.evaluate(`(() => { const at = new Date().toISOString(); localStorage.setItem('goalsVerify.scenario', JSON.stringify({ nativeNotifications: true, badgeFixture: true })); localStorage.setItem('autohandSquad.v1.messages', JSON.stringify({ [${JSON.stringify(agents[0].id)}]: [{ id: 'badge-eva-unread', role: 'agent', body: 'Badge fixture unread Eva update', status: 'complete', createdAt: at }], [${JSON.stringify(agents[1].id)}]: [{ id: 'badge-noah-unread', role: 'agent', body: 'Badge fixture unread Noah update', status: 'complete', createdAt: at }] })); localStorage.setItem('autohandSquad.v1.agentReads', '{}'); localStorage.setItem('autohandSquad.v1.memoryInbox', JSON.stringify([{ id: 'badge-memory', agentId: ${JSON.stringify(agents[0].id)}, ownerAgentId: ${JSON.stringify(agents[0].id)}, status: 'pending', scope: 'project', projectKey: ${JSON.stringify(root)}, projectLabel: 'Badge fixture memory decision', content: 'Preserve unresolved decisions after reading updates.', createdAt: at, updatedAt: at }])); const tasks = JSON.parse(localStorage.getItem('autohandSquad.v1.tasks')); tasks.push({ id: 'badge-blocked-work', title: 'Badge fixture blocked work', status: 'blocked', agentId: ${JSON.stringify(agents[0].id)}, currentOwnerId: ${JSON.stringify(agents[0].id)}, project: ${JSON.stringify(root)}, summary: 'Needs a human decision', createdAt: at, updatedAt: at }); localStorage.setItem('autohandSquad.v1.tasks', JSON.stringify(tasks)); })()`);
    await navigate('/work?view=needs-you');
    const sidebarAttention = () => cdp.evaluate("(() => { const button = Array.from(document.querySelectorAll('.app-sidebar button')).find(item => /^Needs you/.test(item.innerText.trim())); return Number(button?.querySelector('[aria-label$=\" unread\"]')?.getAttribute('aria-label').split(' ')[0] || 0); })()");
    const nativeBadge = () => cdp.evaluate("window.__verifyInvokes.filter(call => call.command === 'squad_set_attention_badge').at(-1)?.args.count");
    await waitFor(async () => await sidebarAttention() >= 7 && (await bodyText()).includes('Badge fixture unread Eva update') && (await bodyText()).includes('Replies') && await nativeBadge() === await sidebarAttention(), 'native badge mirrors positive Needs you count');
    const beforeRead = await sidebarAttention();
    report.attentionBadgeBeforeRead = beforeRead;
    await clickButton('Mark updates read');
    await waitFor(async () => (report.attentionBadgeProbe = { after: await sidebarAttention(), badge: await nativeBadge(), beforeRead }, report.attentionBadgeProbe.after === beforeRead - 2 && report.attentionBadgeProbe.badge === report.attentionBadgeProbe.after), 'reading two conversations lowers badge without removing human decisions');
    const afterRead = await sidebarAttention();
    assert(afterRead >= 3 && (await bodyText()).includes('Badge fixture approval') && (await bodyText()).includes('Badge fixture memory decision') && (await bodyText()).includes('Badge fixture blocked work'), 'Unresolved approval, memory and blocked work remain after updates are read');
    report.attentionBadge = { mockedNativeOnly: true, beforeRead, afterRead, matchesSidebarCount: true, unresolvedDecisionsPreserved: true, quickWindowCannotWrite: report.quickNoBadgeWrites };
    await screenshot('attention-badge-needs-you');
    await cdp.evaluate("localStorage.setItem('goalsVerify.scenario', JSON.stringify({ signedOut: true, nativeNotifications: true }))");
    await cdp.send("Page.navigate", { url: `${baseUrl}/conversations/new?member=${agents[0].id}` });
    await waitFor(() => cdp.evaluate("Boolean(document.querySelector('[data-testid=sign-in-gate]'))"), "signed-out Squad gate");
    await waitFor(async () => await nativeBadge() === 0, 'signed-out account clears the mocked native Dock badge');
    report.attentionBadge.signedOutClears = true;
    report.signInGate = await cdp.evaluate("(() => { const gate = document.querySelector('[data-testid=sign-in-gate]'); const rect = gate.getBoundingClientRect(); const image = gate.querySelector('img'); return { y: rect.y, bottom: rect.bottom, viewportHeight: innerHeight, bodyHeight: document.documentElement.scrollHeight, logo: image?.getAttribute('src'), imageLoaded: image?.complete && image?.naturalWidth > 0, text: gate.innerText }; })()");
    assert(report.signInGate.bottom >= report.signInGate.viewportHeight, "Sign-in gate reaches native viewport bottom without a 28px strip");
    assert(report.signInGate.logo?.includes("autohand-squad") && report.signInGate.imageLoaded, "Sign-in uses loaded Squad brand asset");
    await screenshot("signin-squad-full-height");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 640, height: 700, deviceScaleFactor: 1, mobile: false });
    report.signInGateCompact = await cdp.evaluate("(() => { const rect = document.querySelector('[data-testid=sign-in-gate]').getBoundingClientRect(); return { bottom: rect.bottom, height: innerHeight, width: innerWidth, scrollHeight: document.documentElement.scrollHeight, scrollWidth: document.documentElement.scrollWidth }; })()");
    assert.equal(report.signInGateCompact.bottom, 700);
    assert(report.signInGateCompact.scrollHeight <= 700 && report.signInGateCompact.scrollWidth <= 640, "640x700 sign-in fills the window without overflow");
    await screenshot("signin-squad-640x700");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await cdp.evaluate("localStorage.setItem('goalsVerify.scenario', JSON.stringify({ nativeNotifications: true, nativePermission: 'not-determined', requestResult: 'denied' }))");
    await cdp.send("Network.setUserAgentOverride", { userAgent: "AutohandSquadDesktop/0.1.5 (macos; aarch64)", platform: "MacIntel" });
    await navigate("/settings?section=notifications");
    await waitFor(() => cdp.evaluate("Boolean(document.querySelector('[data-testid=native-notification-permission]'))"), "native notification permission row");
    await clickButton("Enable notifications");
    await waitFor(async () => (await bodyText()).includes("Notifications are off for Autohand Squad"), "denied native permission");
    await clickButton("Open System Settings");
    await waitFor(() => cdp.evaluate("window.__verifyInvokes.some(call => call.command === 'squad_notification_settings')"), "mock native settings command");
    await clickButton("Send test notification");
    await waitFor(async () => (await bodyText()).includes("Allow notifications for Autohand Squad in macOS System Settings first"), "denied test is honest");
    assert(!await cdp.evaluate("window.__verifyInvokes.some(call => call.command === 'squad_notification_test') || window.__verifyRequests.some(request => request.path === '/api/notifications/test')"), "Denied native permission never invokes a test or bridge fallback");
    await screenshot("notification-permission-denied");
    await cdp.evaluate("window.__goalVerify.nativePermission = 'granted'; window.dispatchEvent(new Event('focus'))");
    await waitFor(async () => (await bodyText()).includes("Allowed by macOS"), "permission refresh on focus");
    await clickButton("Send test notification");
    await waitFor(async () => (await bodyText()).includes("macOS accepted the test notification"), "mock native test accepted submission");
    assert(!await cdp.evaluate("window.__verifyRequests.some(request => request.path === '/api/notifications/test')"), "Native notification stays native without fallback");
    const invokes = await cdp.evaluate("window.__verifyInvokes");
    const requestIndex = invokes.findIndex((call) => call.command === "squad_notification_permission" && call.args.request === true);
    assert(requestIndex > 0 && invokes.slice(0, requestIndex).some((call) => call.command === "squad_notification_permission" && call.args.request === false), "Permission is inspected before requesting it");
    report.nativeNotifications = { mockedBridgeOnly: true, permissionFirst: true, denialDoesNotTestOrFallback: true, acceptedSubmissionOnly: true };
    await screenshot("notification-native-submission");
    report.checks = quickOnly
      ? "Quick-chat carousel drag/swipe/wheel/keyboard recipient parity, per-member drafts, avatarless placeholder, single startup indicator, visible current goal checklist and pinned controls, break selection persistence, compact window geometry, main-only Dock attention parity and unresolved decisions, signed-out brand and full-height shell, mocked native notification permission and submission"
      : "App-owned goal/break commands for all harnesses, task completion honesty, goal navigation/polling durability, break refusal without runtime or ownership transfer, contextual update download, quick-chat recipient parity and current-goal visibility, signed-out full-height shell, mocked native notifications";
    await writeFile(join(artifacts, reportName), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, report: join(artifacts, reportName), screenshots: report.screenshots.length }));
  } catch (error) {
    if (cdp) report.requests = await cdp.evaluate("window.__verifyRequests").catch(() => []);
    if (cdp) report.nativeInvokes = await cdp.evaluate("window.__verifyInvokes").catch(() => []);
    if (cdp) report.browserState = await cdp.evaluate("({ route: location.pathname + location.search, focus: document.activeElement?.outerHTML, selectedMember: document.querySelector('[data-testid=quick-chat-member-carousel] button[aria-pressed=true]')?.dataset.memberId, selectedAvatar: document.querySelector('[data-testid=quick-chat-member-carousel] button[aria-pressed=true] [data-slot=avatar]')?.outerHTML })").catch(() => null);
    if (cdp) { report.failure = error.message; report.body = await cdp.evaluate("document.body.innerText").catch(() => "unavailable"); const shot = await cdp.send("Page.captureScreenshot", { format: "png" }).catch(() => null); if (shot) await writeFile(join(artifacts, "failure.png"), Buffer.from(shot.data, "base64")); await writeFile(join(artifacts, reportName), JSON.stringify(report, null, 2)); }
    throw error;
  } finally {
    cdp?.ws.close(); vite?.kill("SIGTERM"); chrome.kill("SIGTERM");
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    if (output.some((line) => /error/i.test(line))) console.error(output.join("").slice(-4000));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
