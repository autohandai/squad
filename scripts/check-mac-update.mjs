import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  chmod,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  isExternalMcpClient,
  macUpdateCapability,
  prepareMacUpdate,
  replaceMacApp,
  validateMacBundle,
  stopOwnedUpdateServices,
} from "../server/mac-update.mjs";
if (process.platform !== "darwin") {
  console.log("Mac update fixture skipped on this platform.");
  process.exit(0);
}
const exec = promisify(execFile);
const run = (cmd, args) =>
  exec(cmd, args, { timeout: 120_000, maxBuffer: 1024 * 1024 });
const native = resolve(
  process.env.SQUAD_UPDATE_NATIVE ||
    "src-tauri/target/release/bundle/macos/Autohand Squad.app/Contents/MacOS/autohand-squad",
);
const dir = await mkdtemp(join(tmpdir(), "squad-mac-update-"));
const children = [];
const foreign = [];
async function bundle(root, version, marker) {
  const app = join(root, "Autohand Squad.app");
  await mkdir(join(app, "Contents/MacOS"), { recursive: true });
  await cp(native, join(app, "Contents/MacOS/autohand-squad"));
  for (const name of ["node", "squad"]) {
    await writeFile(join(app, "Contents/MacOS", name), "#!/bin/sh\nexit 0\n");
    await chmod(join(app, "Contents/MacOS", name), 0o755);
  }
  await writeFile(
    join(app, "Contents/Info.plist"),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>ai.autohand.squad</string><key>CFBundleExecutable</key><string>autohand-squad</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>${version}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`,
  );
  await writeFile(join(app, "Contents/marker"), marker);
  await run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", app]);
  return app;
}
async function stage(current, version, marker, index) {
  const source = join(dir, `source-${index}`);
  await bundle(source, version, marker);
  const dmg = join(dir, `update-${index}.dmg`);
  await run("/usr/bin/hdiutil", [
    "create",
    "-srcfolder",
    source,
    "-format",
    "UDZO",
    dmg,
  ]);
  return prepareMacUpdate({
    installer: { path: dmg, version },
    capability: { app: current, pid: 12345, services: [] },
    statePath: join(dir, "state", "operation.json"),
  });
}
try {
  await mkdir(join(dir, "state"));
  const current = await bundle(join(dir, "installed"), "0.1.6", "old");
  const plan = await stage(current, "0.1.7", "new", 1);
  const swap = (app, stage) =>
    run(join(app, "Contents/MacOS/autohand-squad"), [
      "--squad-swap-update",
      app,
      stage,
    ]);
  const callbacks = {
    waitForExit: async () => {},
    stop: async () => {},
    validate: validateMacBundle,
    swap,
    open: async (app) => {
      assert.equal(await readFile(join(app, "Contents/marker"), "utf8"), "new");
    },
  };
  const result = await replaceMacApp(plan, callbacks);
  assert.equal(await readFile(join(current, "Contents/marker"), "utf8"), "new");
  assert.equal(
    await readFile(join(result.backup, "Contents/marker"), "utf8"),
    "old",
  );
  const retry = await stage(current, "0.1.8", "broken", 2);
  let opens = 0;
  await assert.rejects(
    replaceMacApp(retry, {
      ...callbacks,
      open: async () => {
        if (++opens === 1) throw Error("fixture opener failed");
      },
    }),
    /fixture opener failed/,
  );
  assert.equal(opens, 2);
  assert.equal(await readFile(join(current, "Contents/marker"), "utf8"), "new");
  await assert.rejects(
    validateMacBundle(retry.stage, "0.1.99", current),
    /does not match/,
  );
  // Real signals reach only a deliberately created, identity-matched fixture child.
  const owned = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
  });
  children.push(owned);
  const other = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
  });
  children.push(other);
  await new Promise((r) => setTimeout(r, 100));
  await assert.rejects(
    stopOwnedUpdateServices({
      app: current,
      services: [{ pid: owned.pid, exe: "/incorrect/identity" }],
    }),
    /changed identity/,
  );
  process.kill(owned.pid, 0);
  await stopOwnedUpdateServices({
    app: current,
    services: [{ pid: owned.pid, exe: process.execPath }],
  });
  process.kill(other.pid, 0);
  // ADR-0277: another app using Squad's MCP server runs the bundle's node
  // outside Squad's process tree. It must not hold Squad on the old version;
  // any other foreign process from the bundle still must.
  const host = join(dir, "host", "Autohand Squad.app");
  const macos = join(host, "Contents/MacOS");
  const runtime = join(host, "Contents/Resources/runtime/server");
  await mkdir(macos, { recursive: true });
  await mkdir(join(runtime, "control-plane"), { recursive: true });
  for (const name of ["node", "autohand-squad"]) {
    await link(process.execPath, join(macos, name)).catch(() =>
      cp(process.execPath, join(macos, name)),
    );
  }
  await writeFile(join(macos, "squad"), "#!/bin/sh\nexit 0\n");
  await chmod(join(macos, "squad"), 0o755);
  const idle = "setInterval(()=>{},1000)";
  await writeFile(join(runtime, "control-plane/mcp-server.mjs"), idle);
  await writeFile(join(runtime, "other.mjs"), idle);
  assert.equal(isExternalMcpClient(host, `${macos}/node ${runtime}/control-plane/mcp-server.mjs --bridge http://127.0.0.1:19821`), true);
  assert.equal(isExternalMcpClient(host, `${macos}/node ${runtime}/team/mcp-server.mjs --mcp`), true);
  assert.equal(isExternalMcpClient(host, `${macos}/node ${runtime}/other.mjs`), false);
  assert.equal(isExternalMcpClient(host, `${macos}/node ${runtime}/../../../evil/mcp-server.mjs`), false);
  assert.equal(isExternalMcpClient(host, `${macos}/autohand-squad ${runtime}/control-plane/mcp-server.mjs`), false);
  // Started through a shell that exits at once, so each process belongs to
  // launchd like one started by another app, not to this (bridge-like) check.
  const start = async (exe, args) => {
    const { stdout } = await run("/bin/sh", ["-c", '"$0" "$@" >/dev/null 2>&1 & echo $!', join(macos, exe), ...args]);
    const pid = Number(stdout.trim());
    foreign.push(pid);
    return pid;
  };
  const gone = async (pid) => {
    for (let n = 0; n < 50; n++) {
      try { process.kill(pid, 0); } catch { return; }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error(`fixture process ${pid} did not exit`);
  };
  const app = await start("autohand-squad", ["-e", idle]);
  const client = await start("node", [join(runtime, "control-plane/mcp-server.mjs"), "--bridge", "http://127.0.0.1:19821"]);
  await new Promise((r) => setTimeout(r, 300));
  const services = join(dir, "services");
  await mkdir(services, { recursive: true });
  const env = { AUTOHAND_SQUAD_DESKTOP_APP: host };
  const capability = await macUpdateCapability({ env, serviceStateDir: services });
  assert.ok(capability, "an external MCP client must not block Install and restart");
  // The helper swaps only after the native app has exited.
  process.kill(app, "SIGTERM");
  await gone(app);
  await stopOwnedUpdateServices({ app: host, services: [] });
  process.kill(client, 0);
  await start("autohand-squad", ["-e", idle]);
  await start("node", [join(runtime, "other.mjs")]);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await macUpdateCapability({ env, serviceStateDir: services }), null);
  await assert.rejects(stopOwnedUpdateServices({ app: host, services: [] }), /still using this app/);
  console.log(
    "Mac update fixture passed: real DMG mount/signature/staging, real native atomic exchange and opener-failure restore, version refusal, identity-checked service shutdown, external MCP clients do not block in-place install while other bundle processes do. No installed app or user work was changed; launch was mocked.",
  );
} finally {
  for (const child of children) child.kill("SIGTERM");
  for (const pid of foreign) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  await rm(dir, { recursive: true, force: true });
}
