import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialAgents, initialTasks, initialMemoryInbox, initialChannels } from "../src/data.js";

// Browser-only fixture: no daemon, provider, approval or run is contacted.
const root = process.cwd();
const appPort = Number(process.env.AUTOHAND_VERIFY_APP_PORT || 19849);
const chromePort = Number(process.env.AUTOHAND_VERIFY_CHROME_PORT || 9249);
const baseUrl = process.env.AUTOHAND_VERIFY_BASE_URL || `http://127.0.0.1:${appPort}`;
const artifacts = process.env.AUTOHAND_VERIFY_ARTIFACTS || "/tmp/autohand-work-profile-browser";
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
const tasks = [
  ...initialTasks.map((item) => ({ ...item, status: "completed", handoffs: (item.handoffs || []).map((handoff) => ({ ...handoff, status: "accepted" })), assignments: (item.assignments || []).map((assignment) => ({ ...assignment, status: "completed", failureReason: "" })) })),
  task("verify-blocked", "Browser fixture blocked work", "blocked"),
  task("verify-running", "Browser fixture ongoing work", "running"),
  task("verify-completed", "Browser fixture completed evidence", "completed", { timeline: [{ id: "verify-evidence", type: "evidence.recorded", at: now, content: "Browser fixture evidence remains available", summary: "Browser fixture evidence remains available" }] }),
  task("verify-handoff", "Browser fixture handoff", "handoff-pending", { handoffs: [{ id: "verify-handoff-event", status: "pending", reason: "Review the browser fixture handoff", createdAt: now, sourceAgentId: agents[0].id, targetAgentId: agents[1].id }] }),
];
const memory = [
  ...initialMemoryInbox.map((item) => ({ ...item, status: "rejected" })),
  { id: "verify-memory", agentId: agents[0].id, ownerAgentId: agents[0].id, status: "pending", scope: "project", projectKey: root, projectLabel: "Browser fixture memory", content: "Keep browser evidence with UI changes.", createdAt: now, updatedAt: now },
];
const channels = [{ id: "channel-browser-verify", name: "browser-verify", memberIds: agents.map((agent) => agent.id), createdAt: now, updatedAt: now }];
const channelMessages = { [channels[0].id]: [{ id: "verify-channel-message", channelId: channels[0].id, role: "agent", agentId: agents[1].id, body: "Browser fixture unread channel update", status: "complete", createdAt: now }] };
const workflows = { [channels[0].id]: [{ id: "verify-workflow", name: "Browser fixture approval", steps: [{ id: "verify-approval-step", memberId: agents[0].id }], runs: [{ id: "verify-workflow-run", status: "waiting_approval", startedAt: now, pendingApproval: { stepId: "verify-approval-step", requestedAt: now } }] }] };
const fixtures = { agents, tasks, memory, channels, channelMessages, workflows, seedChannelIds: initialChannels.map((channel) => channel.id), removedAgents: initialAgents.map((agent) => agent.id), root, now };

