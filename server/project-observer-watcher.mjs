// Folder watching for the project observer, in its own process (ADR-0123,
// second revision). On macOS `fs.watch` opens the folder synchronously, and
// for a folder under ~/Documents, ~/Desktop or ~/Downloads that open waits
// for the privacy prompt to be answered. On the bridge's main thread that
// froze every route; in a worker thread it also blocked `process.exit`, so
// the bridge could not stop. A child process can always be killed.
// IPC in: { paths: [string] }; out: { path, filename }.
import { watch } from "node:fs";

const watchers = new Map();

function sync(paths) {
  const wanted = new Set(paths);
  for (const [path, watcher] of watchers) {
    if (!wanted.has(path)) { watcher.close(); watchers.delete(path); }
  }
  for (const path of wanted) {
    if (watchers.has(path)) continue;
    try {
      const watcher = watch(path, { recursive: process.platform === "darwin" || process.platform === "win32", persistent: true }, (_event, filename) => {
        process.send?.({ path, filename: String(filename || "") });
      });
      watcher.on("error", () => { watcher.close(); watchers.delete(path); });
      watchers.set(path, watcher);
    } catch {
      // Polling in the observer still covers this folder.
    }
  }
}

process.on("message", (message) => {
  if (Array.isArray(message?.paths)) sync(message.paths);
});
// The bridge went away: nothing left to tell.
process.on("disconnect", () => process.exit(0));
