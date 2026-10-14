import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
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
  console.log(
    "Mac update fixture passed: real DMG mount/signature/staging, real native atomic exchange and opener-failure restore, version refusal, identity-checked service shutdown. No installed app or user work was changed; launch was mocked.",
  );
} finally {
  for (const child of children) child.kill("SIGTERM");
  await rm(dir, { recursive: true, force: true });
}
