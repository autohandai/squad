import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desktopUpdateStatus, openDesktopTarget, RELEASES_URL, upgradeDesktop, verifiedInstaller } from "../server/desktop-updates.mjs";

const content = Buffer.from("verified installer fixture; never executed");
const name = "autohand-squad-0.1.6-macos-arm64.dmg";
const snapshot = {
  success: true, checkedAt: "unix-ms:1790800000000", updateAvailable: true,
  latestAllowedVersion: "0.1.6", source: "github:autohandai/squad",
  downloadName: name, downloadSha256: createHash("sha256").update(content).digest("hex"),
  downloadUrl: `https://github.com/autohandai/squad/releases/download/v0.1.6/${name}`,
};
const fresh = { fresh: true, daemonReachable: true, status: "available", checkError: "", snapshot };
let checks = 0;
function checked() { checks += 1; }
const directory = await mkdtemp(join(tmpdir(), "squad-updates-check-"));

try {
  assert.equal(verifiedInstaller(snapshot, { platform: "darwin", arch: "arm64" }).name, name); checked();
  for (const changed of [
    { downloadUrl: "https://example.com/installer.dmg" },
    { downloadUrl: snapshot.downloadUrl.replace("autohandai/squad", "another/repo") },
    { downloadUrl: `${snapshot.downloadUrl}?token=unsafe` },
    { downloadName: "../../installer.dmg" },
    { downloadSha256: "not-a-checksum" },
    { source: "api" },
    { success: false },
    { latestAllowedVersion: "0.1.7" },
  ]) {
    assert.throws(() => verifiedInstaller({ ...snapshot, ...changed }, { platform: "darwin", arch: "arm64" })); checked();
  }
  assert.throws(() => verifiedInstaller(snapshot, { platform: "darwin", arch: "x64" })); checked();

  const opened = [];
  const result = await upgradeDesktop({
    appStateDir: join(directory, "matched"), platform: "darwin", arch: "arm64",
    checkFresh: async () => fresh,
    fetchImpl: async () => new Response(content),
    openImpl: async (...args) => { opened.push(args); },
  });
  assert.equal(result.verified, true);
  assert.equal(result.opened, true);
  assert.deepEqual(await readFile(result.path), content);
  assert.deepEqual(opened, [[result.path, { platform: "darwin" }]]);
  assert.deepEqual(await readdir(join(directory, "matched", "updates")), [name]); checked();

  for (const [label, options, expected] of [
    ["mismatch", { fetchImpl: async () => new Response("tampered") }, /verification failed/],
    ["size", { fetchImpl: async () => new Response(content), maxBytes: 2 }, /download size/],
    ["redirect", { fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://example.com/installer" } }) }, /outside GitHub/],
    ["timeout", { timeoutMs: 5, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })) }, /timed out/],
  ]) {
    let attempts = 0;
    await assert.rejects(upgradeDesktop({
      appStateDir: join(directory, label), platform: "darwin", arch: "arm64",
      checkFresh: async () => fresh, openImpl: async () => { attempts += 1; }, ...options,
    }), expected);
    assert.equal(attempts, 0);
    assert.deepEqual(await readdir(join(directory, label, "updates")), []); checked();
  }

  let requested = 0;
  await assert.rejects(upgradeDesktop({
    appStateDir: join(directory, "stale"), platform: "darwin", arch: "arm64",
    checkFresh: async () => ({ ...fresh, fresh: false }),
    fetchImpl: async () => { requested += 1; return new Response(content); },
    openImpl: async () => { throw new Error("must never open"); },
  }), /available update/);
  assert.equal(requested, 0); checked();

  let redirected = 0;
  await upgradeDesktop({
    appStateDir: join(directory, "github-cdn"), platform: "darwin", arch: "arm64",
    checkFresh: async () => fresh, openImpl: async () => {},
    fetchImpl: async () => ++redirected === 1
      ? new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/github-production-release-asset/fixture" } })
      : new Response(content),
  });
  assert.equal(redirected, 2); checked();

  const readJsonImpl = async (path) => path.endsWith("daemon.json") ? { url: "http://127.0.0.1:19820" } : snapshot;
  const failed = await desktopUpdateStatus({ squadStateDir: directory, appVersion: "0.1.5", refresh: true, readJsonImpl,
    fetchImpl: async (url) => url.endsWith("/health") ? new Response("{}") : new Response(JSON.stringify({ success: false, error: "GitHub unavailable" })),
  });
  assert.equal(failed.status, "check-failed");
  assert.equal(failed.fresh, false);
  assert.equal(failed.snapshot, snapshot);
  assert.match(failed.checkError, /GitHub unavailable/); checked();
  const offline = await desktopUpdateStatus({ squadStateDir: directory, appVersion: "0.1.5", refresh: true, readJsonImpl, fetchImpl: async () => { throw new Error("connection refused"); } });
  assert.equal(offline.status, "offline");
  assert.equal(offline.fresh, false); checked();
  const neverChecked = await desktopUpdateStatus({ squadStateDir: directory, appVersion: "0.1.5", readJsonImpl: async (path) => path.endsWith("daemon.json") ? { url: "http://127.0.0.1:19820" } : { success: true }, fetchImpl: async () => new Response("{}") });
  assert.equal(neverChecked.status, "never-checked"); checked();
  const current = await desktopUpdateStatus({ squadStateDir: directory, appVersion: "0.1.6", refresh: true, readJsonImpl, fetchImpl: async (url) => new Response(JSON.stringify(url.endsWith("/health") ? {} : { ...snapshot, updateAvailable: false })) });
  assert.equal(current.status, "up-to-date");
  assert.equal(current.fresh, true); checked();

  for (const [platform, target, executable, args] of [
    ["darwin", "/tmp/verified.dmg", "open", ["/tmp/verified.dmg"]],
    ["win32", "/tmp/verified-setup.exe", "/tmp/verified-setup.exe", []],
    ["win32", "/tmp/verified.msi", "msiexec.exe", ["/i", "/tmp/verified.msi"]],
    ["linux", "/tmp/verified.deb", "xdg-open", ["/tmp/verified.deb"]],
    ["linux", "/tmp/verified.AppImage", "xdg-open", ["/tmp"]],
    ["win32", RELEASES_URL, "explorer.exe", [RELEASES_URL]],
  ]) {
    const calls = [];
    await openDesktopTarget(target, { platform, spawnImpl: (command, commandArgs, options) => {
      calls.push({ command, commandArgs, options });
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => { child.emit("spawn"); child.emit("close", 0); });
      return child;
    } });
    assert.equal(calls[0].command, executable);
    assert.deepEqual(calls[0].commandArgs, args);
    assert.equal(calls[0].options.shell, false); checked();
  }
  await assert.rejects(openDesktopTarget("https://example.com/unsafe"), /Invalid installer path/); checked();
  console.log(`Desktop update checks passed (${checks} cases); mocked downloads and openers only.`);
} finally { await rm(directory, { recursive: true, force: true }); }
