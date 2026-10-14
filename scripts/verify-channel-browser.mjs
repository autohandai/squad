import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const rootDir = process.cwd();
const appPort = Number(process.env.AUTOHAND_VERIFY_APP_PORT || 19836);
const chromePort = Number(process.env.AUTOHAND_VERIFY_CHROME_PORT || 9236);
const baseUrl = process.env.AUTOHAND_VERIFY_BASE_URL || `http://127.0.0.1:${appPort}`;
const visibleChrome = process.env.AUTOHAND_VERIFY_VISIBLE === "1";
const keepChrome = process.env.AUTOHAND_VERIFY_KEEP_CHROME === "1";
const screenshotPath = process.env.AUTOHAND_VERIFY_SCREENSHOT || join(rootDir, ".codex-artifacts", "channels-browser.png");
const workspace = rootDir;
const workspaceRoot = process.env.HOME || rootDir;
const verifyChannelName = "clients-browser-verify-nz";

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

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { method, resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${method} failed: ${message.error.message}`));
      else resolve(message.result || {});
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 15000);
    });
  }

  close() {
    this.ws.close();
  }
}

async function createCdpClient() {
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${chromePort}/json`).catch(() => null);
    if (!response?.ok) return null;
    const payload = await response.json();
    return payload.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  }, { timeoutMs: 15000, label: "Chrome DevTools target" });

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("Chrome DevTools websocket failed")), { once: true });
  });
  return new CdpClient(ws);
}

