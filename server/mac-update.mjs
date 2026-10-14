import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile);
const run = (command, args, options = {}) =>
  exec(command, args, {
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    ...options,
  });
export async function macUpdateCapability({
  platform = process.platform,
  env = process.env,
  serviceStateDir,
} = {}) {
  const app = env.AUTOHAND_SQUAD_DESKTOP_APP;
  if (platform !== "darwin" || !app?.endsWith("/Autohand Squad.app"))
    return null;
  try {
    await access(dirname(app), constants.W_OK);
    await access(join(app, "Contents/MacOS/squad"), constants.X_OK);
    // A healthy bridge can outlive a Quit/reopen. Never reuse an inherited
    // controller PID: resolve the exact running executable every time.
    const exe = join(resolve(app), "Contents/MacOS/autohand-squad");
    const processes = (await run("/bin/ps", ["-Ao", "pid=,ppid=,comm="]))
      .stdout;
    const rows = processes
      .split("\n")
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/));
    const matches = rows.filter((match) => match?.[3] === exe);
    if (matches.length !== 1) return null;
    const services = [{ pid: process.pid, exe: process.execPath }];
    if (!serviceStateDir) return null;
    for (const [file, name] of [
      ["daemon.json", "autohand-squad-daemon"],
      ["analytics.json", "autohand-squad-analytics"],
    ]) {
      let record;
      try {
        record = JSON.parse(
          await readFile(join(serviceStateDir, file), "utf8"),
        );
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if (!record?.pid) continue;
      const serviceExe = join(resolve(app), "Contents/MacOS", name);
      const held = rows.find(
        (match) => Number(match?.[1]) === Number(record.pid),
      );
      if (held && held[3] !== serviceExe) return null;
      if (held)
        services.push({
          pid: Number(record.pid),
          exe: serviceExe,
          url: localServiceUrl(record.url),
        });
    }
    const nativePid = Number(matches[0][1]);
    const allowed = new Set([
      nativePid,
      ...services.map((service) => service.pid),
    ]);
    function owned(pid) {
      const visited = new Set();
      while (pid > 1 && !visited.has(pid)) {
        if (allowed.has(pid)) return true;
        visited.add(pid);
        const record = rows.find((row) => Number(row?.[1]) === pid);
        pid = Number(record?.[2]);
      }
      return false;
    }
    if (
      rows.some(
        (row) =>
          row?.[3].startsWith(`${resolve(app)}/Contents/MacOS/`) &&
          !owned(Number(row[1])),
      )
    )
      return null;
    return { app: resolve(app), pid: nativePid, services };
  } catch {
    return null;
  }
}
async function plist(app, key, signal) {
  return (
    await run(
      "/usr/bin/plutil",
      ["-extract", key, "raw", "-o", "-", join(app, "Contents/Info.plist")],
      { signal },
    )
  ).stdout.trim();
}
async function team(app, signal) {
  const r = await run("/usr/bin/codesign", ["-dv", "--verbose=4", app], {
    signal,
  });
  return r.stderr.match(/^TeamIdentifier=(.*)$/m)?.[1] || "not set";
}
export async function validateMacBundle(
  app,
  version,
  currentApp,
  { signal } = {},
) {
  if (
    (await plist(app, "CFBundleIdentifier", signal)) !== "ai.autohand.squad" ||
    (await plist(app, "CFBundleShortVersionString", signal)) !== version
  )
    throw Error(
      "The update bundle does not match Squad or the selected version.",
    );
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], {
    signal,
  });
  const currentTeam = await team(currentApp, signal);
  const nextTeam = await team(app, signal);
  if (currentTeam !== "not set" && nextTeam !== currentTeam)
    throw Error("The update is signed by a different developer.");
  await access(join(app, "Contents/MacOS/autohand-squad"), constants.X_OK);
  await access(join(app, "Contents/MacOS/node"), constants.X_OK);
}
export async function prepareMacUpdate({ installer, capability, statePath }) {
  const mount = await mkdtemp(join(dirname(statePath), ".mount-"));
  const signal = AbortSignal.timeout(120_000);
  let stage;
  let attached = false;
  try {
    await run(
      "/usr/bin/hdiutil",
      [
        "attach",
        installer.path,
        "-readonly",
        "-nobrowse",
        "-mountpoint",
        mount,
      ],
      { signal },
    );
    attached = true;
    const source = join(mount, "Autohand Squad.app");
    await validateMacBundle(source, installer.version, capability.app, {
      signal,
    });
    const parent = await mkdtemp(
      join(dirname(capability.app), ".Autohand-Squad-update-"),
    );
    stage = join(parent, "Autohand Squad.app");
    await run("/usr/bin/ditto", [source, stage], { signal });
    await validateMacBundle(stage, installer.version, capability.app, {
      signal,
    });
    return {
      app: capability.app,
      services: capability.services,
      pid: capability.pid,
      stage,
      backup: stage,
      statePath,
      version: installer.version,
    };
  } catch (error) {
    if (stage) await rm(dirname(stage), { recursive: true, force: true });
    throw error;
  } finally {
    if (attached)
      await run("/usr/bin/hdiutil", ["detach", mount], {
        timeout: 15_000,
      }).catch(() => {});
    await rm(mount, { recursive: true, force: true });
  }
}
export async function launchMacUpdate(plan) {
  const planPath = join(dirname(plan.statePath), "install-plan.json");
  await writeFile(planPath, JSON.stringify(plan), { mode: 0o600 });
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./update-helper.mjs", import.meta.url)), planPath],
    { detached: true, stdio: "ignore", windowsHide: true, shell: false },
  );
  await new Promise((res, rej) => {
    child.once("error", rej);
    child.once("spawn", res);
  });
  child.unref();
}
// Replacement is performed only after the native process exits. The previous
// bundle stays beside the replacement until a later successful update.
export async function replaceMacApp(
  plan,
  { waitForExit, stop, validate, open, swap, move = rename } = {},
) {
  await waitForExit(plan.pid);
  await stop(plan.app);
  await validate(plan.stage, plan.version, plan.app);
  await swap(plan.app, plan.stage);
  try {
    await open(plan.app);
  } catch (error) {
    await swap(plan.app, plan.stage);
    await open(plan.app).catch(() => {});
    throw error;
  }
  return { backup: plan.stage };
}

