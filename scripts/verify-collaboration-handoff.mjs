import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rootDir = process.cwd();
const appPort = Number(process.env.AUTOHAND_VERIFY_APP_PORT || 19835);
const chromePort = Number(process.env.AUTOHAND_VERIFY_CHROME_PORT || 9225);
const externalBaseUrl = process.env.AUTOHAND_VERIFY_BASE_URL || "";
const baseUrl = externalBaseUrl || `http://127.0.0.1:${appPort}`;
const visibleChrome = process.env.AUTOHAND_VERIFY_VISIBLE === "1";
const keepChrome = process.env.AUTOHAND_VERIFY_KEEP_CHROME === "1";
const screenshotPath = process.env.AUTOHAND_VERIFY_SCREENSHOT || "";
const workspace = rootDir;
const workspaceRoot = process.env.HOME || rootDir;

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, { timeoutMs = 10000, intervalMs = 100, label = "condition" } = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function waitForHttp(url, label) {
  return waitFor(async () => {
    const response = await fetch(url).catch(() => null);
    return response?.ok;
  }, { timeoutMs: 15000, label });
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
        else resolve(message.result || {});
        return;
      }
      this.events.push(message);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 10000);
    });
  }

  close() {
    this.ws.close();
  }
}

async function createCdpClient() {
  const targets = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${chromePort}/json`).catch(() => null);
    if (!response?.ok) return null;
    const payload = await response.json();
    return payload.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  }, { timeoutMs: 15000, label: "Chrome DevTools target" });

  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("Chrome DevTools websocket failed")), { once: true });
  });
  return new CdpClient(ws);
}

function injectedBrowserHarness() {
  const agents = [
    {
      id: "angela",
      staffId: "member-001",
      name: "Angela",
      role: "Product engineer",
      status: "online",
      workspace: "__WORKSPACE__",
      projects: [{ id: "project-main", name: "autohandSWE", label: "autohandSWE", path: "__WORKSPACE__", kind: "project" }],
      description: "Coordinates user-facing implementation work.",
      instructions: "Acknowledge delegation and coordinate with other squad members.",
      memory: ["Angela prefers handing design-heavy details to Hellen when the user asks for collaboration."],
      skills: [],
      stats: { activeDays: 1, automations: 0, tasks: 0, projects: 1 },
      permissions: {},
      launch: { mode: "prompt", policy: "restricted", model: "", dryRun: false },
      modelAssignment: { mode: "inherit" },
    },
    {
      id: "hellen",
      staffId: "member-002",
      name: "Hellen",
      role: "Design reviewer",
      status: "online",
      workspace: "__WORKSPACE__",
      projects: [{ id: "project-main", name: "autohandSWE", label: "autohandSWE", path: "__WORKSPACE__", kind: "project" }],
      description: "Reviews interaction quality and gives implementation-ready product feedback.",
      instructions: "Pick up handoffs directly and return concise results.",
      memory: ["Hellen owns interaction review for Autohand Squad member collaboration flows."],
      skills: [],
      stats: { activeDays: 1, automations: 0, tasks: 0, projects: 1 },
      permissions: {},
      launch: { mode: "prompt", policy: "restricted", model: "", dryRun: false },
      modelAssignment: { mode: "inherit" },
    },
  ];

  const storage = {
    "autohandSquad.v1.agents": JSON.stringify(agents),
    "autohandSquad.v1.messages": JSON.stringify({ angela: [], hellen: [] }),
    "autohandSquad.v1.tasks": JSON.stringify([]),
    "autohandSquad.v1.automations": JSON.stringify([]),
    "autohandSquad.v1.memoryInbox": JSON.stringify([]),
  };
  for (const [key, value] of Object.entries(storage)) {
    window.localStorage.setItem(key, value);
  }

  window.__AUTOHAND_SQUAD_VERIFY__ = true;
  window.__chatRequests = [];
  const originalFetch = window.fetch.bind(window);
  const jsonResponse = (data, status = 200) =>
    new Response(JSON.stringify({ success: status < 400, data, error: status >= 400 ? String(data?.error || "error") : undefined }), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  const sseResponse = (events) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(": connected\n\n"));
        for (const event of events) {
          controller.enqueue(encoder.encode(`event: ${event.event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event.data)}\n\n`));
        }
        controller.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8" } });
  };

  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, window.location.origin);
    if (url.pathname === "/api/runtime") {
      return jsonResponse({
        autohandPath: "/mock/autohand",
        version: "verify",
        squadVersion: "0.1.0",
        available: true,
        defaultWorkspace: "__WORKSPACE__",
        workspaceRoot: "__WORKSPACE_ROOT__",
        squadWorkspaceRoot: "__WORKSPACE_ROOT__/.autohandsquad",
        legacySquadWorkspaceRoots: [],
        limits: { maxProjectsPerMember: 5 },
        features: { workspaceFileMentions: true },
        handoffs: { recommendationConfirmationRequired: false, retryMode: "checkpoint" },
        serverStartedAt: new Date().toISOString(),
      });
    }
    if (url.pathname === "/api/workspaces") {
      return jsonResponse([{ label: "autohandSWE", name: "autohandSWE", path: "__WORKSPACE__", depth: 1, kind: "project", launchable: true }]);
    }
    if (url.pathname === "/api/runs") return jsonResponse([]);
    if (url.pathname === "/api/provider-settings") {
      return jsonResponse({
        version: 1,
        defaultProvider: "openrouter",
        providers: { openrouter: { id: "openrouter", enabled: true, model: "mock", apiKeyConfigured: true, label: "OpenRouter" } },
        definitions: [],
      });
    }
    if (url.pathname === "/api/memory-inbox") return jsonResponse({ items: [] });
    if (url.pathname === "/api/status/snapshot") return jsonResponse({ ok: true });
    if (url.pathname === "/api/chat/stream") {
      const body = JSON.parse(String(options.body || "{}"));
      window.__chatRequests.push(body);
      const isReceiver = body.agentId === "hellen";
      const reply = isReceiver
        ? "Got it from Angela. I picked up the conversation, checked the shared task and memories, and my result is: Hellen can continue this work with Angela."
        : "Got it. Let me talk to Hellen and I will come back with her result.";
      return sseResponse([
        { event: "start", data: { startedAt: new Date().toISOString(), workspace: "__WORKSPACE__", effectiveModel: { provider: "openrouter", label: "OpenRouter", model: "mock" } } },
        { event: "sdk", data: { type: "message_delta", delta: reply, timestamp: new Date().toISOString() } },
        {
          event: "done",
          data: {
            reply,
            trace: { steps: [], thoughts: [], toolCalls: [], toolResults: [], messages: [], events: [], raw: { stdout: reply, stderr: "" } },
            command: "mock autohand",
            workspace: "__WORKSPACE__",
            transport: "mock",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 1,
            effectiveModel: { provider: "openrouter", label: "OpenRouter", model: "mock" },
          },
        },
      ]);
    }
    return originalFetch(input, options);
  };
}

async function main() {
  const chrome = chromePath();
  if (!chrome) throw new Error("Google Chrome or Chromium was not found.");

  const profileDir = await mkdtemp(join(tmpdir(), "autohand-squad-verify-"));
  const serverOutput = [];
  const chromeOutput = [];
  const server = externalBaseUrl
    ? null
    : spawn("node", ["server.mjs", "--dev", "--host", "127.0.0.1", "--port", String(appPort)], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
  server?.stdout.on("data", (chunk) => serverOutput.push(String(chunk)));
  server?.stderr.on("data", (chunk) => serverOutput.push(String(chunk)));
  const chromeArgs = [
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${chromePort}`,
    "about:blank",
  ];
  if (!visibleChrome) chromeArgs.unshift("--headless=new");
  const chromeProcess = spawn(chrome, chromeArgs, {
    detached: keepChrome,
    stdio: keepChrome ? "ignore" : ["ignore", "ignore", "pipe"],
  });
  if (keepChrome) chromeProcess.unref();
  else chromeProcess.stderr.on("data", (chunk) => chromeOutput.push(String(chunk)));

  try {
    await waitFor(async () => {
      if (server && server.exitCode !== null) {
        throw new Error(`server exited with ${server.exitCode}: ${serverOutput.join("").slice(-2000)}`);
      }
      const response = await fetch(`${baseUrl}/api/runtime`).catch(() => null);
      return response?.ok;
    }, { timeoutMs: 15000, label: "local dev server" });
    const cdp = await createCdpClient();
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Page.bringToFront");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(${injectedBrowserHarness.toString().replaceAll("__WORKSPACE_ROOT__", workspaceRoot).replaceAll("__WORKSPACE__", workspace)})();`,
    });
    await cdp.send("Page.navigate", { url: `${baseUrl}/conversations/new?member=angela` });
    await waitFor(() => cdp.send("Runtime.evaluate", {
      expression: "Boolean(document.querySelector('textarea'))",
      returnByValue: true,
    }).then((result) => result.result?.value), { label: "conversation composer" });

    const promptText = "Angela, talk to @Hellen about this handoff and come back with her result.";
    await waitFor(() => cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: "typeof window.__AUTOHAND_SQUAD_VERIFY_SEND__ === 'function'",
    }).then((result) => result.result?.value), { label: "verification send hook" });
    await cdp.send("Runtime.evaluate", {
      expression: `window.__AUTOHAND_SQUAD_VERIFY_SEND__(${JSON.stringify(promptText)})`,
    });

    let lastProbe = null;
    const verification = await waitFor(async () => {
      const result = await cdp.send("Runtime.evaluate", {
        awaitPromise: true,
        returnByValue: true,
        expression: `
          (() => {
            const tasks = JSON.parse(localStorage.getItem('autohandSquad.v1.tasks') || '[]');
            const messages = JSON.parse(localStorage.getItem('autohandSquad.v1.messages') || '{}');
            const requests = window.__chatRequests || [];
            const task = tasks[0] || null;
            const handoff = task?.handoffs?.[0] || null;
            return {
              requests: requests.map((request) => ({ agentId: request.agentId, collaboration: request.collaboration, prompt: request.prompt, profile: request.profile })),
              task,
              handoff,
              angelaMessages: messages.angela || [],
              hellenMessages: messages.hellen || [],
              body: document.body.innerText,
            };
          })()
        `,
      });
      const value = result.result?.value;
      lastProbe = value;
      const requestAgents = new Set((value?.requests || []).map((request) => request.agentId));
      const handoffComplete = value?.handoff?.status === "completed";
      const accepted = value?.task?.timeline?.some((event) => event.type === "handoff.accepted");
      const resultEvent = value?.task?.timeline?.some((event) => event.type === "handoff.result");
      const sourceSawResult = (value?.angelaMessages || []).some((message) => String(message.body || "").includes("Hellen came back with"));
      const receiverPickedUp = (value?.hellenMessages || []).some((message) => String(message.body || "").includes("I picked this up"));
      return requestAgents.has("angela") && requestAgents.has("hellen") && handoffComplete && accepted && resultEvent && sourceSawResult && receiverPickedUp
        ? value
        : null;
    }, { timeoutMs: 12000, intervalMs: 250, label: "completed Angela to Hellen collaboration handoff" }).catch((error) => {
      console.error(JSON.stringify({ lastProbe }, null, 2));
      throw error;
    });

    const receiverRequest = verification.requests.find((request) => request.agentId === "hellen");
    if (!receiverRequest?.collaboration || receiverRequest.collaboration.role !== "receiver") {
      throw new Error("Receiver request did not include receiver collaboration context.");
    }
    if (!String(receiverRequest.profile || "").includes("Source member memory") || !String(receiverRequest.profile || "").includes("Receiving member memory")) {
      throw new Error("Receiver prompt did not include source and receiving member memories.");
    }
    if (screenshotPath) {
      const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
    }

    console.log(JSON.stringify({
      ok: true,
      visibleChrome,
      chatRequests: verification.requests.length,
      handoffStatus: verification.handoff.status,
      taskStatus: verification.task.status,
      timelineTypes: verification.task.timeline.map((event) => event.type),
      sourceResultMessage: verification.angelaMessages.find((message) => String(message.body || "").includes("Hellen came back with"))?.body,
      screenshotPath: screenshotPath || undefined,
      keptChromeOpen: keepChrome,
      url: `${baseUrl}/conversations/new?member=angela`,
    }, null, 2));
    cdp.close();
  } finally {
    server?.kill("SIGTERM");
    if (!keepChrome) {
      chromeProcess.kill("SIGTERM");
      await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    }
    if (process.exitCode) {
      if (serverOutput.length) console.error(`\n[server]\n${serverOutput.join("").slice(-4000)}`);
      if (chromeOutput.length) console.error(`\n[chrome]\n${chromeOutput.join("").slice(-4000)}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
