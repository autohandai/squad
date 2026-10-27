import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { reconcileUpdateOperation } from "../src/lib/update-version.js";
import {
  upgradeDesktop,
  openDesktopTarget,
  verifiedInstaller,
} from "./desktop-updates.mjs";
import {
  macUpdateCapability,
  prepareMacUpdate,
  launchMacUpdate,
} from "./mac-update.mjs";
const ACTIVE = new Set([
  "checking",
  "downloading",
  "verifying",
  "preparing",
  "installing",
  "restarting",
]);
const fail = (message, status = 409) =>
  Object.assign(Error(message), { status });
export function createUpdateFlow({
  appStateDir,
  appVersion = "",
  serviceStateDir,
  checkFresh,
  platform = process.platform,
  arch = process.arch,
  fetchImpl = fetch,
  openImpl = openDesktopTarget,
  canRestart = async () => true,
  capabilityImpl = macUpdateCapability,
  prepareImpl = prepareMacUpdate,
  launchImpl = launchMacUpdate,
} = {}) {
  const statePath = join(appStateDir, "updates", "operation.json");
  let state = { phase: "idle" };
  let controller;
  let writing = Promise.resolve();
  let lastSaved = 0;
  let installBusy = false;
  let loaded = false;
  let loadPromise;
  function publish(change, force = false) {
    state = { ...state, ...change, updatedAt: new Date().toISOString() };
    if (force || Date.now() - lastSaved > 250) {
      lastSaved = Date.now();
      const saved = JSON.stringify(state);
      writing = writing
        .catch(() => {})
        .then(async () => {
          await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
          await writeFile(`${statePath}.tmp`, saved, { mode: 0o600 });
          await rename(`${statePath}.tmp`, statePath);
        });
    }
  }
  async function load() {
    if (loaded) return state;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      let saved;
      try {
        saved = JSON.parse(await readFile(statePath, "utf8"));
      } catch (e) {
        if (e.code !== "ENOENT")
          saved = {
            phase: "failed",
            error: "The saved update could not be read. Download it again.",
          };
      }
      if (saved) {
        state = saved;
        reconcileInstalled();
        if (ACTIVE.has(state.phase))
          publish(
            {
              phase: "failed",
              error:
                "The update was interrupted. Your saved work is intact; try again.",
            },
            true,
          );
      }
      loaded = true;
      await writing;
      return state;
    })();
    return loadPromise;
  }
  async function start() {
    await load();
    if (installBusy || ACTIVE.has(state.phase))
      throw fail("An update is already in progress.");
    controller = new AbortController();
    state = { phase: "checking" };
    publish({ phase: "checking", bytes: 0, totalBytes: null, error: "" }, true);
    const signal = controller.signal;
    void (async () => {
      try {
        const installer = await upgradeDesktop({
          appStateDir,
          checkFresh,
          platform,
          arch,
          fetchImpl,
          openAfterDownload: false,
          signal,
          onProgress: publish,
        });
        signal.throwIfAborted();
        const capability = await capabilityImpl({ platform, serviceStateDir });
        let plan = null;
        if (capability) {
          publish({ phase: "preparing" }, true);
          plan = await prepareImpl({ installer, capability, statePath });
        }
        publish(
          {
            phase: "ready",
            version: installer.version,
            verified: true,
            installer,
            plan,
            installMode: plan ? "restart" : "installer",
            error: "",
          },
          true,
        );
      } catch (error) {
        publish(
          {
            phase: signal.aborted ? "cancelled" : "failed",
            error: signal.aborted ? "" : error.message,
          },
          true,
        );
      } finally {
        controller = null;
      }
    })();
    return status();
  }
  function status() {
    const { installer, plan, ...visible } = state;
    return visible;
  }
  function reconcileInstalled() {
    const reconciled = reconcileUpdateOperation(state, appVersion);
    if (reconciled !== state) publish(reconciled, true);
  }
  async function cancel() {
    if (
      !controller ||
      !["checking", "downloading", "verifying"].includes(state.phase)
    )
      throw fail("This step cannot be cancelled.");
    controller.abort();
    return status();
  }
  async function performInstall({ preferInstaller = false } = {}) {
    await load();
    reconcileInstalled();
    if (
      !["ready", "installer-open", "failed"].includes(state.phase) ||
      !state.installer?.verified
    )
      throw fail("Download and verify the update first.");
    const installer = state.installer;
    // Revalidate persisted metadata and bytes, even after a bridge restart.
    const official = verifiedInstaller(
      {
        success: true,
        updateAvailable: true,
        source: "github:autohandai/squad",
        latestAllowedVersion: installer.version,
        downloadName: installer.name,
        downloadUrl: installer.url,
        downloadSha256: installer.sha256,
      },
      { platform, arch },
    );
    if (installer.path !== join(appStateDir, "updates", official.name))
      throw fail("The saved installer path is invalid. Download it again.");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(installer.path))
      hash.update(chunk);
    if (hash.digest("hex") !== official.sha256) {
      publish(
        {
          phase: "failed",
          verified: false,
          error: "Installer verification failed. Download the update again.",
        },
        true,
      );
      throw fail(state.error, 422);
    }
    // The update comes first: the host stops running work only once the
    // installer is known to be good, and refuses only a second install.
    if (
      !(await canRestart({
        automatic: state.installMode === "restart" && !preferInstaller,
      }))
    )
      throw fail("Another update installation is already in progress.");
    if (state.installMode === "restart" && !preferInstaller) {
      const capability = await capabilityImpl({ platform, serviceStateDir });
      if (!capability)
        throw fail(
          "Automatic installation is unavailable here. Re-download to use the system installer.",
        );
      if (
        !state.plan ||
        state.plan.app !== capability.app ||
        state.plan.pid !== capability.pid
      ) {
        publish({ phase: "preparing" }, true);
        state.plan = await prepareImpl({ installer, capability, statePath });
      }
      state.plan.services = capability.services;
      publish(
        {
          phase: "installing",
          nativePid: state.plan.pid,
          error: "",
          message: "Closing Squad, installing the update, then reopening…",
        },
        true,
      );
      await writing;
      try {
        await launchImpl(state.plan);
      } catch (error) {
        publish({ phase: "ready", error: error.message }, true);
        throw error;
      }
      return status();
    }
    try {
      await openImpl(installer.path, { platform });
      publish(
        {
          phase: "installer-open",
          installMode: "installer",
          error: "",
          message: installer.name.endsWith(".AppImage")
            ? "The download folder is open. Replace your AppImage with this verified file, then reopen Squad."
            : "The system installer is open. Follow its instructions, then reopen Squad.",
        },
        true,
      );
    } catch (error) {
      publish(
        {
          phase: "ready",
          error: `Could not open the installer: ${error.message}. Try opening it again.`,
        },
        true,
      );
      throw error;
    }
    await writing;
    return status();
  }
  async function install(options) {
    if (installBusy || ["installing", "restarting"].includes(state.phase))
      throw fail("An update installation is already in progress.");
    installBusy = true;
    try {
      return await performInstall(options);
    } catch (error) {
      if (["preparing", "installing"].includes(state.phase))
        publish({ phase: "ready", error: error.message }, true);
      throw error;
    } finally {
      installBusy = false;
    }
  }
  async function progress() {
    await load();
    try {
      await writing;
    } catch (error) {
      state = {
        ...state,
        phase: "failed",
        error: `Could not save the update. Free disk space and try again: ${error.message}`,
      };
    }
    if (["installing", "restarting"].includes(state.phase)) {
      const saved = JSON.parse(await readFile(statePath, "utf8"));
      if (saved.phase === "failed") state = saved;
    }
    return status();
  }
  return {
    load,
    start,
    status,
    cancel,
    install,
    progress,
    flush: () => writing,
    installing: () =>
      installBusy || ["installing", "restarting"].includes(state.phase),
  };
}
