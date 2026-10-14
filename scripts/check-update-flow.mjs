import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUpdateFlow } from "../server/update-flow.mjs";
const dir = await mkdtemp(join(tmpdir(), "squad-update-flow-"));
const content = Buffer.from("installer bytes; never executed");
const snapshot = {
  success: true,
  updateAvailable: true,
  source: "github:autohandai/squad",
  latestAllowedVersion: "0.1.7",
  downloadName: "autohand-squad-0.1.7-macos-arm64.dmg",
  downloadUrl:
    "https://github.com/autohandai/squad/releases/download/v0.1.7/autohand-squad-0.1.7-macos-arm64.dmg",
  downloadSha256: createHash("sha256").update(content).digest("hex"),
};
const fresh = {
  fresh: true,
  daemonReachable: true,
  status: "available",
  snapshot,
};
async function until(fn) {
  for (let n = 0; n < 300; n++) {
    const r = await fn();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Timed out");
}
try {
  let release;
  let opened = 0;
  let busy = false;
  const flow = createUpdateFlow({
    appStateDir: dir,
    platform: "darwin",
    arch: "arm64",
    checkFresh: async () => fresh,
    canRestart: async () => !busy,
    openImpl: async () => {
      opened++;
    },
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          async start(c) {
            c.enqueue(content.subarray(0, 5));
            await new Promise((r) => {
              release = r;
            });
            c.enqueue(content.subarray(5));
            c.close();
          },
        }),
        { headers: { "content-length": String(content.length) } },
      ),
  });
  await flow.start();
  await until(() => flow.status().bytes === 5);
  assert.equal(flow.status().phase, "downloading");
  assert.equal(flow.status().totalBytes, content.length);
  assert.equal(opened, 0);
  const concurrent = await assert.rejects(flow.start(), /already/);
  release();
  await until(() => flow.status().phase === "ready");
  await flow.flush();
  assert.equal(opened, 0);
  assert.equal(flow.status().verified, true);
  const restored = createUpdateFlow({
    appStateDir: dir,
    platform: "darwin",
    arch: "arm64",
    canRestart: async () => !busy,
    openImpl: async () => {
      opened++;
    },
  });
  await restored.load();
  assert.equal(restored.status().phase, "ready");
  busy = true;
  await assert.rejects(restored.install(), /Finish.*work/);
  assert.equal(opened, 0);
  busy = false;
  await restored.install();
  assert.equal(restored.status().phase, "installer-open");
  assert.equal(opened, 1);
  let resumeInstall;
  const cold=createUpdateFlow({appStateDir:dir,platform:"darwin",arch:"arm64",canRestart:()=>new Promise(r=>{resumeInstall=r;}),openImpl:async()=>{opened++;}});
  const coldInstall=cold.install(); await until(()=>Boolean(resumeInstall));
  assert.equal(cold.status().phase,"installer-open"); resumeInstall(true); await coldInstall;
  // The saved checksum is rechecked before opening a previously downloaded installer.
  const tampered = createUpdateFlow({
    appStateDir: dir,
    platform: "darwin",
    arch: "arm64",
    openImpl: async () => {
      opened++;
    },
  });
  await tampered.load();
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "updates", snapshot.downloadName), "changed");
  await assert.rejects(tampered.install(), /verification/);
  assert.equal(opened, 2);
  // Cancellation removes partials and never opens an installer.
  const cancel = createUpdateFlow({
    appStateDir: join(dir, "cancel"),
    platform: "darwin",
    arch: "arm64",
    checkFresh: async () => fresh,
    fetchImpl: async (_u, { signal }) =>
      new Promise((_r, reject) => {
        if (signal.aborted) reject(Error("aborted"));
        else
          signal.addEventListener("abort", () => reject(Error("aborted")), {
            once: true,
          });
      }),
  });
  await cancel.start();
  await until(() => cancel.status().phase === "checking");
  await cancel.cancel();
  await until(() => cancel.status().phase === "cancelled");
  assert.equal(cancel.status().verified, undefined);
  // Installation owns the operation while its asynchronous idle check runs.
  let allow;
  let launched = 0;
  const native = createUpdateFlow({
    appStateDir: join(dir, "native"),
    platform: "darwin",
    arch: "arm64",
    checkFresh: async () => fresh,
    fetchImpl: async () => new Response(content),
    capabilityImpl: async () => ({
      app: "/fixture/Autohand Squad.app",
      pid: 123,
      services: [],
    }),
    prepareImpl: async () => ({
      app: "/fixture/Autohand Squad.app",
      pid: 123,
      stage: "/fixture/stage",
      services: [],
    }),
    canRestart: () =>
      new Promise((r) => {
        allow = r;
      }),
    launchImpl: async () => {
      launched++;
    },
  });
  await native.start();
  await until(() => native.status().phase === "ready");
  await native.flush();
  const installing = native.install();
  await until(() => Boolean(allow));
  await assert.rejects(native.install(), /already/);
  await assert.rejects(native.start(), /already/);
  allow(true);
  await installing;
  assert.equal(launched, 1);
  assert.equal(native.status().phase, "installing");
  assert.equal(native.status().nativePid, 123);
  assert.equal(native.installing(), true);
  await assert.rejects(native.install(), /already/);
  assert.equal(native.status().phase, "installing");
  assert.equal(native.installing(), true);
  const reopened = createUpdateFlow({
    appStateDir: join(dir, "native"),
    appVersion: "0.1.7",
  });
  await reopened.load();
  assert.equal(reopened.status().phase, "complete");
  console.log(
    "Update flow passed: measured bytes, duplicate refusal, persisted ready state, idle guard, tamper refusal, cancellation. Mocked installer only.",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
