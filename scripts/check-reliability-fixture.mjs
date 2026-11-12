import assert from 'node:assert/strict';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBridge } from './lib/reliability-browser.mjs';

let allocated;
try {
  await assert.rejects(startBridge({ liveIdentity: true, prepare: async directory => {
    allocated = directory;
    await mkdir(join(directory, 'codex'));
    await writeFile(join(directory, 'codex', 'auth.json'), '{"fixture":"not-a-real-credential"}', { mode: 0o600 });
    throw Error('Fixture preparation failed after copying authentication.');
  } }), /Fixture preparation failed/);
  assert(allocated, 'the failing preparation was exercised');
  await assert.rejects(stat(allocated), { code: 'ENOENT' }, 'failed preparation removes its entire private directory');
  console.log('PASS: failed rehearsal preparation removes copied fixture authentication before a bridge is returned.');
} finally {
  if (allocated) await rm(allocated, { recursive: true, force: true });
}
