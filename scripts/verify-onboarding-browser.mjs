import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const baseUrl = (process.env.AUTOHAND_SQUAD_URL || "http://127.0.0.1:19821").replace(/\/+$/, "");
const chromePath = process.env.CHROME_PATH || process.env.AUTOHAND_SQUAD_CHROME_PATH || findChromePath();
const artifactDir = join(process.cwd(), ".codex-artifacts");
const serverHost = "127.0.0.1";
const serverPort = new URL(baseUrl).port || "19821";

if (typeof WebSocket === "undefined") {
  throw new Error("This verifier requires a Node runtime with global WebSocket support.");
}

function findChromePath() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

class CdpConnection {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.ws = new WebSocket(wsUrl);
    this.opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting to ${wsUrl}`)), 10_000);
      this.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`Could not connect to ${wsUrl}`));
      });
    });
    this.ws.addEventListener("message", (event) => this.handleMessage(event));
  }

  handleMessage(event) {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`${pending.method} failed: ${message.error.message}`));
    } else {
      pending.resolve(message.result || {});
    }
  }

  async send(method, params = {}, sessionId = undefined) {
    await this.opened;
    const id = this.nextId++;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 15_000);
    });
    this.ws.send(JSON.stringify(payload));
    return promise;
  }

  close() {
    this.ws.close();
  }
}

async function waitForHttp(url, timeoutMs = 10_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return true;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw lastError || new Error(`${url} did not become available`);
}

async function ensureServer({ signedIn = false } = {}) {
  const serverStateDir = await mkdtemp(join(tmpdir(), "autohand-squad-server-"));
  const userConfigPath = join(serverStateDir, "user-config.json");
  if (signedIn) {
    await writeFile(
      userConfigPath,
      JSON.stringify(
        { auth: { token: "browser-verifier-token", email: "beta@example.com", expiresAt: "2099-01-01T00:00:00.000Z" } },
        null,
        2
      ),
      "utf8"
    );
  }

  const child = spawn(process.execPath, ["server.mjs", "--host", serverHost, "--port", serverPort], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      AUTOHAND_HOME: join(serverStateDir, "autohand-home"),
      AUTOHAND_SQUAD_HOME: join(serverStateDir, "squad-home"),
      AUTOHAND_USER_CONFIG_PATH: userConfigPath,
    },
  });
  child.stateDir = serverStateDir;
  const logs = collectLogs(child);
  await waitForHttp(`${baseUrl}/api/runtime`, 15_000).catch((error) => {
    child.kill("SIGTERM");
    throw new Error(`Could not start preview server: ${error.message}\n${logs()}`);
  });
  return child;
}

function collectLogs(child) {
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  return () => output.trim();
}

async function launchChrome() {
  if (!existsSync(chromePath)) {
    throw new Error(`Chrome executable not found at ${chromePath}. Set CHROME_PATH to override.`);
  }
  const profileDir = await mkdtemp(join(tmpdir(), "autohand-squad-onboarding-"));
  const profileTmp = join(profileDir, "tmp");
  const crashDir = join(profileDir, "crashes");
  await mkdir(profileTmp, { recursive: true });
  await mkdir(crashDir, { recursive: true });

  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      `--crash-dumps-dir=${crashDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-extensions",
      "--disable-gpu",
      "--disable-crash-reporter",
      "--hide-scrollbars",
      "--window-size=1440,1100",
      "about:blank",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HOME: profileDir,
        TMPDIR: profileTmp,
      },
    }
  );
  const logs = collectLogs(child);
  const portFile = join(profileDir, "DevToolsActivePort");
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (existsSync(portFile)) {
      const [port, path] = (await readFile(portFile, "utf8")).trim().split("\n");
      return {
        child,
        profileDir,
        wsUrl: `ws://127.0.0.1:${port}${path}`,
      };
    }
    if (child.exitCode !== null) {
      throw new Error(`Chrome exited before DevTools was ready.\n${logs()}`);
    }
    await delay(100);
  }
  child.kill("SIGTERM");
  throw new Error(`Chrome DevTools port did not become ready.\n${logs()}`);
}

async function createPage(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  return sessionId;
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    },
    sessionId
  );
  if (result.exceptionDetails) {
    throw new Error(`Browser evaluation failed: ${result.exceptionDetails.text}`);
  }
  return result.result?.value;
}

async function navigate(cdp, sessionId, path) {
  await cdp.send("Page.navigate", { url: `${baseUrl}${path}` }, sessionId);
  await waitFor(cdp, sessionId, "document.readyState === 'complete'", `load ${path}`);
}

