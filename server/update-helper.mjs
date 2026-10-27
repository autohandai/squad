// Private, detached replacement worker. It waits for the native app to close;
// it never kills the window or changes user data and keeps the old bundle.
import { readFile, rename, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  replaceMacApp,
  validateMacBundle,
  stopOwnedUpdateServices,
} from "./mac-update.mjs";
const exec = promisify(execFile);
const plan = JSON.parse(await readFile(process.argv[2], "utf8"));
async function save(phase, error = "") {
  const value = JSON.parse(await readFile(plan.statePath, "utf8"));
  await writeFile(
    `${plan.statePath}.helper`,
    JSON.stringify({
      ...value,
      phase,
      error,
      updatedAt: new Date().toISOString(),
      backup: plan.backup,
    }),
    { mode: 0o600 },
  );
  await rename(`${plan.statePath}.helper`, plan.statePath);
}
try {
  await replaceMacApp(plan, {
    async waitForExit(pid) {
      for (let n = 0; n < 240; n++) {
        try {
          process.kill(pid, 0);
        } catch (e) {
          if (e.code === "ESRCH") return;
          throw e;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      throw Error(
        "Squad did not close. The current app was left in place; try installing again.",
      );
    },
    async stop(app) {
      await stopOwnedUpdateServices(plan);
      await save("installing");
    },
    validate: (app, version, current) =>
      validateMacBundle(app, version, current, {
        signal: AbortSignal.timeout(120_000),
      }),
    async swap(app, stage) {
      await exec(
        join(app, "Contents/MacOS/autohand-squad"),
        ["--squad-swap-update", app, stage],
        { timeout: 30_000 },
      );
    },
    async open(app) {
      await save("restarting");
      await exec("/usr/bin/open", ["-n", app], { timeout: 15_000 });
    },
  });
} catch (error) {
  // Keep executable commands and recovery paths in private diagnostics, not the sidebar.
  await writeFile(join(plan.statePath, "..", "install-diagnostics.json"), JSON.stringify({
    at: new Date().toISOString(), message: error.message, stderr: error.stderr || "", plan,
  }), { mode: 0o600 }).catch(() => {});
  const details = `${error.message}\n${error.stderr || ""}`;
  const recoveryFailed = /restore failed|restore.*failed|rollback.*failed/i.test(details);
  await save(
    "failed",
    recoveryFailed
      ? "Automatic installation could not restore the previous app. Recovery bundles were retained; see install-diagnostics.json in the updates folder. Your saved data is unchanged."
      : /Operation not permitted|Permission denied|EACCES|EPERM/i.test(details)
        ? "macOS blocked automatic installation. Open the verified installer to finish updating. Your saved data is unchanged."
        : "Automatic installation could not finish. Open the verified installer to finish updating. Your saved data is unchanged.",
  ).catch(() => {});
  await exec("/usr/bin/open", ["-n", plan.app], { timeout: 15_000 }).catch(
    () => {},
  );
}