function installFixtures(data) {
  const store = (key, value) => localStorage.setItem(`autohandSquad.v1.${key}`, JSON.stringify(value));
  if (!localStorage.getItem("workProfileVerify.initialized")) {
    localStorage.clear();
    store("agents", data.agents);
    store("removedAgents", data.removedAgents);
    store("tasks", data.tasks);
    store("memoryInbox", data.memory);
    store("channels", data.channels);
    store("channelMessages", data.channelMessages);
    store("channelThreads", {});
    store("channelReads", Object.fromEntries(data.seedChannelIds.map((id) => [id, data.now])));
    store("agentReads", {});
    store("messages", Object.fromEntries(data.agents.map((agent) => [agent.id, [{ id: `reply-${agent.id}`, role: "agent", body: `Browser fixture reply from ${agent.name}`, status: "complete", createdAt: data.now }]])));
    store("automations", []);
    store("onboarding", { version: 1, status: "skipped", lastStep: "skipped" });
    localStorage.setItem("autohandSquad.v1.sidebarCollapsed", "false");
    localStorage.setItem("workProfileVerify.initialized", "true");
  }
  window.__verifyRequests = [];
  window.__updateVerify = JSON.parse(localStorage.getItem("workProfileVerify.updateScenario") || '{"status":"never-checked"}');
  window.__appInfoVerify = JSON.parse(localStorage.getItem("workProfileVerify.appInfoScenario") || '{}');
  window.__computerVerify = JSON.parse(localStorage.getItem("workProfileVerify.computerScenario") || '{}');
  window.__computerCalls = [];
  if (window.__computerVerify.native) window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
    window.__computerCalls.push({ command, args });
    if (command === "squad_setup_computer_use") return { opened: true };
    if (command === "squad_confirm_computer_use") {
      if (window.__computerVerify.cancel) return { confirmed: false };
      window.__computerVerify.scope = args.scope;
      return { confirmed: true, data: { scope: args.scope } };
    }
    if (command === "squad_revoke_computer_use") { window.__computerVerify.scope = "none"; return { revoked: true, data: { scope: "none" } }; }
    return {};
  } };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => {
    if (window.__appInfoVerify.clipboardError) throw new Error("Clipboard unavailable");
    window.__appInfoCopiedChecksum = value;
  } } });
  window.__verifyPresence = { [data.agents[0].id]: { state: "idle", sessionIdleMs: 60000 }, [data.agents[1].id]: { state: "online" } };
  const originalFetch = window.fetch.bind(window);
  const response = (payload) => new Response(JSON.stringify({ success: true, data: payload }), { headers: { "content-type": "application/json" } });
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.origin);
    if (!url.pathname.startsWith("/api/")) return originalFetch(input, options);
    window.__verifyRequests.push({ path: url.pathname, query: url.search, method: options.method || "GET" });
    const computerFile = (session, name) => ({ name, size: 68, mediaType: "image/png", url: `/api/computer-use/evidence/${session}/${name}` });
    if (/^\/api\/computer-use\/evidence\//.test(url.pathname)) return new Response(Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), character => character.charCodeAt(0)), { headers: { "content-type": "image/png" } });
    if (url.pathname === "/api/computer-use/status") return response({ available: window.__computerVerify.available !== false, accessibility: window.__computerVerify.os === true, screenRecording: window.__computerVerify.os === true, grant: { scope: window.__computerVerify.scope || "none" } });
    if (url.pathname === "/api/computer-use/evidence") return response({ sessions: [
      { id: "verify-screen", memberId: data.agents[0].id, runId: "verify-desktop-run", files: [computerFile("verify-screen", "click.png"), computerFile("verify-screen", "after.png")] },
      { id: "other-screen", memberId: data.agents[1].id, files: [computerFile("other-screen", "unrelated.png")] },
    ] });
    if (url.pathname === "/api/chat/stream" && window.__computerVerify.stream) {
      const encoder = new TextEncoder();
      const computerUse = { sessionId: "verify-screen", runId: "verify-desktop-run", files: [computerFile("verify-screen", "click.png")] };
      return new Response(new ReadableStream({ start(controller) {
        const send = (event, payload) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        send("sdk", { type: "message_delta", delta: "Checking the desktop fixture." });
        send("computer-use", computerUse);
        window.setTimeout(() => { send("done", { reply: "Completed the desktop fixture. Screenshot attached.", computerUse }); controller.close(); }, 4000);
      } }), { headers: { "content-type": "text/event-stream" } });
    }
    if (url.pathname === "/api/app-info") {
      const scenario = window.__appInfoVerify;
      if (scenario.error) return new Response(JSON.stringify({ success: false, error: "Browser fixture app information unavailable" }), { status: 500, headers: { "content-type": "application/json" } });
      return response({ version: "0.1.5", commitHash: "b".repeat(40), dirty: true, builtAt: "2026-10-01T03:00:00.000Z", metadataSource: "bundled", appExecutableSha256: scenario.noChecksum ? null : "c".repeat(64), appExecutableName: scenario.noChecksum ? null : "Autohand Squad", changelog: "# Changelog\n\nBrowser fixture shipped profile improvements.\n\n## 0.1.5\n\n- Browser fixture release evidence.", security: "# Security policy\n\nBrowser fixture disclosure policy.", license: "MIT License\n\nBrowser fixture project license notice.", thirdPartyLicenses: [{ ecosystem: "npm", name: "browser-fixture-react", version: "19.0.0", license: "MIT", text: "Browser fixture permission notice for React.", repository: "https://github.com/facebook/react", note: null }, { ecosystem: "cargo", name: "browser-fixture-runtime", version: "1.0.0", license: "Apache-2.0", text: "", repository: null, note: "Browser fixture license text was not staged." }], licenseCoverage: ["Browser fixture coverage includes staged dependencies; missing notices are identified explicitly."] });
    }
    if (url.pathname === "/api/updates") {
      const scenario = window.__updateVerify;
      if (scenario.checkDelayMs && url.searchParams.has("refresh")) await new Promise((resolve) => setTimeout(resolve, scenario.checkDelayMs));
      const status = scenario.status || "never-checked";
      return response({ daemonReachable: status !== "offline", appVersion: scenario.preview ? "0.1.6" : "0.1.5", status, checkError: status === "check-failed" ? "Browser fixture GitHub check failed" : "", fresh: ["available", "up-to-date"].includes(status), repository: "autohandai/squad", releasesUrl: "https://github.com/autohandai/squad/releases", snapshot: status === "never-checked" ? null : { success: ["available", "up-to-date"].includes(status), checkedAt: `unix-ms:${Date.parse(data.now)}`, source: "github:autohandai/squad", updateAvailable: status === "available", latestAllowedVersion: status === "up-to-date" ? "0.1.5" : "0.1.6", downloadUrl: "https://github.com/autohandai/squad/releases/download/v0.1.6/autohand-squad-0.1.6-macos-arm64.dmg", downloadName: "autohand-squad-0.1.6-macos-arm64.dmg", downloadSha256: "a".repeat(64), notes: "Browser fixture release notes.", channel: "stable" } });
    }
    window.__updateOperation ||= JSON.parse(localStorage.getItem("workProfileVerify.operation") || '{"phase":"idle"}');
    const saveOperation = value => { window.__updateOperation=value; localStorage.setItem("workProfileVerify.operation",JSON.stringify(value)); return value; };
    if (url.pathname === "/api/updates/progress") return response(window.__updateOperation);
    if (url.pathname === "/api/updates/upgrade") {
      const scenario=window.__updateVerify;
      const generation=window.__updateGeneration=(window.__updateGeneration||0)+1;
      saveOperation({phase:"checking",bytes:0,totalBytes:null});
      setTimeout(()=>{if(window.__updateGeneration===generation) saveOperation({phase:"downloading",version:"0.1.6",bytes:25,totalBytes:scenario.unknownSize?null:100});},20);
      setTimeout(()=>{if(window.__updateGeneration===generation) saveOperation(scenario.upgradeError?{phase:"failed",error:scenario.upgradeError}:{phase:"ready",version:"0.1.6",verified:true,bytes:100,totalBytes:100,installMode:scenario.nativeRestart?"restart":"installer"});},scenario.upgradeDelayMs || 2000);
      return response(window.__updateOperation);
    }
    if (url.pathname === "/api/updates/cancel") { window.__updateGeneration++; return response(saveOperation({phase:"cancelled"})); }
    if (url.pathname === "/api/updates/install") {
      if(window.__updateVerify.installError) return new Response(JSON.stringify({success:false,error:window.__updateVerify.installError}),{status:409,headers:{"content-type":"application/json"}});
      return response(saveOperation({...window.__updateOperation,phase:"installer-open",message:"The system installer is open. Follow its instructions, then reopen Squad."}));
    }
    if (url.pathname === "/api/updates/releases") return response({ opened: true, url: "https://github.com/autohandai/squad/releases" });
    if (url.pathname === "/api/runtime") return response({ available: true, version: "browser-fixture", defaultWorkspace: data.root, workspaceRoot: data.root.split("/").slice(0, -1).join("/"), serverStartedAt: data.now, account: { signedIn: true, email: "browser@example.test" }, limits: { maxProjectsPerMember: 5 } });
    if (url.pathname === "/api/provider-settings") return response({ version: 1, defaultProvider: "openrouter", providers: { openrouter: { id: "openrouter", enabled: true, model: "browser-fixture", apiKeyConfigured: true } }, definitions: [] });
    if (url.pathname === "/api/workspaces") return response([{ name: "autohandSWE", label: "autohandSWE", path: data.root, kind: "project", launchable: true }]);
    if (url.pathname === "/api/members/presence") return response({ presence: window.__verifyPresence });
    if (url.pathname === "/api/runs") return response([]);
    if (url.pathname === "/api/memory-inbox") return response({ items: data.memory });
    if (url.pathname === "/api/channels") return response({ channels: data.channels, threads: [] });
    if (url.pathname === "/api/workflows") return response({ channels: data.workflows });
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
  const profile = await mkdtemp(join(tmpdir(), "work-profile-chrome-"));
  const output = [];
  const vite = process.env.AUTOHAND_VERIFY_BASE_URL ? null : spawn("node", ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(appPort), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  vite?.stdout.on("data", (chunk) => output.push(String(chunk)));
  vite?.stderr.on("data", (chunk) => output.push(String(chunk)));
  const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${chromePort}`, "about:blank"], { stdio: "ignore" });
  let cdp;
  const report = { fixtureOnly: true, screenshots: [] };
  try {
    await waitFor(async () => (await fetch(baseUrl).catch(() => null))?.ok, "Vite");
    const target = await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json`).then((result) => result.json()).catch(() => []))?.find((item) => item.type === "page"), "Chrome CDP");
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
    cdp = new Cdp(ws);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    // Image elements bypass window.fetch, so serve their actual fixture bytes
    // through Chrome's network boundary too. No native screenshot is captured.
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method !== "Fetch.requestPaused") return;
      void cdp.send("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "image/png" }], body: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" }).catch(() => {});
    });
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/computer-use/evidence/*.png", requestStage: "Request" }] });
    await cdp.send("Network.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36 AutohandSquadDesktop/1.0", platform: "MacIntel" });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${installFixtures.toString()})(${JSON.stringify(fixtures)});` });
    const navigate = async (path) => { await cdp.send("Page.navigate", { url: `${baseUrl}${path}` }); await waitFor(() => cdp.evaluate("Boolean(document.querySelector('main') && !document.body.innerText.includes('Waking the squad'))"), path); };
    const screenshot = async (name) => { await delay(250); const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); const path = join(artifacts, `${name}.png`); await writeFile(path, Buffer.from(shot.data, "base64")); report.screenshots.push(path); };
    const geometry = () => cdp.evaluate(`(() => { const sidebar = document.querySelector('.app-sidebar'); const image = sidebar?.querySelector('img'); const rect = image?.getBoundingClientRect(); return { shell: document.documentElement.dataset.shell, platform: document.documentElement.dataset.platform, x: rect?.x, y: rect?.y, width: rect?.width, height: rect?.height, paddingTop: getComputedStyle(sidebar).paddingTop, headerHeight: sidebar?.querySelector('[data-tauri-drag-region]')?.getBoundingClientRect().height, clipped: rect ? rect.y < sidebar.getBoundingClientRect().y : true }; })()`);
    if (!process.env.AUTOHAND_VERIFY_UPDATES_ONLY) {
    await navigate(`/conversations/new?member=${agents[0].id}`);
    await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('button[aria-label="Preview Eva\\'s profile"]'))`), "Eva DM trigger");
    report.normalLogo = await geometry();
    assert.equal(report.normalLogo.shell, "desktop"); assert.equal(report.normalLogo.platform, "mac"); assert(!report.normalLogo.clipped);
    await screenshot("dm-normal");
    const triggerSelector = `button[aria-label="Preview Eva's profile"]`;
    const openAt = async (childSelector) => {
      const rect = await cdp.evaluate(`(() => { const node = document.querySelector(${JSON.stringify(triggerSelector)}).querySelector(${JSON.stringify(childSelector)}); const rect = node.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...rect });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...rect });
      await waitFor(() => cdp.evaluate("Boolean(document.querySelector('[data-slot=popover-content]'))"), "anchored profile preview");
    };
    await openAt('[data-slot="avatar"]');
    report.preview = await cdp.evaluate(`(() => { const popover = document.querySelector('[data-slot=popover-content]'); const rect = popover.getBoundingClientRect(); const anchor = document.querySelector(${JSON.stringify(triggerSelector)}).getBoundingClientRect(); return { text: popover.innerText, x: rect.x, y: rect.y, width: rect.width, height: rect.height, anchor: { x: anchor.x, y: anchor.y, bottom: anchor.bottom }, route: location.pathname }; })()`);
    for (const text of ["Eva", "QA Engineer", "Idle", "Reproduces defects", "Workspace", "Model", "Runs with", "View profile"]) assert(report.preview.text.toLowerCase().includes(text.toLowerCase()), `Preview must contain ${text}`);
    assert(Math.abs(report.preview.x - report.preview.anchor.x) < 20, "Preview must be anchored by the member");
    assert(report.preview.y >= report.preview.anchor.bottom, "Preview must open below the member");
    assert.equal(report.preview.route, "/conversations/new");
    await screenshot("dm-profile-preview");
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await waitFor(() => cdp.evaluate(`!document.querySelector('[data-slot=popover-content]') && document.activeElement === document.querySelector(${JSON.stringify(triggerSelector)})`), "Escape closes preview and restores focus");
    report.escapeRestoresFocus = true;
    await openAt('span > span');
    await cdp.evaluate(`window.__verifyPresence[${JSON.stringify(agents[0].id)}] = { state: 'working', activeRuns: 2 }`);
    await waitFor(() => cdp.evaluate("document.querySelector('[data-slot=popover-content]')?.innerText.includes('Working')"), "live status changes within open preview", 14000);
    report.livePresenceUpdatesInOpenCard = true;
    await cdp.evaluate("Array.from(document.querySelector('[data-slot=popover-content]').querySelectorAll('button')).find(button => button.textContent.includes('View profile')).click()");
    await waitFor(() => cdp.evaluate(`location.pathname === '/squad-members/${agents[0].id}/home' && document.querySelector('.app-sidebar')?.innerText.includes('Back to chat')`), "View profile navigation");
    report.profileLogo = await geometry();
    assert.equal(report.profileLogo.y, report.normalLogo.y, "Profile logo must align with normal sidebar logo");
    assert.equal(report.profileLogo.width, report.normalLogo.width, "Profile and normal logo sizes must match");
    assert.equal(report.profileLogo.paddingTop, report.normalLogo.paddingTop, "Profile must retain native traffic light inset");
    assert(!report.profileLogo.clipped);
    await screenshot("profile-normal");
    await cdp.evaluate("Array.from(document.querySelector('.app-sidebar').querySelectorAll('button')).find(button => /Collapse sidebar/.test(button.getAttribute('aria-label') || '')).click()");
    await waitFor(() => cdp.evaluate("document.querySelector('.app-sidebar')?.getBoundingClientRect().width < 100"), "collapsed profile sidebar");
    report.collapsedProfileLogo = await geometry(); assert(!report.collapsedProfileLogo.clipped);
    await screenshot("profile-collapsed");
    await navigate(`/conversations/new?member=${agents[0].id}`);
    report.collapsedNormalLogo = await geometry();
    assert.equal(report.collapsedNormalLogo.y, report.collapsedProfileLogo.y, "Collapsed profile/normal logo alignment");
    assert.equal(report.collapsedNormalLogo.paddingTop, report.collapsedProfileLogo.paddingTop, "Collapsed native inset");
    await cdp.evaluate("localStorage.setItem('autohandSquad.v1.sidebarCollapsed', 'false'); localStorage.setItem('autohandSquad.v1.agentReads', '{}'); localStorage.setItem('autohandSquad.v1.channelReads', JSON.stringify(Object.fromEntries(JSON.parse(localStorage.getItem('autohandSquad.v1.channels')).filter(channel => channel.id !== 'channel-browser-verify').map(channel => [channel.id, new Date().toISOString()]))))");
    await navigate("/work");
    await waitFor(() => cdp.evaluate("Boolean(document.querySelector('[data-testid=needs-you-list]'))"), "combined Needs you");
    // Remaining combined-view assertions are deliberately DOM based; filters,
    // counts and history should be proved as a person sees them.
    report.workInitial = await cdp.evaluate("({ text: document.querySelector('main').innerText, sidebar: document.querySelector('aside').innerText, route: location.pathname + location.search })");
    // ADR-0121: decisions (approval, handoff, memory) first, then unread (two
    // replies and one channel), then the blocked work; the sentence counts
    // what the page lists and the badge is decisions plus unread.
    // innerText carries the CSS uppercase of the kind labels.
    for (const heading of ["Decisions", "APPROVALS", "HANDOFFS", "MEMORY PROPOSALS", "Unread", "Work that stopped"]) assert(report.workInitial.text.includes(heading), `Combined view contains ${heading}`);
    assert(report.workInitial.text.includes("3 decisions · 3 unread · 1 stopped"), `The sentence counts decisions, unread and stopped: ${report.workInitial.text.split("\n").slice(0, 4).join(" | ")}`);
    assert(report.workInitial.sidebar.includes("6"), "The sidebar badge is decisions plus unread");
    assert(!report.workInitial.sidebar.split("\n").some((line) => line === "Inbox" || line === "Work"), "One sidebar destination replaces Inbox and Work");
    assert(!report.workInitial.text.includes("Browser fixture ongoing work"), "Running work belongs to In progress");
    assert(!report.workInitial.text.includes("Browser fixture completed evidence"), "Completed evidence belongs to All work");
    assert(!report.workInitial.text.includes("Task Record"), "No unselected record panel consumes attention view space");
    await screenshot("needs-you");
    await cdp.evaluate("Array.from(document.querySelector('main').querySelectorAll('button')).find(button => button.textContent.trim() === 'Mark updates read').click()");
    await waitFor(() => cdp.evaluate("document.querySelector('main').innerText.includes('3 decisions · 1 stopped')"), "read updates retain the three unresolved decisions and the stopped work");
    report.afterMarkRead = await cdp.evaluate("document.querySelector('main').innerText");
    for (const title of ["Browser fixture approval", "Browser fixture handoff", "Browser fixture blocked work", "Browser fixture memory"]) assert(report.afterMarkRead.includes(title), `Reading updates preserves ${title}`);
    for (const title of ["Browser fixture reply", "Browser fixture unread channel update", "Mark updates read"]) assert(!report.afterMarkRead.includes(title), `Reading updates clears ${title}`);
    await screenshot("needs-you-updates-read");
    await cdp.evaluate("Array.from(document.querySelector('[data-testid=needs-you-list]').querySelectorAll('button')).find(button => button.textContent.includes('Browser fixture approval')).click()");
    await waitFor(() => cdp.evaluate("location.pathname === '/channels/channel-browser-verify'"), "approval opens owning channel");
    report.approvalOpensChannel = true;
    await navigate("/work?view=needs-you");
    await cdp.evaluate("Array.from(document.querySelector('[data-testid=needs-you-list]').querySelectorAll('button')).find(button => button.textContent.includes('Browser fixture handoff')).click()");
    await waitFor(() => cdp.evaluate("new URLSearchParams(location.search).get('task') === 'verify-handoff' && document.querySelector('main').innerText.includes('verify-handoff')"), "handoff opens its own task record");
    report.handoffOpensTask = true;
    await navigate("/work?view=needs-you");
    const clickView = async (label) => {
      await cdp.evaluate(`Array.from(document.querySelector('[aria-label="Work view"]').querySelectorAll('button')).find(button => button.textContent.trim().startsWith(${JSON.stringify(label)})).click()`);
      await waitFor(() => cdp.evaluate(`Array.from(document.querySelector('[aria-label="Work view"]').querySelectorAll('button')).some(button => button.textContent.trim().startsWith(${JSON.stringify(label)}) && button.getAttribute('aria-pressed') === 'true')`), `${label} selected`);
    };
    await clickView("In progress");
    report.inProgress = await cdp.evaluate("({ text: document.querySelector('main').innerText, route: location.pathname + location.search })");
    assert(report.inProgress.text.includes("Browser fixture ongoing work"));
    assert(!report.inProgress.text.includes("Browser fixture blocked work"));
    assert(!report.inProgress.text.includes("Browser fixture completed evidence"));
    assert(!report.inProgress.text.includes("Some checks fail") && !report.inProgress.text.includes("Checks incomplete"), "In progress evaluation counts exclude completed task outcomes");
    assert(!report.inProgress.text.includes("Context Layers"), "In progress waits for explicit record selection");
    assert(report.inProgress.route.includes("view=in-progress"));
    await screenshot("in-progress");
    await clickView("All work");
    report.allWork = await cdp.evaluate("({ text: document.querySelector('main').innerText, route: location.pathname + location.search })");
    for (const title of ["Browser fixture ongoing work", "Browser fixture blocked work", "Browser fixture completed evidence"]) assert(report.allWork.text.includes(title));
    await screenshot("all-work");
    await cdp.evaluate("history.back()");
    await waitFor(() => cdp.evaluate("location.search.includes('view=in-progress') && document.querySelector('main').innerText.includes('Browser fixture ongoing work') && !document.querySelector('main').innerText.includes('Browser fixture completed evidence')"), "browser Back restores In progress filter");
    report.historyRestoresFilter = true;
    await navigate("/work?task=verify-completed");
    await waitFor(() => cdp.evaluate("document.querySelector('main').innerText.includes('Browser fixture evidence remains available')"), "completed task evidence deep link");
    report.completedEvidenceDeepLink = true;
    await screenshot("completed-task-evidence");
    await navigate("/inbox");
    await waitFor(() => cdp.evaluate("Boolean(document.querySelector('[data-testid=needs-you-list]'))"), "legacy Inbox opens Needs you");
    report.legacyInbox = true;
    await navigate("/mission-control");
    await waitFor(() => cdp.evaluate("document.querySelector('main').innerText.includes('Browser fixture completed evidence')"), "legacy mission control opens All work");
    report.legacyMissionControl = true;
    report.skinLogoAlignment = [];
    for (const skin of ["default", "soft", "grut"]) {
      await cdp.evaluate(`localStorage.setItem('autohandSquad.v1.skin', ${JSON.stringify(skin)}); localStorage.setItem('autohandSquad.v1.theme', JSON.stringify({ mode: 'dark' }))`);
      await navigate(`/conversations/new?member=${agents[0].id}`);
      const normal = await geometry();
      await navigate(`/squad-members/${agents[0].id}/home`);
      const profile = await geometry();
      assert.equal(normal.y, profile.y, `${skin} normal/profile logo y`);
      assert.equal(normal.width, profile.width, `${skin} normal/profile logo size`);
      assert.equal(normal.paddingTop, profile.paddingTop, `${skin} native inset`);
      assert(!profile.clipped, `${skin} profile logo is visible`);
      report.skinLogoAlignment.push({ skin, normal, profile });
      await screenshot(`profile-${skin}-dark`);
    }
    report.responsive = [];
    await cdp.evaluate("localStorage.setItem('autohandSquad.v1.skin', 'default')");
    for (const mode of ["dark", "light"]) {
      await cdp.evaluate(`localStorage.setItem('autohandSquad.v1.theme', JSON.stringify({ mode: ${JSON.stringify(mode)} }))`);
      for (const width of [390, 768]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 960, deviceScaleFactor: 1, mobile: false });
        // Mobile hides the desktop sidebar. Navigate and wait for the actual
        // work filters rather than the desktop-only root used above.
        await cdp.send("Page.navigate", { url: `${baseUrl}/work?view=needs-you` });
        await waitFor(() => cdp.evaluate("Boolean(document.querySelector('[aria-label=\"Work view\"]') && !document.body.innerText.includes('Waking the squad'))"), `${mode} ${width} Needs you`);
        const work = await cdp.evaluate("({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, theme: document.documentElement.className })");
        assert(work.scrollWidth <= width && work.bodyScrollWidth <= width, `No horizontal overflow in ${mode} ${width} Needs you`);
        await screenshot(`needs-you-${mode}-${width}`);
        await cdp.send("Page.navigate", { url: `${baseUrl}/conversations/new?member=${agents[0].id}` });
        await waitFor(() => cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(triggerSelector)}) && !document.body.innerText.includes('Waking the squad'))`), `${mode} ${width} DM`);
        await openAt('[data-slot="avatar"]');
        const preview = await cdp.evaluate("(() => { const rect = document.querySelector('[data-slot=popover-content]').getBoundingClientRect(); return { x: rect.x, right: rect.right, viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth }; })()");
        assert(preview.x >= 0 && preview.right <= width && preview.scrollWidth <= width, `Preview fits ${mode} ${width}`);
        await screenshot(`profile-preview-${mode}-${width}`);
        report.responsive.push({ mode, width, work, preview });
      }
    }
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    }
    await navigate("/settings/updates");
    report.updater = { statuses: [], mockedInstallerOnly: true };
    const updaterText = () => cdp.evaluate("document.querySelector('#settings-updates')?.innerText || ''");
    const updaterButton = async (label) => cdp.evaluate(`Array.from(document.querySelector('#settings-updates').querySelectorAll('button')).find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`);
    for (const [status, title] of [["never-checked","Not checked yet"],["offline","Update service is offline"],["check-failed","Could not check for updates"],["up-to-date","You're up to date"],["available","Version 0.1.6 is available"]]) {
      await cdp.evaluate(`localStorage.setItem('workProfileVerify.operation','{"phase":"idle"}'); localStorage.setItem('workProfileVerify.updateScenario',JSON.stringify({status:${JSON.stringify(status)}}))`);
      await navigate('/settings/updates');
      await waitFor(async()=> (await updaterText()).includes(title),`update ${status}`);
      if(status!=='up-to-date') assert(!(await updaterText()).includes("You're up to date"));
      await screenshot(`update-${status}`); report.updater.statuses.push(status);
    }
    await cdp.evaluate("localStorage.setItem('workProfileVerify.updateScenario',JSON.stringify({status:'up-to-date',preview:true}))");
    await navigate('/settings/updates'); await waitFor(async()=>(await updaterText()).includes('You’re running a preview'),'local preview identity');
    assert((await updaterText()).includes('0.1.6') && (await updaterText()).includes('0.1.5')); await screenshot('update-preview');
    await cdp.evaluate("localStorage.setItem('workProfileVerify.updateScenario',JSON.stringify({status:'available'}))");
    await navigate('/settings/updates'); await waitFor(async()=>(await updaterText()).includes('Download update'),'download action');
    await cdp.evaluate("window.__updateVerify.checkDelayMs=1000"); await updaterButton('Check for updates');
    await waitFor(async()=>(await updaterText()).includes('Checking for updates'),'manual check busy');
    await waitFor(async()=>(await updaterText()).includes('Version 0.1.6 is available'),'manual check finished');
    await updaterButton('Download update');
    await waitFor(()=>cdp.evaluate("document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')==='25'"),'actual 25 percent');
    assert(!await cdp.evaluate("window.__verifyRequests.some(r=>r.path==='/api/updates/install')"),'download does not install');
    await screenshot('update-downloading');
    await updaterButton('Cancel download'); await waitFor(async()=>(await updaterText()).includes('Download cancelled'),'cancel');
    await updaterButton('Download update'); await waitFor(async()=>(await updaterText()).includes('Version 0.1.6 is ready'),'verified ready');
    await screenshot('update-ready');
    await cdp.evaluate("window.__updateVerify.installError='Finish active agent work before installing.'"); await updaterButton('Install update');
    await waitFor(()=>cdp.evaluate("document.querySelector('#settings-updates [role=alert]')?.innerText.includes('Finish active agent work')"),'busy work refusal');
    await cdp.evaluate("window.__updateVerify.installError=''"); await updaterButton('Install update');
    await waitFor(async()=>(await updaterText()).includes('Installer opened'),'system installer');
    await navigate('/settings/updates'); await waitFor(async()=>(await updaterText()).includes('Installer opened'),'operation survives reload');
    // Retry and unknown-size streams keep bytes but never invent a percentage.
    await cdp.evaluate("localStorage.setItem('workProfileVerify.operation','{\"phase\":\"idle\"}'); localStorage.setItem('workProfileVerify.updateScenario',JSON.stringify({status:'available',upgradeError:'Installer verification failed.'}))");
    await navigate('/settings/updates'); await waitFor(async()=>(await updaterText()).includes('Download update'),'retry scenario');
    await updaterButton('Download update'); await waitFor(()=>cdp.evaluate("document.querySelector('#settings-updates [role=alert]')?.innerText.includes('Installer verification failed')"),'checksum failure');
    await cdp.evaluate("window.__updateVerify.upgradeError=''; window.__updateVerify.unknownSize=true; window.__updateVerify.upgradeDelayMs=3000");
    await updaterButton('Retry download'); await waitFor(async()=>(await updaterText()).includes('downloaded'),'unknown total shows bytes');
    assert(!await cdp.evaluate("Boolean(document.querySelector('[role=progressbar]'))"),'unknown total has no made-up bar');
    await updaterButton('Cancel download');
    await updaterButton('Release notes'); assert(await cdp.evaluate("window.__verifyRequests.some(r=>r.path==='/api/updates/releases')"));
    // Pointer selection of settings chrome is refused in all skins.
    for(const skin of ['default','soft','grut']) {
      await cdp.evaluate(`localStorage.setItem('autohandSquad.v1.skin',${JSON.stringify(skin)})`); await navigate('/settings/updates');
      const rect=await cdp.evaluate("(()=>{const r=document.querySelector('[data-testid=software-update] h3').getBoundingClientRect();return {x:r.x+2,y:r.y+r.height/2,end:r.x+r.width-2};})()");
      await cdp.evaluate('getSelection().removeAllRanges()');
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',clickCount:1});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.end,y:rect.y,button:'left',buttons:1});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.end,y:rect.y,button:'left',clickCount:1});
      assert.equal(await cdp.evaluate('getSelection().toString()'),'');
      assert.equal(await cdp.evaluate("getComputedStyle(document.querySelector('[data-testid=software-update] h3')).userSelect"),'none');
      await screenshot(`update-${skin}-selection`);
    }
    await navigate(`/conversations/new?member=${agents[0].id}`);
    await waitFor(()=>cdp.evaluate("Boolean(document.querySelector('[data-selectable]'))"),'copyable conversation');
    assert.equal(await cdp.evaluate("getComputedStyle(document.querySelector('[data-selectable]')).userSelect"),'text');
    const field=await cdp.evaluate("Boolean(document.querySelector('textarea') && getComputedStyle(document.querySelector('textarea')).userSelect==='text')"); assert(field);
    report.updater.progressCancelReadyReloadRetryAndSelection=true;
    if(process.env.AUTOHAND_VERIFY_UPDATES_ONLY) {
      await writeFile(join(artifacts,'report.json'),JSON.stringify(report,null,2)); console.log('Update browser flow passed with mocked release/download/install endpoints; actual pointer selection and rendered progress verified.'); return;
    }

    report.appInformation = {};
    const navigateInformation = async (page) => {
      await cdp.send("Page.navigate", { url: `${baseUrl}/app-info/${page}?window=1` });
      await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('main[data-app-information=${JSON.stringify(page)}]') && !document.body.innerText.includes('Loading app information') && !document.body.innerText.includes('Waking the squad'))`), `standalone ${page} information window`);
    };
    await navigateInformation("about");
    const about = await cdp.evaluate("({ text: document.querySelector('main').innerText, hasSidebar: Boolean(document.querySelector('.app-sidebar')), requests: window.__verifyRequests })");
    for (const value of ["Autohand Squad", "Version 0.1.5", "b".repeat(40), "Local changes", "2026-10-01T03:00:00.000Z", "Desktop executable SHA-256", "c".repeat(64)]) assert(about.text.includes(value), `About contains ${value}`);
    assert(!about.hasSidebar, "Information windows must not mount the workspace sidebar");
    assert(about.requests.every((request) => request.path === "/api/app-info"), "Information window must not poll agents, runs, notifications or update workflows");
    const infoLinks = await cdp.evaluate("Array.from(document.querySelector('[aria-label=\"App information\"]').querySelectorAll('a')).map(anchor => ({ text: anchor.textContent, href: anchor.getAttribute('href') }))");
    for (const page of ["policies", "changelog", "licenses"]) assert(infoLinks.some((link) => link.href === `/app-info/${page}?window=1`), `${page} opens an information window route`);
    await cdp.evaluate("document.querySelector('button[aria-label=\"Copy desktop executable SHA-256\"]').click()");
    await waitFor(() => cdp.evaluate("window.__appInfoCopiedChecksum === 'c'.repeat(64) && document.querySelector('main').innerText.includes('Checksum copied.')"), "About copies actual executable checksum");
    report.appInformation.aboutMetadataAndChecksum = true;
    await screenshot("app-information-about");
    report.appInformation.aboutWindowLayouts = [];
    for (const mode of ["light", "dark"]) {
      await cdp.evaluate(`localStorage.setItem('autohandSquad.v1.theme', JSON.stringify({ mode: ${JSON.stringify(mode)} }))`);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 520, height: 600, deviceScaleFactor: 1, mobile: false });
      await navigateInformation("about");
      const layout = await cdp.evaluate("({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, theme: document.documentElement.className, hashWidth: document.querySelector('[data-testid=app-executable-sha256]').getBoundingClientRect().width })");
      assert(layout.scrollWidth <= 520, `${mode} About window wraps metadata and checksum without horizontal overflow`);
      await screenshot(`app-information-about-window-${mode}`);
      report.appInformation.aboutWindowLayouts.push({ mode, ...layout });
    }
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await cdp.evaluate("window.__appInfoVerify.clipboardError = true; document.querySelector('button[aria-label=\"Copy desktop executable SHA-256\"]').click()");
    await waitFor(() => cdp.evaluate("document.querySelector('main').innerText.includes('Could not copy. Select the checksum')"), "clipboard failure is honest");
    report.appInformation.clipboardFailureIsHonest = true;
    await cdp.evaluate("localStorage.setItem('workProfileVerify.appInfoScenario', JSON.stringify({ noChecksum: true }))");
    await navigateInformation("about");
    assert(await cdp.evaluate("document.querySelector('main').innerText.includes('The installed desktop executable has not been measured') && !document.querySelector('[data-testid=app-executable-sha256]') && !document.querySelector('button[aria-label=\"Copy desktop executable SHA-256\"]')"), "Unmeasured desktop executable must never show a fabricated checksum");
    await screenshot("app-information-unmeasured-executable");
    report.appInformation.unmeasuredChecksumIsExplicit = true;
    await cdp.evaluate("localStorage.setItem('workProfileVerify.appInfoScenario', '{}')");
    for (const [page, expected] of [["policies", "Browser fixture disclosure policy"], ["changelog", "Browser fixture shipped profile improvements"], ["licenses", "browser-fixture-react"]]) {
      await navigateInformation(page);
      assert(await cdp.evaluate(`document.querySelector('main').innerText.includes(${JSON.stringify(expected)})`), `${page} shows bundled document content`);
      assert(!await cdp.evaluate("Boolean(document.querySelector('.app-sidebar'))"), `${page} has no workspace sidebar`);
      if (page === "policies") assert(await cdp.evaluate("Boolean(document.querySelector('a[href=\"https://autohand.ai/policies/\"][target=\"_blank\"]'))"), "Policies links to official product policies");
      if (page === "licenses") {
        await cdp.evaluate("document.querySelectorAll('main details').forEach(disclosure => disclosure.open = true)");
        const text = await cdp.evaluate("document.querySelector('main').innerText");
        for (const value of ["19.0.0", "MIT", "Browser fixture permission notice for React", "Apache-2.0", "Browser fixture license text was not staged", "License text was not included in this build", "missing notices are identified explicitly"]) assert(text.includes(value), `Licenses show ${value}`);
      }
      await screenshot(`app-information-${page}`);
    }
    report.appInformation.documentsAndMissingNotices = true;
    await cdp.evaluate("localStorage.setItem('workProfileVerify.appInfoScenario', JSON.stringify({ error: true }))");
    await navigateInformation("about");
    assert(await cdp.evaluate("document.querySelector('[role=alert]')?.innerText.includes('Browser fixture app information unavailable') && !document.querySelector('main').innerText.includes('0.1.0')"), "App information failure must not invent a version");
    await cdp.evaluate("window.__appInfoVerify.error = false; Array.from(document.querySelector('main').querySelectorAll('button')).find(button => button.textContent === 'Try again').click()");
    await waitFor(() => cdp.evaluate("document.querySelector('main').innerText.includes('Version 0.1.5')"), "information retry loads actual metadata");
    report.appInformation.failureAndRetry = true;
    await cdp.evaluate("Array.from(document.querySelector('main').querySelectorAll('button, a')).find(button => button.textContent.trim() === 'Check for upgrades').click()");
    await waitFor(() => cdp.evaluate("location.pathname.startsWith('/settings') && document.querySelector('#settings-updates')?.getBoundingClientRect().top < innerHeight / 3"), "About opens Updates settings");
    assert(await cdp.evaluate("window.__verifyRequests.some(request => request.path === '/api/updates' && request.query === '?refresh=1')"), "About Check for upgrades performs a fresh repository check");
    report.appInformation.checkForUpgradesOpensUpdates = true;
    await cdp.evaluate("localStorage.setItem('workProfileVerify.appInfoScenario', '{}')");
    await navigate(`/conversations/new?member=${agents[0].id}`);
    await cdp.evaluate("document.querySelector('.app-sidebar button[aria-haspopup=menu]').click()");
    await waitFor(() => cdp.evaluate("document.querySelector('[role=menu]')?.innerText.includes('About Autohand Squad')"), "account menu About command");
    assert(!await cdp.evaluate("document.querySelector('[role=menu]').innerText.includes('Check for upgrades')"), "Account menu uses the contextual update notice; manual checks remain in About and native menu");
    await cdp.evaluate("Array.from(document.querySelector('[role=menu]').querySelectorAll('button')).find(button => button.textContent.trim() === 'About Autohand Squad').click()");
    await waitFor(() => cdp.evaluate("Boolean(document.querySelector('main[data-app-information=about]'))"), "account menu opens standalone About");
    report.appInformation.accountMenuOpensAbout = true;
    await navigate(`/conversations/new?member=${agents[0].id}`);
    await cdp.evaluate("window.dispatchEvent(new CustomEvent('autohand-squad:menu', { detail: { action: 'check-upgrades' } }))");
    await waitFor(() => cdp.evaluate("location.pathname.startsWith('/settings') && window.__verifyRequests.some(request => request.path === '/api/updates' && request.query === '?refresh=1')"), "native menu check command performs fresh repository check");
    report.appInformation.nativeMenuCheckDispatch = true;
    await cdp.send("Page.navigate", { url: `${baseUrl}/conversations/new?member=${agents[0].id}&about=squad` });
    await waitFor(() => cdp.evaluate("Boolean(document.querySelector('main[data-app-information=about]'))"), "legacy About link opens standalone About");
    report.appInformation.legacyAboutLink = true;
    report.computerUse = { mockedNativeOnly: true, mockedScreenOnly: true };
    await cdp.evaluate("localStorage.setItem('workProfileVerify.computerScenario', JSON.stringify({ native:true, available:true, os:false, cancel:true }))");
    await cdp.send("Network.setUserAgentOverride", { userAgent: "AutohandSquadDesktop/0.1.5 (macos)", platform: "MacIntel" });
    await navigate(`/squad-members/${agents[0].id}/permissions`);
    const computerText = () => cdp.evaluate("document.querySelector('[data-testid=computer-use-permissions]')?.innerText || ''");
    const computerButton = (label) => cdp.evaluate(`Array.from(document.querySelector('[data-testid=computer-use-permissions]').querySelectorAll('button')).find(button => button.textContent === ${JSON.stringify(label)}).click()`);
    await waitFor(async () => (await computerText()).includes("System Settings"), "Computer Use OS setup instructions");
    await computerButton("Set up macOS permissions");
    await waitFor(async () => (await computerText()).includes("Finish the macOS permission prompts"), "explicit setup accepted without claiming grants");
    assert(await cdp.evaluate("window.__computerCalls.some(call => call.command === 'squad_setup_computer_use') && !window.__computerCalls.some(call => call.command === 'squad_confirm_computer_use')"));
    assert(await cdp.evaluate("Array.from(document.querySelector('[data-testid=computer-use-permissions]').querySelectorAll('button')).find(button => button.textContent === 'Allow control').disabled"));
    report.computerUse.setupDoesNotGrant = true;
    await screenshot("computer-use-os-setup");
    await cdp.evaluate("window.__computerVerify.os = true");
    await computerButton("Check again");
    await waitFor(async () => (await computerText()).includes("macOS permissions are ready"), "OS check readiness");
    await computerButton("Allow control");
    await waitFor(() => cdp.evaluate("window.__computerCalls.some(call => call.command === 'squad_confirm_computer_use')"), "native confirmation request");
    assert((await computerText()).includes("Not allowed"), "Cancelled native dialog never grants control");
    assert(await cdp.evaluate("!window.__verifyRequests.some(request => request.path === '/api/computer-use/grant' && request.method !== 'GET')"), "Browser never posts its own grant");
    report.computerUse.cancelDoesNotGrant = true;
    await cdp.evaluate("window.__computerVerify.cancel = false");
    await computerButton("Allow control");
    await waitFor(async () => (await computerText()).includes("Control allowed"), "confirmed native control receipt");
    await computerButton("Revoke access");
    await waitFor(async () => (await computerText()).includes("Not allowed"), "native revoke");
    report.computerUse.confirmAndRevoke = true;
    await cdp.evaluate("localStorage.setItem('workProfileVerify.computerScenario', JSON.stringify({ stream:true }))");
    await navigate(`/conversations/new?member=${agents[0].id}`);
    await waitFor(() => cdp.evaluate("Boolean(document.querySelector('textarea[placeholder=\"Talk to Eva...\"]'))"), "DM composer for mocked stream");
    await cdp.evaluate("document.querySelector('textarea[placeholder=\"Talk to Eva...\"]').focus()");
    await cdp.send("Input.insertText", { text: "Verify the mocked desktop." });
    await cdp.evaluate("document.querySelector('textarea[placeholder=\"Talk to Eva...\"]').closest('form').requestSubmit()");
    await waitFor(() => cdp.evaluate("Boolean(document.querySelector('article[aria-live=polite] [data-testid=computer-use-evidence] img'))"), "Computer Use evidence during partial stream");
    report.computerUse.partialStreamEvidence = true;
    await waitFor(() => cdp.evaluate("document.querySelector('main').innerText.includes('Completed the desktop fixture') && document.querySelectorAll('[data-testid=computer-use-evidence] img').length === 2"), "durable evidence merged by exact session");
    assert(!await cdp.evaluate("Boolean(document.querySelector('img[src*=unrelated]'))"), "Another member session is never attached to this reply");
    await waitFor(() => cdp.evaluate("Array.from(document.querySelectorAll('[data-testid=computer-use-evidence] img')).every(image => image.complete && image.naturalWidth > 0)"), "Evidence PNG bytes are actually rendered");
    await screenshot("computer-use-dm-evidence");
    await navigate(`/conversations/new?member=${agents[0].id}`);
    await waitFor(() => cdp.evaluate("document.querySelectorAll('[data-testid=computer-use-evidence] img').length === 2"), "evidence recovers after page reload");
    report.computerUse.durableExactSessionEvidence = true;
    await navigate(`/conversations/new?member=${agents[1].id}`);
    assert(!await cdp.evaluate("Boolean(document.querySelector('[data-testid=computer-use-evidence]'))"), "Other member conversation cannot inherit this evidence");
    report.computerUse.memberSwitchIsolated = true;
    const unsafeRequests = await cdp.evaluate("window.__verifyRequests.filter(item => /chat\\/stream|runs$|approve$|decline$|terminal$|shell$/.test(item.path) && item.method !== 'GET')");
    assert.deepEqual(unsafeRequests, [], "Browser proof must never dispatch provider or approval actions");
    await writeFile(join(artifacts, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: true, fixtureOnly: true, reportPath: join(artifacts, "report.json"), screenshotCount: report.screenshots.length, normalLogo: report.normalLogo, profileLogo: report.profileLogo, collapsedProfileLogo: report.collapsedProfileLogo, escapeRestoresFocus: report.escapeRestoresFocus, livePresenceUpdatesInOpenCard: report.livePresenceUpdatesInOpenCard, attentionBeforeReading: 7, attentionAfterReading: 4, historyRestoresFilter: report.historyRestoresFilter, completedEvidenceDeepLink: report.completedEvidenceDeepLink, approvalOpensChannel: report.approvalOpensChannel, handoffOpensTask: report.handoffOpensTask, legacyInbox: report.legacyInbox, legacyMissionControl: report.legacyMissionControl, skinLogoAlignment: report.skinLogoAlignment.map(({ skin }) => skin), responsive: report.responsive, updater: report.updater, appInformation: report.appInformation, computerUse: report.computerUse }, null, 2));
  } catch (error) {
    if (cdp) { report.failure = error.message; report.body = await cdp.evaluate("document.body.innerText").catch(() => "unavailable"); const shot = await cdp.send("Page.captureScreenshot", { format: "png" }).catch(() => null); if (shot) await writeFile(join(artifacts, "failure.png"), Buffer.from(shot.data, "base64")); await writeFile(join(artifacts, "report.json"), JSON.stringify(report, null, 2)); }
    throw error;
  } finally {
    cdp?.ws.close(); vite?.kill("SIGTERM"); chrome.kill("SIGTERM");
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    if (output.some((line) => /error/i.test(line))) console.error(output.join("").slice(-4000));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
