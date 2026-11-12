import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { windowsJobDrained } from '../server/ownership/native-helper.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-windows-proof-'));
const name = `Global\\AutohandSquad-${'a'.repeat(64)}`, receiptPath = join(directory, 'worker.drained');
const receipt = { version: 1, jobName: name, drained: true };
try {
  const proved = await windowsJobDrained(name, { receiptPath, bootUptimeMs: 100, queryStatus: async () => {
    // The real watchdog persists its final receipt before exiting. A query
    // started after our first ENOENT can observe a missing job after that exit.
    await writeFile(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
    return { empty: false, missing: true, uptimeMs: 200 };
  } });
  assert.equal(proved, true, 'a matching receipt published during the OS query must be re-read');
  await rm(receiptPath);
  assert.equal(await windowsJobDrained(name, { receiptPath, bootUptimeMs: 100, queryStatus: async () => ({ empty: false, missing: true, uptimeMs: 200 }) }), false, 'a missing job without a receipt is never enough');
  assert.equal(await windowsJobDrained(name, { receiptPath, bootUptimeMs: 100, queryStatus: async () => ({ empty: false, missing: true, uptimeMs: 50 }) }), true, 'strictly lower OS uptime still proves a reset');
  await assert.rejects(windowsJobDrained(name, { receiptPath, bootUptimeMs: 100, queryStatus: async () => {
    await writeFile(receiptPath, JSON.stringify({ ...receipt, jobName: `${name.slice(0, -1)}b` }));
    return { empty: true, missing: false, uptimeMs: 200 };
  } }), /does not match/, 'a mismatched late receipt must fail closed');
  console.log('PASS Windows drain proof: a late durable receipt survives the OS-query race; missing or mismatched proof remains denied.');
} finally { await rm(directory, { recursive: true, force: true }); }
