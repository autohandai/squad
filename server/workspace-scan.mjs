// The home-folder scan behind the workspace list (server.mjs listWorkspaces).
//
// Every page load asked for the list and every request started its own scan
// of up to 6,000 folders. A folder read can stall for a long time on macOS
// when the folder is synced by iCloud Drive and not yet on disk: on 3 November
// 2026 a read of ~/Documents/ios_apps/…/Shoppa.xcodeproj stayed in flight for
// over 80 seconds. Node runs file reads on a pool of four threads, so a few
// overlapping scans parked on such folders froze every file read in the bridge
// (/api/channels, a model-routing reset) while in-memory routes kept
// answering.
//
// Callers now share one scan, a finished scan is reused for a minute, and a
// folder that does not answer in time ends the scan with what it found, so a
// stalled folder holds at most one thread.

export const WORKSPACE_SCAN_TTL_MS = 60_000;
export const WORKSPACE_FOLDER_READ_MS = 2_000;

export class FolderReadStalled extends Error {
  constructor(path) { super(`Folder read did not answer in time: ${path}`); this.name = 'FolderReadStalled'; this.path = path; }
}

/** Read a folder, or throw FolderReadStalled when it takes longer than `ms`. */
export function readFolderWithin(readDirectory, path, ms = WORKSPACE_FOLDER_READ_MS) {
  let timer;
  const stalled = new Promise((_, reject) => { timer = setTimeout(() => reject(new FolderReadStalled(path)), ms); });
  return Promise.race([readDirectory(path, { withFileTypes: true }), stalled]).finally(() => clearTimeout(timer));
}

/** One scan in flight at a time; its result is reused for `ttlMs`. */
export function sharedScan(scan, { ttlMs = WORKSPACE_SCAN_TTL_MS, now = () => Date.now() } = {}) {
  let running = null;
  let result = null;
  let finishedAt = 0;
  return function listShared() {
    if (result && now() - finishedAt < ttlMs) return Promise.resolve(result);
    if (!running) {
      running = Promise.resolve().then(scan).then(value => { result = value; finishedAt = now(); return value; }).finally(() => { running = null; });
    }
    return running;
  };
}
