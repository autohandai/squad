#!/usr/bin/env node
// The workspace list's home-folder scan (server/workspace-scan.mjs): callers
// share one scan, a finished scan is reused, and a folder read that does not
// answer ends the scan instead of parking more file threads.
import assert from 'node:assert/strict';
import { FolderReadStalled, readFolderWithin, sharedScan } from '../server/workspace-scan.mjs';

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

console.log('Workspace scan checks passed: a stalled folder ends the scan, overlapping requests share one scan, results are reused for the window, failures are retried.');
