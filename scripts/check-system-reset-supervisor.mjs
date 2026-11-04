import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { until } from "./lib/reliability-browser.mjs";
import { startSupervisedBridge } from "./lib/supervised-bridge.mjs";

const bridge = await startSupervisedBridge();
try {
  const original = await bridge.request("/api/health");
  const account = await readFile(bridge.config, "utf8");
  await writeFile(join(bridge.state, "reset-marker.txt"), "kept in the dated backup");
  const managed = join(bridge.home, ".autohandsquad");
  await mkdir(managed);
  await writeFile(join(managed, "workspace-marker.txt"), "kept workspace");
  const response = await bridge.request("/api/system/reset", "POST", { confirm: "RESET" });
  assert.equal(response.success, true, JSON.stringify(response));
  assert.ok(response.data.moved.every(item => item.folder.startsWith(bridge.directory)), "Only disposable fixture folders may be reset.");
  await until(async () => {
    const health = await bridge.request("/api/health");
    return health.success && health.pid !== original.pid;
  }, "reset hands off to a fresh healthy bridge without a manual restart", 15000);
  assert.equal((await bridge.request("/api/setup")).data.status, "new");
  const progress = (await bridge.request(`/api/system/reset/status?requestId=${response.data.requestId}&previousPid=${original.pid}`)).data;
  assert.equal(progress.phase, "complete");
  assert.equal(progress.previousPid, original.pid);
  const replay = await bridge.request("/api/system/reset", "POST", { confirm: "RESET", requestId: response.data.requestId });
  assert.equal(replay.data.resetId, response.data.resetId, "a lost response cannot archive the newly created profile a second time");
  assert.equal(await readFile(bridge.config, "utf8"), account);
  const archives = (await readdir(bridge.directory)).filter(name => name.startsWith("squad.reset-"));
  assert.equal(archives.length, 1);
  const archive = archives[0];
  assert.equal(await readFile(join(bridge.directory, archive, "reset-marker.txt"), "utf8"), "kept in the dated backup");
  // The recovered bridge is a child of the long-lived daemon. A second
  // reset catches zombie ownership that a one-shot CLI parent masks.
  const recovered = await bridge.request("/api/health");
  await bridge.request("/api/system/reset", "POST", { confirm: "RESET" });
  await until(async () => (await bridge.request("/api/health")).pid !== recovered.pid, "daemon reaps and recovers its own bridge child after another reset", 15000);
  console.log("PASS real daemon supervision survives reset, preserves dated data and sign-in, and returns a fresh first-run bridge. Isolated home; no provider calls.");
} finally { await bridge.close(); }
