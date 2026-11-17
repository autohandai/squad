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

// Reads that outlived their wait and are still parked in the kernel. Node
// cannot cancel them, and process.exit() joins every file thread, so a
// process holding one never finishes exiting (ADR-0165 addendum, 18 Nov 2026).
let parkedReads = 0;
export function parkedFolderReads() { return parkedReads; }

/** Read a folder, or throw FolderReadStalled when it takes longer than `ms`. */
export function readFolderWithin(readDirectory, path, ms = WORKSPACE_FOLDER_READ_MS) {
  let timer, parked = false;
  const read = Promise.resolve().then(() => readDirectory(path, { withFileTypes: true }));
  read.then(() => {}, () => {}).finally(() => { if (parked) parkedReads -= 1; });
  const stalled = new Promise((_, reject) => { timer = setTimeout(() => { parked = true; parkedReads += 1; reject(new FolderReadStalled(path)); }, ms); });
  return Promise.race([read, stalled]).finally(() => clearTimeout(timer));
}

// Folders macOS guards with a privacy prompt and iCloud Drive may sync. A read
// of one can wait for a permission answer or a download with no time limit
// (on 18 Nov 2026 even `ls ~/Desktop` hung), so the home scan does not open
// them. Projects kept there are added by hand with Add folder.
export const PROTECTED_HOME_FOLDERS = new Set(['Desktop', 'Documents', 'Downloads']);
export function isProtectedHomeFolder(depth, name) { return depth === 0 && PROTECTED_HOME_FOLDERS.has(name); }

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