async function waitFor(cdp, sessionId, expression, label, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await evaluate(cdp, sessionId, `Boolean(${expression})`).catch(() => false);
    if (value) return true;
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function bodyText(cdp, sessionId) {
  return evaluate(cdp, sessionId, "document.body.innerText");
}

async function assertText(cdp, sessionId, text) {
  const currentText = await bodyText(cdp, sessionId);
  if (!String(currentText).includes(text)) {
    throw new Error(`Expected page text to include ${JSON.stringify(text)}.`);
  }
}

async function waitForText(cdp, sessionId, text) {
  await waitFor(
    cdp,
    sessionId,
    `document.body.innerText.includes(${JSON.stringify(text)})`,
    `text ${text}`
  );
}

async function assertAnyText(cdp, sessionId, texts) {
  const currentText = String(await bodyText(cdp, sessionId));
  if (!texts.some((text) => currentText.includes(text))) {
    throw new Error(`Expected page text to include one of: ${texts.map((text) => JSON.stringify(text)).join(", ")}.`);
  }
}

async function clickByText(cdp, sessionId, text) {
  const clicked = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const wanted = ${JSON.stringify(text)};
      const elements = Array.from(document.querySelectorAll('button, [role="menuitem"], a'));
      const target = elements.find((element) => {
        const label = element.getAttribute('aria-label') || '';
        const content = (element.innerText || element.textContent || '').trim();
        return label === wanted || content.includes(wanted);
      });
      if (!target) return false;
      target.click();
      return true;
    })()`
  );
  if (!clicked) {
    throw new Error(`Could not find clickable element ${JSON.stringify(text)}.`);
  }
}

async function assertPath(cdp, sessionId, path) {
  await waitFor(cdp, sessionId, `location.pathname === ${JSON.stringify(path)}`, `path ${path}`);
}

async function screenshot(cdp, sessionId, name) {
  await mkdir(artifactDir, { recursive: true });
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId);
  const path = join(artifactDir, name);
  await writeFile(path, Buffer.from(result.data, "base64"));
  return path;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function terminate(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function cleanupServer(server) {
  await terminate(server);
  if (server?.stateDir) {
    await rm(server.stateDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
  }
}

async function withBrowser(serverOptions, run) {
  const server = await ensureServer(serverOptions);
  let chrome = null;
  let cdp = null;
  try {
    chrome = await launchChrome();
    cdp = new CdpConnection(chrome.wsUrl);
    const sessionId = await createPage(cdp);
    return await run(cdp, sessionId);
  } finally {
    cdp?.close();
    await terminate(chrome?.child);
    if (chrome?.profileDir) {
      try {
        await rm(chrome.profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (error) {
        console.warn(`Warning: could not remove temporary Chrome profile ${chrome.profileDir}: ${error.message}`);
      }
    }
    await cleanupServer(server);
  }
}

async function verifySignedOutGate() {
  return withBrowser({ signedIn: false }, async (cdp, sessionId) => {
    await navigate(cdp, sessionId, "/");
    await assertPath(cdp, sessionId, "/welcome");
    await assertText(cdp, sessionId, "Set up the squad before the first run.");
    await assertText(cdp, sessionId, "Open browser login");
    await assertText(cdp, sessionId, "Public beta access requires an Autohand account.");
    const skipDisabled = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const button = Array.from(document.querySelectorAll('button')).find((element) => (element.innerText || '').includes('Skip for now'));
        return Boolean(button?.disabled);
      })()`
    );
    if (!skipDisabled) throw new Error("Skip must be disabled while signed out.");
    await navigate(cdp, sessionId, "/squad");
    await assertPath(cdp, sessionId, "/welcome");
    return screenshot(cdp, sessionId, "onboarding-browser-signed-out-gate.png");
  });
}

async function verifySignedInFlow() {
  return withBrowser({ signedIn: true }, async (cdp, sessionId) => {
    await navigate(cdp, sessionId, "/");
    await assertPath(cdp, sessionId, "/welcome");
    await assertText(cdp, sessionId, "Set up the squad before the first run.");
    await assertText(cdp, sessionId, "Signed in");
    await assertAnyText(cdp, sessionId, ["Configure provider", "Review provider settings"]);
    const welcomeShot = await screenshot(cdp, sessionId, "onboarding-browser-welcome.png");

    await clickByText(cdp, sessionId, "Skip for now");
    await assertPath(cdp, sessionId, "/squad");
    await waitFor(cdp, sessionId, "localStorage.getItem('autohandSquad.v1.onboarding')?.includes('skipped')", "skipped onboarding state");
    await assertText(cdp, sessionId, "Autohand Squad");
    const squadShot = await screenshot(cdp, sessionId, "onboarding-browser-squad.png");

    await navigate(cdp, sessionId, "/");
    await assertPath(cdp, sessionId, "/squad");
    await clickByText(cdp, sessionId, "Open account menu");
    await clickByText(cdp, sessionId, "Setup guide");
    await assertPath(cdp, sessionId, "/welcome");

    const providerButtonText = String(await bodyText(cdp, sessionId)).includes("Configure provider")
      ? "Configure provider"
      : "Review provider settings";
    await clickByText(cdp, sessionId, providerButtonText);
    await assertPath(cdp, sessionId, "/settings");
    await assertText(cdp, sessionId, "LLM Providers");
    await waitFor(
      cdp,
      sessionId,
      "(() => { const rect = document.getElementById('settings-providers')?.getBoundingClientRect(); return rect && rect.top >= 0 && rect.top < 220; })()",
      "settings provider section"
    );
    await waitForText(cdp, sessionId, "Workspace default");
    await waitForText(cdp, sessionId, "Default model");
    const settingsShot = await screenshot(cdp, sessionId, "onboarding-browser-settings.png");
    return { welcomeShot, squadShot, settingsShot };
  });
}

async function main() {
  const signedOutShot = await verifySignedOutGate();
  const { welcomeShot, squadShot, settingsShot } = await verifySignedInFlow();
  console.log("Browser onboarding verification passed.");
  console.log(`- ${signedOutShot}`);
  console.log(`- ${welcomeShot}`);
  console.log(`- ${squadShot}`);
  console.log(`- ${settingsShot}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
