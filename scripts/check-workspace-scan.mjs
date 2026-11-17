#!/usr/bin/env node
// The workspace list's home-folder scan (server/workspace-scan.mjs): callers
// share one scan, a finished scan is reused, and a folder read that does not
// answer ends the scan instead of parking more file threads.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FolderReadStalled, isProtectedHomeFolder, parkedFolderReads, readFolderWithin, sharedScan } from '../server/workspace-scan.mjs';

// A folder that never answers (iCloud Drive fetching it) is reported as stalled.
const never = () => new Promise(() => {});
await assert.rejects(readFolderWithin(never, '/Users/x/Documents/slow.xcodeproj', 50), error => error instanceof FolderReadStalled && error.path.endsWith('slow.xcodeproj'));
// An answering folder passes its entries through.
assert.deepEqual(await readFolderWithin(async () => ['a'], '/fine', 50), ['a']);
// A read that fails for another reason keeps its own error.
await assert.rejects(readFolderWithin(async () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); }, '/locked', 50), error => error.code === 'EACCES');

// Overlapping callers share one scan.
let scans = 0; let release;
let clock = 0;
const list = sharedScan(() => { scans += 1; return new Promise(resolve => { release = () => resolve([`scan ${scans}`]); }); }, { ttlMs: 1000, now: () => clock });
const first = list(); const second = list(); const third = list();
await Promise.resolve();
assert.equal(scans, 1, 'three overlapping requests start one scan');
release();
assert.deepEqual(await Promise.all([first, second, third]), [['scan 1'], ['scan 1'], ['scan 1']]);
// Within the reuse window the finished result is returned without scanning.
clock = 999; assert.deepEqual(await list(), ['scan 1']); assert.equal(scans, 1);
// After it, the next request scans again.
clock = 1001; const fresh = list(); await Promise.resolve(); assert.equal(scans, 2); release(); assert.deepEqual(await fresh, ['scan 2']);

// A failed scan is not reused; the next request retries.
let attempts = 0;
const flaky = sharedScan(async () => { attempts += 1; if (attempts === 1) throw new Error('scan failed'); return ['ok']; }, { ttlMs: 60_000, now: () => 0 });
await assert.rejects(flaky(), /scan failed/);
assert.deepEqual(await flaky(), ['ok']);
assert.equal(attempts, 2);

// A read that outlives its wait is counted as parked until it settles.
let settle;
const late = () => new Promise(resolve => { settle = () => resolve([]); });
const before = parkedFolderReads(); // the never-answering read above stays parked
await assert.rejects(readFolderWithin(late, '/Users/x/Desktop', 20), FolderReadStalled);
assert.equal(parkedFolderReads(), before + 1, 'the stalled read is still parked');
settle(); await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(parkedFolderReads(), before, 'a parked read that answers is released');

// The home scan leaves the privacy-guarded folders at the top of home alone,
// and still walks folders of the same name deeper down.
for (const name of ['Desktop', 'Documents', 'Downloads']) assert.equal(isProtectedHomeFolder(0, name), true, name);
assert.equal(isProtectedHomeFolder(0, 'Developer'), false);
assert.equal(isProtectedHomeFolder(2, 'Documents'), false);

// The real failure (18 Nov 2026): a file thread parked in the kernel keeps
// process.exit() from finishing. A FIFO with no writer parks open() the same
// way a stalled ~/Desktop does. The worker's rule (exit at once while a read
// is parked) must end the process; plain process.exit() must be what hangs.
const dir = await mkdtemp(join(tmpdir(), 'squad-workspace-scan-'));
try {
  const fifo = join(dir, 'never'); execFileSync('mkfifo', [fifo]);
  const module = new URL('../server/workspace-scan.mjs', import.meta.url).href;
  const run = rule => new Promise(resolve => {
    const code = `import { readFile } from 'node:fs/promises';
      import { readFolderWithin, parkedFolderReads } from ${JSON.stringify(module)};
      try { await readFolderWithin(path => readFile(path), ${JSON.stringify(fifo)}, 50); } catch {}
      ${rule ? "if (parkedFolderReads() > 0) process.kill(process.pid, 'SIGKILL');" : ''}
      process.exit(0);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve('hung'); }, 3000);
    child.once('exit', (exitCode, signal) => { clearTimeout(timer); resolve(signal || exitCode); });
  });
  assert.equal(await run(false), 'hung', 'process.exit() waits on the parked read');
  assert.equal(await run(true), 'SIGKILL', 'the parked-read rule ends the process at once');
} finally { await rm(dir, { recursive: true, force: true }); }

console.log('Workspace scan checks passed: a stalled folder ends the scan, overlapping requests share one scan, results are reused for the window, failures are retried, parked reads are counted, Desktop/Documents/Downloads are not opened, and a process with a parked read still exits.');
