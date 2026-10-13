import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexAdapter, runExternalHarness } from '../server/harness/index.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-harness-timeouts-'));
const fixture = join(directory, 'progress.mjs');
await writeFile(fixture, `
const emit = () => process.stdout.write(JSON.stringify({type:'turn.started'})+'\\n');
const mode = process.argv[2];
if (mode !== 'startup') emit();
if (mode === 'progress') { setInterval(emit, 70); setTimeout(() => process.exit(0), 650); }
else setInterval(() => {}, 1000);
`);
const run = (mode, options = {}) => runExternalHarness({
  adapter: codexAdapter, executable: process.execPath, args: [fixture, mode], cwd: directory,
  timeoutMs: 3000, inactivityMs: 220, firstEventTimeoutMs: 1000, ...options,
});
try {
  const active = await run('progress');
  assert.equal(active.error, '', 'Activity renews the silence window while the turn continues');
  const idleStarted = Date.now();
  const idle = await run('silent');
  assert.equal(idle.timedOut, true);
  assert.match(idle.error, /without activity/, 'A silent turn reports inactivity rather than a wall-clock deadline');
  assert.ok(Date.now() - idleStarted < 2000, 'Silence stops the subprocess within its inactivity window');
  const capped = await run('progress', { timeoutMs: 300 });
  assert.equal(capped.timedOut, true);
  assert.match(capped.error, /maximum runtime/, 'Progress cannot bypass the separate runtime ceiling');
  const startup = await run('startup', { firstEventTimeoutMs: 100, inactivityMs: 1000 });
  assert.equal(startup.stalled, true, 'The first-event watchdog still stops a harness that never starts');
  const fixed = await run('progress', { timeoutMs: 300, inactivityMs: 0 });
  assert.equal(fixed.timedOut, true, 'Background jobs retain an explicit wall-clock limit');
  console.log('Harness timeout checks: continuing progress, silence, startup failure, runtime ceiling and background limits passed.');
} finally { await rm(directory, { recursive: true, force: true }); }