function injectedChannelHarness() {
  const agents = [
    {
      id: "aroha_frontend",
      staffId: "member-001",
      name: "Aroha",
      role: "Frontend engineer",
      status: "online",
      workspace: "__WORKSPACE__",
      projects: [{ id: "project-pieshop", name: "pieshop", label: "pieshop", path: "__WORKSPACE__", kind: "project" }],
      description: "Builds polished static websites and UI flows.",
      instructions: "Own the implementation plan and front-end build steps.",
      memory: ["New Zealand small-business sites should feel local, practical, and quick to scan."],
      skills: [],
      stats: { activeDays: 1, automations: 0, tasks: 0, projects: 1 },
      permissions: {},
      launch: { mode: "prompt", policy: "restricted", model: "", dryRun: false },
      modelAssignment: { mode: "inherit" },
    },
    {
      id: "tane_copy",
      staffId: "member-002",
      name: "Tane",
      role: "Market copywriter",
      status: "online",
      workspace: "__WORKSPACE__",
      projects: [{ id: "project-pieshop", name: "pieshop", label: "pieshop", path: "__WORKSPACE__", kind: "project" }],
      description: "Writes concise market positioning and page copy.",
      instructions: "Own the New Zealand market angle and page narrative.",
      memory: ["Pie shop copy should mention local ingredients, hot cabinet service, and catering without sounding corporate."],
      skills: [],
      stats: { activeDays: 1, automations: 0, tasks: 0, projects: 1 },
      permissions: {},
      launch: { mode: "prompt", policy: "restricted", model: "", dryRun: false },
      modelAssignment: { mode: "inherit" },
    },
  ];

  const preserveStorage = window.localStorage.getItem("autohandChannelVerify.preserve") === "true";
  if (!preserveStorage) {
    const storage = {
      "autohandSquad.v1.agents": JSON.stringify(agents),
      "autohandSquad.v1.messages": JSON.stringify({}),
      "autohandSquad.v1.tasks": JSON.stringify([]),
      "autohandSquad.v1.automations": JSON.stringify([]),
      "autohandSquad.v1.memoryInbox": JSON.stringify([]),
      "autohandSquad.v1.channels": JSON.stringify([]),
      "autohandSquad.v1.channelThreads": JSON.stringify({}),
      "autohandSquad.v1.channelMessages": JSON.stringify({}),
      "autohandSquad.v1.onboarding": JSON.stringify({ version: 1, status: "skipped", lastStep: "skipped" }),
      "autohandSquad.v1.sidebarCollapsed": "false",
    };
    for (const [key, value] of Object.entries(storage)) {
      window.localStorage.setItem(key, value);
    }
  }

  window.__channelRequests = [];
  window.__downloadedMarkdown = null;
  window.__channelState = preserveStorage
    ? {
        channels: JSON.parse(window.localStorage.getItem("autohandSquad.v1.channels") || "[]"),
        threads: Object.values(JSON.parse(window.localStorage.getItem("autohandSquad.v1.channelThreads") || "{}")).flat(),
      }
    : { channels: [], threads: [] };
  const originalFetch = window.fetch.bind(window);
  const jsonResponse = (data, status = 200) =>
    new Response(JSON.stringify({ success: status < 400, data, error: status >= 400 ? String(data?.error || "error") : undefined }), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  const activeChats = new Map();
  const heldReplies = [];
  window.__releaseHeldChannelReplies = () => heldReplies.splice(0).forEach(resolve => resolve());
  const sseResponse = (events, onComplete) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(": connected\n\n"));
        for (const event of events) {
          if (event.delayMs) await new Promise((resolve) => setTimeout(resolve, event.delayMs));
          if (event.hold) await new Promise(resolve => heldReplies.push(resolve));
          const { delayMs, hold, ...payload } = event;
          controller.enqueue(encoder.encode(`event: ${payload.event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload.data)}\n\n`));
        }
        controller.close();
        onComplete?.();
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
        account: { signedIn: true, email: "verify@example.test", source: "browser-verifier" },
        limits: { maxProjectsPerMember: 5 },
        features: { workspaceFileMentions: true },
        handoffs: { recommendationConfirmationRequired: false, retryMode: "checkpoint" },
        serverStartedAt: new Date().toISOString(),
      });
    }
    if (url.pathname === "/api/workspaces") {
      return jsonResponse([{ label: "pieshop", name: "pieshop", path: "__WORKSPACE__", depth: 1, kind: "project", launchable: true }]);
    }
    if (url.pathname === "/api/runs") return jsonResponse([]);
    if (url.pathname === "/api/members/presence") {
      const presence = Object.fromEntries(agents.map(agent => [agent.id, {
        state: activeChats.get(agent.id) ? 'working' : 'online',
        activeRuns: activeChats.get(agent.id) || 0,
        sessionIdleMs: 0,
        since: new Date().toISOString(),
      }]));
      return jsonResponse({ at: new Date().toISOString(), presence });
    }
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
    if ((url.pathname === "/api/channels" || url.pathname === "/api/channels/sync") && options.method === "PUT") {
      window.__channelState = JSON.parse(String(options.body || "{}"));
      return jsonResponse(window.__channelState);
    }
    if (url.pathname === "/api/channels" && options.method === "POST") {
      const draft = JSON.parse(options.body);
      const now = new Date().toISOString();
      const channel = { ...draft, createdAt: now, updatedAt: now };
      window.__channelState.channels.push(channel);
      return jsonResponse(channel);
    }
    const channelMutation = url.pathname.match(/^\/api\/channels\/([^/]+)(\/members)?$/);
    if (channelMutation) {
      const channel = window.__channelState.channels.find(item => item.id === decodeURIComponent(channelMutation[1]));
      if (!channel) return new Response(JSON.stringify({ success: false, error: "channel not found" }), { status: 404 });
      if (options.method === "DELETE") window.__channelState.channels = window.__channelState.channels.filter(item => item.id !== channel.id);
      else {
        const patch = JSON.parse(options.body || '{}');
        if (channelMutation[2]) channel.memberIds = [...new Set([...channel.memberIds, ...(patch.add || [])])].filter(id => !(patch.remove || []).includes(id));
        else Object.assign(channel, patch);
        channel.updatedAt = new Date().toISOString();
      }
      return jsonResponse(channel);
    }
    if (url.pathname === "/api/channels") return jsonResponse(window.__channelState);
    if (url.pathname === "/api/chat/stream") {
      const body = JSON.parse(String(options.body || "{}"));
      window.__channelRequests.push(body);
      activeChats.set(body.agentId, (activeChats.get(body.agentId) || 0) + 1);
      const holdReply = window.__channelRequests.length > 1 && window.__channelRequests.length <= 3;
      const reply = body.agentId === "aroha_frontend"
        ? "Aroha: I will build the static pie shop site structure and responsive sections for the New Zealand market."
        : "Tane: I will supply local pie shop messaging, menu framing, and user-facing launch guidance.";
      return sseResponse([
        { event: "start", data: { startedAt: new Date().toISOString(), workspace: "__WORKSPACE__", channel: body.channel } },
        { event: "sdk", data: { type: "status", status: "cli_start", label: "Running local runtime...", timestamp: new Date().toISOString() }, delayMs: 750 },
        { event: "sdk", data: { type: "message_delta", delta: reply, timestamp: new Date().toISOString() } },
        {
          event: "done",
          hold: holdReply,
          data: {
            reply: JSON.stringify({ answer: reply, sdk: { hidden: true } }),
            trace: { steps: [], thoughts: [], toolCalls: [], toolResults: [], messages: [], events: [], raw: { stdout: reply, stderr: "" } },
            command: "mock autohand",
            workspace: "__WORKSPACE__",
            transport: "mock",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 1,
          },
        },
      ], () => activeChats.set(body.agentId, Math.max(0, (activeChats.get(body.agentId) || 1) - 1)));
    }
    return originalFetch(input, options);
  };

  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function captureMarkdownDownload() {
    if (String(this.download || "").endsWith(".md") && String(this.href || "").startsWith("blob:")) {
      fetch(this.href)
        .then((response) => response.text())
        .then((text) => {
          window.__downloadedMarkdown = { filename: this.download, text };
        })
        .catch((error) => {
          window.__downloadedMarkdown = { filename: this.download, error: String(error?.message || error) };
        });
    }
    return originalAnchorClick.call(this);
  };
}

