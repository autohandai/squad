// Files a member made (ADR-0287). After each of a member's turns, on any
// engine, Squad looks in the member's folders for files changed since the
// turn began and records them against the member: created (born during the
// turn) or edited. The member's Files page lists them with its published
// artifacts, and a file the member created can be moved to the Trash.
//
//   <stateDir>/member-files/<memberId>.json  (mode 0600)
//   { version: 1, files: { "<absolute path>": { root, created, firstSeenAt, lastSeenAt, size } } }
//
// Git folders are read with `git status` (fast, follows .gitignore); other
// folders with a bounded walk that skips dependency and build folders. A
// scan never blocks the reply and never runs longer than its budget.
import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile, chmod } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const SKIP = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.venv', 'venv', 'target', '__pycache__', '.cache', '.turbo', 'Pods', 'DerivedData', '.build', 'coverage']);
const LIMIT = 2000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const run = (file, args, timeout = 4000) => new Promise(done => {
  execFile(file, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => done({ error, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});

/** image, document, code, data or file, from the extension. */
export function fileKind(path) {
  const ext = extname(path).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic', '.bmp', '.tiff', '.ico'].includes(ext)) return 'image';
  if (['.md', '.txt', '.pdf', '.doc', '.docx', '.rtf', '.pages', '.html', '.htm', '.pptx', '.key', '.xlsx', '.numbers', '.csv'].includes(ext)) return 'document';
  if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.swift', '.java', '.kt', '.c', '.h', '.cpp', '.cs', '.php', '.sh', '.css', '.scss', '.sql', '.vue', '.svelte'].includes(ext)) return 'code';
  if (['.json', '.yaml', '.yml', '.toml', '.xml', '.lock', '.env'].includes(ext)) return 'data';
  if (['.mp3', '.wav', '.m4a', '.mp4', '.mov', '.webm'].includes(ext)) return 'media';
  return 'file';
}

/** A folder worth scanning: absolute, existing, and never the home folder or a system root. */
async function usableRoot(root, home) {
  if (typeof root !== 'string' || !isAbsolute(root)) return '';
  let real;
  try { real = await realpath(root); if (!(await stat(real)).isDirectory()) return ''; } catch { return ''; }
  const realHome = await realpath(home).catch(() => home);
  if (real === realHome || real === '/' || real.split(sep).filter(Boolean).length < 2) return '';
  return real;
}

async function gitCandidates(root) {
  const inside = await run('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], 2000);
  if (inside.error || inside.stdout.trim() !== 'true') return null;
  const top = (await run('git', ['-C', root, 'rev-parse', '--show-toplevel'], 2000)).stdout.trim();
  const status = await run('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'], 4000);
  if (status.error) return null;
  const paths = [];
  const parts = status.stdout.split('\0');
  for (let index = 0; index < parts.length; index++) {
    const entry = parts[index];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2), path = entry.slice(3);
    if (code[0] === 'R' || code[0] === 'C') index++; // the source path follows
    if (code.includes('D')) continue;
    paths.push(resolve(top || root, path));
  }
  return paths;
}

async function walkCandidates(root, since, deadline) {
  const out = [];
  const queue = [[root, 0]];
  let seen = 0;
  while (queue.length && Date.now() < deadline && seen < 20000) {
    const [dir, depth] = queue.shift();
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      seen++;
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (depth < 8 && !SKIP.has(entry.name) && !entry.name.startsWith('.')) queue.push([path, depth + 1]); continue; }
      if (!entry.isFile()) continue;
      try { if ((await lstat(path)).mtimeMs >= since) out.push(path); } catch { /* gone */ }
    }
  }
  return out;
}

