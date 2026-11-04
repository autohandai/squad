import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { stop, until } from "./reliability-browser.mjs";
import { writeSystemSettings } from "../../server/system/settings.mjs";

const execute = promisify(execFile);
export async function startSupervisedBridge() {
  const directory = await mkdtemp(join(tmpdir(), "squad-reset-supervisor-"));
  const home = join(directory, "home");
  const state = join(directory, "squad");
  const app = join(directory, "app");
  const config = join(directory, "config.json");
  await Promise.all([mkdir(home), mkdir(state), mkdir(app)]);
  await writeFile(config, JSON.stringify({ provider: "autohandai", auth: { token: "fixture-only-no-provider", email: "reset@example.test", expiresAt: "2099-01-01T00:00:00Z" } }));
  await writeSystemSettings(state, { autoCheckUpdates: false, autoDownloadUpdates: false });
  const preload = join(directory, "isolate-home.mjs");
  await writeFile(preload, `import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module'; os.homedir=()=>${JSON.stringify(home)}; syncBuiltinESMExports();\n`);
  const binaries = process.env.AUTOHAND_SQUAD_TEST_BIN_DIR || resolve("daemon/target/debug");
  const suffix = process.platform === "win32" ? ".exe" : "";
  const cli = join(binaries, `squad${suffix}`);
  const daemonPath = join(binaries, `autohand-squad-daemon${suffix}`);
  assert.ok(existsSync(cli) && existsSync(daemonPath), "Build the runtime binaries before the supervised reset check.");
  const env = { ...process.env, AUTOHAND_SQUAD_HOME: state, AUTOHAND_SQUAD_APP_STATE_DIR: app, AUTOHAND_HOME: join(directory, "autohand"), AUTOHAND_USER_CONFIG_PATH: config, AUTOHAND_SQUAD_NODE: process.execPath, AUTOHAND_SQUAD_API_BASE_URL: "mock://offline", AUTOHAND_SQUAD_TELEMETRY_POLICY: "disabled", AUTOHAND_SQUAD_COMPUTER_USE: "bundled", AUTOHAND_SQUAD_COMPUTER_USE_RUNTIME_DIR: directory, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${pathToFileURL(preload).href}`.trim() };
  const daemon = spawn(daemonPath, ["--host", "127.0.0.1", "--port", "0", "--api-base-url", "mock://offline", "--telemetry-policy", "disabled"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  daemon.stdout.on("data", bytes => { logs += bytes; });
  daemon.stderr.on("data", bytes => { logs += bytes; });
  const children = new Set();
  let origin;
  const request = async (path, method = "GET", body) => {
    const response = await fetch(origin + path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(1500) });
    return { status: response.status, ...await response.json() };
  };
  const remember = async root => {
    try { const record = JSON.parse(await readFile(join(root, "web-server.json"), "utf8")); if (record.pid) children.add(record.pid); } catch {}
  };
  const close = async () => {
    await stop(daemon);
    await remember(state);
    for (const item of await readdir(directory)) if (item.startsWith("squad.reset-")) await remember(join(directory, item));
    for (const pid of children) { try { process.kill(pid, "SIGTERM"); } catch {} }
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
    await until(async () => JSON.parse(await readFile(join(state, "daemon.json"), "utf8")).pid === daemon.pid, "isolated daemon ready", 15000);
    const listener = createServer();
    await new Promise((done, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", done); });
    const port = listener.address().port;
    await new Promise(done => listener.close(done));
    origin = `http://127.0.0.1:${port}`;
    await execute(cli, ["--host", "127.0.0.1", "serve", "--server-path", resolve("server.mjs"), "--dev", "--web-port", String(port)], { env, timeout: 30000 });
    await until(async () => (await request("/api/health")).success, "supervised bridge ready", 30000);
    await remember(state);
    const runtime = (await request("/api/runtime")).data;
    assert.equal(runtime.squadWorkspaceRoot, join(home, ".autohandsquad"), "Refuse reset unless the child managed workspace root is isolated.");
    return { directory, home, state, app, config, origin, request, daemon, close, get logs() { return logs; } };
  } catch (error) {
    await close();
    throw new Error(`${error.message}\n${logs}`);
  }
}
