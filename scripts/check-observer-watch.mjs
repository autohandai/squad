#!/usr/bin/env node
// The project observer must not freeze the bridge when a folder cannot be
// opened yet (ADR-0123, second revision). On macOS fs.watch opens the folder
// synchronously; under ~/Documents that open waits for the Documents-folder
// privacy prompt, and on the main thread it froze every route until the
// daemon killed the bridge. A named pipe blocks the same open, so this
// stands in for the prompt: the observer is given a pipe as a project and
// the main thread must keep running.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectObserver } from "../server/project-observer.mjs";

if (process.platform === "win32") { console.log("check:observer-watch: skipped on Windows (no named pipes in the file system)"); process.exit(0); }
const root = await mkdtemp(join(tmpdir(), "squad-observer-watch-"));
const pipe = join(root, "blocked-folder");
execFileSync("mkfifo", [pipe]);
await mkdir(join(root, "state"), { recursive: true });
const observer = new ProjectObserver({ squadStateDir: join(root, "state"), watch: true, startupDelayMs: 60_000, getRuntimeState: async () => ({ signedIn: false }), inspect: async () => null, review: async () => null });
try {
  await observer.update({ settings: { observeAssignedProjects: true }, members: [{ id: "asq_watch", name: "Watcher", projects: [{ path: pipe }] }] });
  // The main thread must answer a timer promptly while the worker is stuck.
  const started = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 150));
  const lag = Date.now() - started;
  assert.ok(lag < 1000, `the main thread kept running (timer fired after ${lag} ms)`);
  assert.ok(observer.watcherWorker, "folder watching runs in its own process");
  assert.deepEqual([...observer.watchers.keys()], [pipe], "the blocked folder is still listed as watched");
  // A real folder still reports changes through the watcher process.
  const { fork } = await import("node:child_process");
  const { writeFile } = await import("node:fs/promises");
  const folder = join(root, "real-folder");
  await mkdir(folder, { recursive: true });
  const child = fork(new URL("../server/project-observer-watcher.mjs", import.meta.url), [], { stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "json" });
  const seen = new Promise((resolve, reject) => { child.on("message", resolve); setTimeout(() => reject(new Error("no change reported within 5 s")), 5000).unref(); });
  child.send({ paths: [folder] });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await writeFile(join(folder, "notes.md"), "changed");
  const change = await seen;
  child.kill("SIGKILL");
  assert.equal(change.path, folder); assert.ok(change.filename.endsWith("notes.md"), JSON.stringify(change));
  console.log(`Observer watch check passed: a folder whose open blocks did not stall the main thread (timer lag ${lag} ms); a real folder change still arrives.`);
} finally {
  observer.stop();
  await rm(root, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 50).unref();
}