export function createMemberFiles({ stateDir, home = homedir(), now = () => new Date(), trashImpl } = {}) {
  if (!stateDir) throw fail('stateDir is required', 500);
  const directory = join(stateDir, 'member-files');
  const chains = new Map();
  const serial = (memberId, action) => { const next = (chains.get(memberId) || Promise.resolve()).then(action); chains.set(memberId, next.catch(() => {})); return next; };
  const safeId = memberId => { const id = String(memberId || ''); if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw fail('Choose a member.'); return id; };
  const file = memberId => join(directory, `${safeId(memberId)}.json`);
  async function read(memberId) {
    try { const value = JSON.parse(await readFile(file(memberId), 'utf8')); return value?.version === 1 && value.files && typeof value.files === 'object' ? value : { version: 1, files: {} }; }
    catch { return { version: 1, files: {} }; }
  }
  async function write(memberId, value) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const tmp = `${file(memberId)}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(value), { mode: 0o600 }); await chmod(tmp, 0o600).catch(() => {}); await rename(tmp, file(memberId));
  }

  /**
   * Records what changed in `roots` since `since` (ms) for this member.
   * Returns the number of files recorded. Never throws for a bad folder.
   */
  async function recordTurn({ memberId, roots = [], since, budgetMs = 2500 }) {
    const id = safeId(memberId);
    const start = Number(since) - 1000, deadline = Date.now() + budgetMs;
    const usable = [...new Set((await Promise.all(roots.map(root => usableRoot(root, home)))).filter(Boolean))];
    if (!usable.length) return 0;
    const found = new Map();
    for (const root of usable) {
      if (Date.now() > deadline) break;
      const candidates = (await gitCandidates(root)) ?? await walkCandidates(root, start, deadline);
      for (const path of candidates.slice(0, 5000)) {
        if (Date.now() > deadline) break;
        let info;
        try { info = await lstat(path); } catch { continue; }
        if (!info.isFile() || info.mtimeMs < start) continue;
        const created = Number.isFinite(info.birthtimeMs) && info.birthtimeMs > 0 ? info.birthtimeMs >= start : false;
        found.set(path, { root, created, size: info.size });
      }
    }
    if (!found.size) return 0;
    return serial(id, async () => {
      const ledger = await read(id), at = now().toISOString();
      for (const [path, row] of found) {
        const before = ledger.files[path];
        ledger.files[path] = { root: row.root, created: before ? before.created : row.created, firstSeenAt: before?.firstSeenAt || at, lastSeenAt: at, size: row.size };
      }
      const entries = Object.entries(ledger.files).sort((a, b) => b[1].lastSeenAt.localeCompare(a[1].lastSeenAt));
      ledger.files = Object.fromEntries(entries.slice(0, LIMIT));
      await write(id, ledger);
      return found.size;
    });
  }

  /** The member's files that still exist, newest first. */
  async function list(memberId) {
    const ledger = await read(memberId);
    const rows = [];
    for (const [path, row] of Object.entries(ledger.files)) {
      let info;
      try { info = await lstat(path); } catch { continue; }
      if (!info.isFile()) continue;
      rows.push({ path, displayPath: path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path, name: basename(path), folder: relative(row.root, path).split(sep).slice(0, -1).join('/'),
        kind: fileKind(path), size: info.size, created: Boolean(row.created), firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt, modifiedAt: new Date(info.mtimeMs).toISOString() });
    }
    return rows.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  async function moveToTrash(path) {
    if (trashImpl) return trashImpl(path);
    if (platform() === 'darwin') {
      const result = await run('/usr/bin/trash', [path], 10000);
      if (!result.error) return;
      const finder = await run('osascript', ['-e', 'on run argv', '-e', 'tell application "Finder" to delete (POSIX file (item 1 of argv))', '-e', 'end run', path], 15000);
      if (!finder.error) return;
      throw fail('Squad could not move it to the Trash. Delete it in Finder.', 500);
    }
    const gio = await run('gio', ['trash', path], 10000);
    if (!gio.error) return;
    throw fail('Squad could not move it to the Trash on this computer. Delete it in your file manager.', 500);
  }

  /**
   * Moves a file the member created to the Trash. Only paths in this
   * member's record, still inside the folder they were found in, and
   * created by the member: an edited file was the person's first.
   */
  const trash = async (memberId, path) => serial(safeId(memberId), async () => {
    const ledger = await read(memberId);
    const row = ledger.files[String(path || '')];
    if (!row) throw fail('This file isn’t one this member made.', 404);
    if (!row.created) throw fail('This member edited this file but didn’t create it. Delete it yourself if you’re sure.', 409);
    let real;
    try { real = await realpath(path); } catch { delete ledger.files[path]; await write(memberId, ledger); return { trashed: false, gone: true }; }
    const root = await realpath(row.root).catch(() => row.root);
    if (real !== path || !(real === root || real.startsWith(root + sep))) throw fail('This file moved since the member made it. Delete it yourself.', 409);
    if (!(await lstat(real)).isFile()) throw fail('Only files can be moved to the Trash here.', 409);
    await moveToTrash(real);
    delete ledger.files[path]; await write(memberId, ledger);
    return { trashed: true };
  });

  return { recordTurn, list, trash };
}
