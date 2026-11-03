import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAutomaticUpdates } from "../server/automatic-updates.mjs";
import { createUpdateFlow } from "../server/update-flow.mjs";
import { readSystemSettings, writeSystemSettings } from "../server/system/settings.mjs";
import { until } from "./lib/reliability-browser.mjs";

const directory = await mkdtemp(join(tmpdir(), "squad-automatic-update-"));
const bytes = Buffer.from("verified update fixture; never executed");
const version = "0.1.17";
const name = `autohand-squad-${version}-windows-x64-setup.exe`;
const snapshot = { success: true, checkedAt: new Date().toISOString(), updateAvailable: true, latestAllowedVersion: version, source: "squad-api", downloadName: name, downloadUrl: `https://github.com/autohandai/squad/releases/download/v${version}/${name}`, downloadSha256: createHash("sha256").update(bytes).digest("hex") };
let release = { appVersion: "0.1.16", fresh: true, status: "available", daemonReachable: true, snapshot };
let downloads = 0, installs = 0;
try {
  const flowOptions = { appStateDir: directory, appVersion: "0.1.16", checkFresh: async () => release, platform: "win32", arch: "x64", fetchImpl: async () => { downloads++; return new Response(bytes); }, openImpl: async () => { installs++; } };
  let flow = createUpdateFlow(flowOptions);
  const settings = () => readSystemSettings(directory);
  await Promise.all([writeSystemSettings(directory, { autoCheckUpdates: false }), writeSystemSettings(directory, { autoDownloadUpdates: true })]);
  assert.deepEqual(await settings(), { autoCheckUpdates: false, autoDownloadUpdates: true }, "concurrent window edits retain both preferences");
  await writeSystemSettings(directory, { autoCheckUpdates: true, autoDownloadUpdates: false });
  const policy = () => createAutomaticUpdates({ settings, status: async () => release, flow, platform: "win32", arch: "x64", onError: error => { throw error; } });
  let automatic = policy();
  await automatic.check();
  assert.equal(downloads, 0, "automatic downloads require an explicit opt-in");
  await writeSystemSettings(directory, { autoCheckUpdates: false, autoDownloadUpdates: true });
  await automatic.check(); assert.equal(downloads, 0, "disabling checks also stops unattended downloads");
  await writeSystemSettings(directory, { autoCheckUpdates: true });
  for (const change of [{ status: "offline" }, { status: "check-failed" }, { checkError: "Network failed" }, { appVersion: version }, { snapshot: { ...snapshot, downloadSha256: "bad" } }, { snapshot: { ...snapshot, source: "untrusted" } }]) {
    await automatic.check({ ...release, ...change });
    assert.equal(downloads, 0, "only a newer official, verified-compatible release is eligible");
  }
  await Promise.all([automatic.check(), automatic.check(), automatic.check()]);
  await until(async () => (await flow.progress()).phase === "ready", "automatic download verified");
  assert.equal(downloads, 1, "windows share one bridge-owned download");
  assert.equal(installs, 0, "ready never installs, stops work or restarts");
  assert.equal((await flow.progress()).automatic, true);
  await automatic.check(); assert.equal(downloads, 1, "ready is retained");
  flow = createUpdateFlow(flowOptions); automatic = policy();
  await automatic.check(); assert.equal(downloads, 1, "verified download survives bridge restart");
  let cancelledDownloads = 0;
  const cancelFlow = createUpdateFlow({ ...flowOptions, appStateDir: join(directory, "cancel"), fetchImpl: async (_url, { signal }) => {
    cancelledDownloads++;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  } });
  const cancelPolicy = createAutomaticUpdates({ settings, status: async () => release, flow: cancelFlow, platform: "win32", arch: "x64" });
  await cancelPolicy.check();
  await until(() => cancelledDownloads === 1, "download started before cancellation");
  await cancelFlow.cancel();
  await until(async () => (await cancelFlow.progress()).phase === "cancelled", "cancel settled");
  await cancelPolicy.check();
  assert.equal(cancelledDownloads, 1, "cancellation waits for a manual retry for this version");
  await flow.start();
  await until(async () => (await flow.progress()).phase === "ready", "manual retry");
  assert.equal(downloads, 2);
  await flow.install(); assert.equal(installs, 1, "only an explicit install opens the installer");
  // A failed automatic attempt has a version even if it fails during checking.
  release = { ...release, snapshot: { ...snapshot, latestAllowedVersion: "0.1.18", downloadName: name.replace(version, "0.1.18"), downloadUrl: snapshot.downloadUrl.replaceAll(version, "0.1.18") } };
  const failureDir = join(directory, "failed");
  let failures = 0;
  const failedFlow = createUpdateFlow({ ...flowOptions, appStateDir: failureDir, fetchImpl: async () => { failures++; throw new Error("Network failed"); } });
  const failedPolicy = createAutomaticUpdates({ settings, status: async () => release, flow: failedFlow, platform: "win32", arch: "x64" });
  await failedPolicy.check();
  await until(async () => (await failedFlow.progress()).phase === "failed", "failed download retained");
  await failedPolicy.check(); assert.equal(failures, 1, "failure does not cause a retry storm");
  console.log("PASS opt-in/persisted preferences, disabled checks, trusted newer release, one background download across callers/restarts, cancellation/retry, failure retention and explicit install consent. Real update flow and checksum; fixture installer never executed.");
} finally { await rm(directory, { recursive: true, force: true }); }