async function evaluate(cdp, expression, options = {}) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: options.awaitPromise === true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime evaluation failed");
  }
  return result.result?.value;
}

async function main() {
  const chrome = chromePath();
  if (!chrome) throw new Error("Google Chrome or Chromium was not found.");

  const profileDir = await mkdtemp(join(tmpdir(), "autohand-channel-verify-"));
  const serverStateDir = await mkdtemp(join(tmpdir(), "autohand-channel-fixture-state-"));
  const serverOutput = [];
  const chromeOutput = [];
  const server = process.env.AUTOHAND_VERIFY_BASE_URL
    ? null
    : spawn("node", ["server.mjs", "--dev", "--host", "127.0.0.1", "--port", String(appPort)], {
      cwd: rootDir,
      env: { ...process.env, AUTOHAND_HOME: join(serverStateDir, "autohand"), AUTOHAND_SQUAD_HOME: join(serverStateDir, "squad"), AUTOHAND_SQUAD_APP_STATE_DIR: join(serverStateDir, "app"), AUTOHAND_USER_CONFIG_PATH: join(serverStateDir, "config.json") },
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
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(${injectedChannelHarness.toString().replaceAll("__WORKSPACE_ROOT__", workspaceRoot).replaceAll("__WORKSPACE__", workspace)})();`,
    });
    await cdp.send("Page.navigate", { url: `${baseUrl}/channels` });

    let lastRouteProbe = null;
    await waitFor(async () => {
      lastRouteProbe = await evaluate(cdp, `
        (() => ({
          ready: Boolean(document.querySelector('aside') && document.body.innerText.includes('Channels')),
          href: location.href,
          body: document.body.innerText.slice(0, 800),
          hasAside: Boolean(document.querySelector('aside')),
        }))()
      `);
      return lastRouteProbe.ready;
    }, {
      label: "channels route",
    }).catch((error) => {
      console.error(JSON.stringify({ lastRouteProbe }, null, 2));
      throw error;
    });


    await cdp.send("Page.navigate", { url: `${baseUrl}/channels` });
    await waitFor(async () => {
      lastRouteProbe = await evaluate(cdp, `
        (() => ({
          ready: Boolean(document.querySelector('aside') && document.body.innerText.includes('Channels')),
          href: location.href,
          body: document.body.innerText.slice(0, 800),
          hasAside: Boolean(document.querySelector('aside')),
        }))()
      `);
      return lastRouteProbe.ready;
    }, {
      label: "channels route after recovered transcript check",
    }).catch((error) => {
      console.error(JSON.stringify({ lastRouteProbe }, null, 2));
      throw error;
    });

    await evaluate(cdp, `
      (() => {
        document.querySelector('button[aria-label="Create channel"]').click();
      })()
    `);
    await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('#channel-name'))"), { label: "create channel dialog" });
    await evaluate(cdp, `
      (() => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        const input = document.querySelector('#channel-name');
        setValue.call(input, ${JSON.stringify(verifyChannelName)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const dialog = input.closest('[role="dialog"]');
        for (const label of ['Aroha', 'Tane']) {
          const button = Array.from(dialog.querySelectorAll('button')).find((item) => item.textContent.trim() === label || item.textContent.trim() === label.charAt(0) + label);
          if (!button) throw new Error('Create channel dialog has no member ' + label + '; it lists: ' + Array.from(dialog.querySelectorAll('button')).map((item) => item.textContent.trim()).filter(Boolean).join(' | '));
          button.click();
        }
      })()
    `);
    await waitFor(() => evaluate(cdp, `
      (() => {
        const dialog = document.querySelector('[role="dialog"]');
        return ['Aroha', 'Tane'].every((label) => {
          const button = Array.from(dialog.querySelectorAll('button')).find((item) => item.textContent.trim() === label || item.textContent.trim() === label.charAt(0) + label);
          return button?.getAttribute('aria-pressed') === 'true';
        });
      })()
    `), { label: "selected channel members" });
    await evaluate(cdp, `
      (() => {
        document.querySelector('[role="dialog"] button[type="submit"]').click();
      })()
    `);

    let lastCreateProbe = null;
    await waitFor(async () => {
      lastCreateProbe = await evaluate(cdp, `
        (() => {
          const channels = JSON.parse(localStorage.getItem('autohandSquad.v1.channels') || '[]');
          const channel = channels.find((item) => item.name === ${JSON.stringify(verifyChannelName)});
          return {
            ok: Boolean(channel && channel.memberIds.length === 2 && location.pathname.startsWith('/channels/')),
            href: location.href,
            channels,
            dialog: document.querySelector('[role="dialog"]')?.innerText || '',
            body: document.body.innerText.slice(0, 1200),
          };
        })()
      `);
      return lastCreateProbe.ok;
    }, { label: "created channel with selected members" }).catch((error) => {
      console.error(JSON.stringify({ lastCreateProbe }, null, 2));
      throw error;
    });
    await waitFor(() => evaluate(cdp, "!document.querySelector('[role=\"dialog\"]')"), { label: "closed create channel dialog" });

    await evaluate(cdp, `
      (() => {
        const textarea = document.querySelector('main textarea[placeholder^="Message #"]');
        const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setValue.call(textarea, 'Hey @Aroha, sketch the homepage structure first.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    await evaluate(cdp, `document.querySelector('main button[aria-label="Send"]').click()`);

    let lastTargetedProbe = null;
    const targetedDispatch = await waitFor(() => evaluate(cdp, `
      (() => {
        const channels = JSON.parse(localStorage.getItem('autohandSquad.v1.channels') || '[]');
        const channel = channels.find((item) => item.name === ${JSON.stringify(verifyChannelName)});
        const threads = JSON.parse(localStorage.getItem('autohandSquad.v1.channelThreads') || '{}');
        const messages = JSON.parse(localStorage.getItem('autohandSquad.v1.channelMessages') || '{}');
        const requests = window.__channelRequests || [];
        const channelThreads = channel ? (threads[channel.id] || []) : [];
        const channelMessages = channel ? (messages[channel.id] || []) : [];
        const targetedRequest = requests.find((request) => request.prompt.includes('@Aroha'));
        const targetedReplies = channelMessages.filter((item) => item.role === 'agent' && item.status === 'complete' && item.body.includes('Aroha:'));
        lastTargetedProbe = {
          ok: Boolean(targetedRequest && targetedRequest.memberIds.length === 1 && targetedRequest.memberIds[0] === 'aroha_frontend' && channelThreads.length === 1 && targetedReplies.length === 1),
          targetedRequest,
          channelThreads,
          channelMessages,
          requests,
        };
        return lastTargetedProbe;
      })()
    `).then((value) => value?.ok ? value : null), {
      timeoutMs: 12000,
      intervalMs: 250,
      label: "targeted channel mention reply",
    }).catch((error) => {
      console.error(JSON.stringify({ lastTargetedProbe }, null, 2));
      throw error;
    });

    await evaluate(cdp, `document.querySelector('main header button[aria-label="Settings"]').click()`);
    await waitFor(() => evaluate(cdp, `Boolean(document.querySelector('[id^="auto-mode-"]'))`), { label: "channel settings switch" });
    await evaluate(cdp, `
      (() => {
        const channels = JSON.parse(localStorage.getItem('autohandSquad.v1.channels') || '[]');
        const channel = channels.find((item) => item.name === ${JSON.stringify(verifyChannelName)});
        document.querySelector('#auto-mode-' + channel.id).click();
      })()
    `);

    let lastAutoModeProbe = null;
    await waitFor(() => evaluate(cdp, `
      (() => {
        const channels = JSON.parse(localStorage.getItem('autohandSquad.v1.channels') || '[]');
        const channel = channels.find((item) => item.name === ${JSON.stringify(verifyChannelName)});
        const main = document.querySelector('main')?.innerText || '';
        lastAutoModeProbe = {
          ok: Boolean(channel?.autoModeDefault === true && document.querySelector('#auto-mode-' + channel.id)?.getAttribute('aria-checked') === 'true'),
          channel,
          main: main.slice(0, 1600),
        };
        return lastAutoModeProbe;
      })()
    `).then((value) => value?.ok ? value : null), {
      timeoutMs: 6000,
      intervalMs: 100,
      label: "auto mode switch state",
    }).catch((error) => {
      console.error(JSON.stringify({ lastAutoModeProbe }, null, 2));
      throw error;
    });

    await evaluate(cdp, `document.querySelector('main header button[aria-label="Settings"]').click()`);

    await evaluate(cdp, `
      (() => {
        const textarea = document.querySelector('main textarea[placeholder^="Message #"]');
        const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setValue.call(textarea, '@here Build a simple static pie shop website for the New Zealand market and tell the user what to do next.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    await evaluate(cdp, `document.querySelector('main button[aria-label="Send"]').click()`);

    let lastPresenceProbe;
    const busyPresence = await waitFor(() => evaluate(cdp, `
      (() => {
        const labels = Array.from(document.querySelectorAll('aside button[aria-label]'))
          .map((item) => item.getAttribute('aria-label') || '');
        const sidebar = document.querySelector('aside')?.innerText || '';
        const busyLabels = labels.filter((label) => (
          (label.includes('Aroha') || label.includes('Tane')) && label.includes('Working')
        ));
        return {
          ok: busyLabels.length >= 2,
          busyLabels,
          labels,
          sidebar: sidebar.slice(0, 1600),
          requests: window.__channelRequests.map(item => ({agentId:item.agentId, channelId:item.channelId})),
          composer: document.querySelector('main textarea')?.value,
          main: document.querySelector('main')?.innerText.slice(-1800),
        };
      })()
    `).then((value) => { lastPresenceProbe = value; return value?.ok ? value : null; }), {
      timeoutMs: 15000,
      intervalMs: 100,
      label: "channel members busy presence",
    }).catch(async (error) => {
      console.error(JSON.stringify({ lastPresenceProbe }, null, 2));
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(rootDir, '.codex-artifacts', 'channels-presence-failure.png'), Buffer.from(shot.data, 'base64'));
      throw error;
    });
    await evaluate(cdp, `window.__releaseHeldChannelReplies()`);

    const verification = await waitFor(() => evaluate(cdp, `
      (() => {
        const channels = JSON.parse(localStorage.getItem('autohandSquad.v1.channels') || '[]');
        const channel = channels.find((item) => item.name === ${JSON.stringify(verifyChannelName)});
        const threads = JSON.parse(localStorage.getItem('autohandSquad.v1.channelThreads') || '{}');
        const messages = JSON.parse(localStorage.getItem('autohandSquad.v1.channelMessages') || '{}');
        const requests = window.__channelRequests || [];
        const channelThreads = channel ? (threads[channel.id] || []) : [];
        const channelMessages = channel ? (messages[channel.id] || []) : [];
        const replyCount = channelMessages.filter((item) => item.role === 'agent' && item.status === 'complete').length;
        const sidebar = document.querySelector('aside')?.innerText || '';
        const main = document.querySelector('main')?.innerText || '';
        const targetedRequest = requests.find((request) => request.prompt.includes('@Aroha'));
        const hereRequests = requests.filter((request) => request.prompt.includes('@here'));
        const leakedSdkText = channelMessages.some((item) => String(item.body || '').includes('"sdk"') || String(item.body || '').includes('"answer"'));
        return {
          ok: Boolean(
            channel &&
            channelThreads.length === 2 &&
            replyCount === 3 &&
            requests.length === 3 &&
            targetedRequest?.memberIds?.length === 1 &&
            targetedRequest.memberIds[0] === 'aroha_frontend' &&
            hereRequests.length === 2 &&
            hereRequests.every((request) => request.memberIds.length === 2) &&
            hereRequests.every((request) => request.autoModeDefault === true && request.selfJudge === true) &&
            !leakedSdkText
          ),
          channel,
          channelThreads,
          requestSummary: requests.map((request) => ({
            agentId: request.agentId,
            channelId: request.channelId,
            threadId: request.threadId,
            memberIds: request.memberIds,
            transport: request.transport,
            timeoutMs: request.timeoutMs,
            autoModeDefault: request.autoModeDefault,
            selfJudge: request.selfJudge,
            agentModelAssignment: request.agent?.modelAssignment?.mode,
            profileHasChannelContext: String(request.profile || '').includes('Autohand Squad channel context'),
            prompt: request.prompt,
          })),
          sidebarHasChannel: sidebar.includes(${JSON.stringify(verifyChannelName)}),
          mainHasHeader: main.includes(${JSON.stringify(verifyChannelName)}),
          dialogText: document.querySelector('[role="dialog"]')?.innerText || '',
          leakedSdkText,
          messages: channelMessages,
        };
      })()
    `, { awaitPromise: true }).then((value) => value?.ok ? value : null), {
      timeoutMs: 12000,
      intervalMs: 250,
      label: "channel fan-out replies",
    });

    if (!verification.sidebarHasChannel || !verification.mainHasHeader) {
      throw new Error("Channel was not visible in both sidebar category and main detail surface.");
    }
    if (verification.dialogText) {
      throw new Error(`Create channel dialog remained open: ${verification.dialogText.slice(0, 120)}`);
    }
    if (!verification.requestSummary.every((request) => (
      request.profileHasChannelContext &&
      (request.prompt.includes('@Aroha') ? request.memberIds.length === 1 : request.memberIds.length === 2) &&
      request.transport === undefined &&
      request.timeoutMs === 300000 &&
      request.agentModelAssignment === "inherit" &&
      (request.prompt.includes('@Aroha') ? request.autoModeDefault === false : request.autoModeDefault === true) &&
      (request.prompt.includes('@Aroha') ? request.selfJudge === false : request.selfJudge === true)
    ))) {
      console.error(JSON.stringify({ requestSummary: verification.requestSummary }, null, 2));
      throw new Error("Channel dispatch must keep the bridge's SDK/CLI selection and carry channel context, model assignment and auto-mode settings (ADR-0030).");
    }

    const inlineThreadProbe = await waitFor(() => evaluate(cdp, `
      (() => {
        const main = document.querySelector('main')?.innerText || '';
        const messages = JSON.parse(localStorage.getItem('autohandSquad.v1.channelMessages') || '{}');
        const replies = (messages[${JSON.stringify(verification.channel.id)}] || []).filter(message => message.role === 'agent');
        const visibleReplies = replies.filter(message => document.querySelector('[data-message-id="' + message.id + '"]')?.closest('article')?.classList.contains('ml-6'));
        const avatarCount = document.querySelectorAll('main [data-slot="avatar"]').length;
        return { ok: visibleReplies.length === 3 && main.includes('Aroha and Tane replied') && avatarCount >= 4, replyCount: visibleReplies.length, avatarCount };
      })()
    `).then(value => value?.ok ? value : null), { label: 'inline threaded replies and participants' });
    await evaluate(cdp, `document.querySelector('main button[aria-label="Reply in thread"]').click()`);
    await waitFor(() => evaluate(cdp, `document.querySelector('main')?.textContent.includes('Replying to')`), { label: 'thread follow-up selection' });
    await evaluate(cdp, `(() => { const input = document.querySelector('main textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Unsent thread follow-up'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    await evaluate(cdp, `[...document.querySelectorAll('main button')].find(button => button.innerText.trim() === 'Cancel').click()`);
    const cancelledThreadProbe = await waitFor(() => evaluate(cdp, `({ ok: !document.querySelector('main')?.textContent.includes('Replying to') && document.querySelector('main textarea')?.value === 'Unsent thread follow-up' })`).then(value => value?.ok ? value : null), { label: 'cancel thread selection preserves draft' });
    await evaluate(cdp, `(() => { const input = document.querySelector('main textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ''); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);

    await evaluate(cdp, `document.querySelector('main header button[aria-label="Settings"]').click()`);
    await waitFor(() => evaluate(cdp, `[...document.querySelectorAll('button')].some(item => item.textContent.includes('Export markdown'))`), { label: "channel export action" });
    await evaluate(cdp, `
      (() => {
        const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent.includes('Export markdown'));
        button?.click();
      })()
    `);

    const markdownExport = await waitFor(() => evaluate(cdp, `
      (() => {
        const download = window.__downloadedMarkdown;
        if (!download) return null;
        const text = download.text || '';
        return {
          ok: Boolean(
            download.filename === ${JSON.stringify(`${verifyChannelName}-chat-log.md`)} &&
            text.includes('# #${verifyChannelName}') &&
            text.includes('Hey @Aroha, sketch the homepage structure first.') &&
            text.includes('@here Build a simple static pie shop website') &&
            text.includes('Aroha: I will build') &&
            text.includes('Tane: I will supply') &&
            !text.includes('"sdk"') &&
            !text.includes('"answer"')
          ),
          filename: download.filename,
          text,
          error: download.error || '',
        };
      })()
    `).then((value) => value?.ok ? value : null), {
      timeoutMs: 6000,
      intervalMs: 100,
      label: "markdown channel export",
    });

    await evaluate(cdp, `
      (() => {
        const channels = JSON.parse(localStorage.getItem('autohandSquad.v1.channels') || '[]');
        const channel = channels.find((item) => item.name === ${JSON.stringify(verifyChannelName)});
        const threads = JSON.parse(localStorage.getItem('autohandSquad.v1.channelThreads') || '{}');
        const messages = JSON.parse(localStorage.getItem('autohandSquad.v1.channelMessages') || '{}');
        const archivedThread = {
          id: 'thread_missing_messages',
          channelId: channel.id,
          parentMessageId: 'thread_missing_messages-root',
          title: 'Archived pie shop handoff',
          creatorId: 'verify',
          autoMode: false,
          selfJudge: false,
          replyCount: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        threads[channel.id] = [...(threads[channel.id] || []).filter((item) => item.id !== archivedThread.id), archivedThread];
        messages[channel.id] = (messages[channel.id] || []).filter((item) => item.threadId !== archivedThread.id);
        localStorage.setItem('autohandSquad.v1.channelThreads', JSON.stringify(threads));
        localStorage.setItem('autohandSquad.v1.channelMessages', JSON.stringify(messages));
        localStorage.setItem('autohandChannelVerify.preserve', 'true');
        location.href = '/channels/' + channel.id;
      })()
    `);

    const missingMessageThread = await waitFor(() => evaluate(cdp, `
      (() => {
        const main = document.querySelector('main')?.innerText || '';
        return {
          ok: main.includes('Archived pie shop handoff') && main.includes('2 replies were recorded in this thread'),
          main: main.slice(0, 1600),
        };
      })()
    `).then((value) => value?.ok ? value : null), {
      timeoutMs: 12000,
      intervalMs: 250,
      label: "persisted thread fallback copy",
    }).catch((error) => {
      throw new Error(`Persisted thread fallback was not visible: ${error.message}`);
    });

    if (screenshotPath) {
      await waitFor(() => evaluate(cdp, `!document.getElementById('boot')`), { label: 'startup overlay removed' });
      await mkdir(join(screenshotPath, ".."), { recursive: true }).catch(() => {});
      const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
    }

    console.log(JSON.stringify({
      ok: true,
      busyPresence: busyPresence.ok,
      channelId: verification.channel.id,
      channelName: verification.channel.name,
      members: verification.channel.memberIds,
      targetedMention: {
        requestMemberIds: targetedDispatch.targetedRequest.memberIds,
        replyCount: targetedDispatch.channelMessages.filter((item) => item.role === "agent" && item.status === "complete").length,
      },
      requests: verification.requestSummary,
      threadCount: verification.channelThreads.length,
      replyCount: verification.messages.filter((item) => item.role === "agent" && item.status === "complete").length,
      markdownExport: {
        filename: markdownExport.filename,
        bytes: markdownExport.text.length,
      },
      inlineThreads: { replyCount: inlineThreadProbe.replyCount, avatarCount: inlineThreadProbe.avatarCount, cancelledSelectionPreservesDraft: cancelledThreadProbe.ok },
      persistedThreadFallback: missingMessageThread.ok,
      screenshotPath,
      url: `${baseUrl}/channels/${verification.channel.id}`,
    }, null, 2));
    cdp.close();
  } finally {
    server?.kill("SIGTERM");
    await rm(serverStateDir, { recursive: true, force: true }).catch(() => {});
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