export async function stopOwnedUpdateServices(plan) {
  const processes = (await run("/bin/ps", ["-Ao", "pid=,comm="])).stdout
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(.+)$/));
  // Stop supervisors first, then the bridge; each receives its normal SIGTERM.
  const ordered = [...plan.services].sort(
    (a, b) => Number(a.exe.endsWith("/node")) - Number(b.exe.endsWith("/node")),
  );
  for (const service of ordered) {
    const held = processes.find((match) => Number(match?.[1]) === service.pid);
    if (!held) continue;
    if (held[2] !== service.exe || service.pid === process.pid)
      throw Error(
        "An update service changed identity. Squad was left in place.",
      );
    if (service.url) {
      try {
        await fetch(`${localServiceUrl(service.url)}/stop`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        /* Service shutdown may close its response; the PID check below is decisive. */
      }
    } else {
      try {
        process.kill(service.pid, "SIGTERM");
      } catch (e) {
        if (e.code !== "ESRCH") throw e;
      }
    }
    let closed = false;
    for (let n = 0; n < 100; n++) {
      try {
        process.kill(service.pid, 0);
      } catch (e) {
        if (e.code === "ESRCH") {
          closed = true;
          break;
        }
        throw e;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!closed)
      throw Error(
        "A Squad service did not stop. The current app was left in place.",
      );
  }
  const remaining = (await run("/bin/ps", ["-Ao", "pid=,comm="])).stdout
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(.+)$/));
  if (
    remaining.some(
      (row) =>
        Number(row?.[1]) !== process.pid &&
        row?.[2].startsWith(`${plan.app}/Contents/MacOS/`),
    )
  )
    throw Error(
      "A Squad process is still using this app. The current bundle was left in place.",
    );
}

export function localServiceUrl(value) {
  const url = new URL(String(value));
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error("The update service must be on this computer.");
  return url.origin;
}
export async function updateDaemonAdmission({ stateDir, token, pause }) {
  const record = JSON.parse(
    await readFile(join(stateDir, "daemon.json"), "utf8"),
  );
  const base = localServiceUrl(record.url);
  const response = await fetch(
    `${base}/updates/${pause ? "pause" : "resume"}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    },
  );
  const data = await response.json();
  if (!response.ok || data.success !== true)
    throw Object.assign(
      Error(data.error || "Could not pause the update service."),
      { status: 409 },
    );
  return data;
}
