import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeClaudeUsage, normalizeCodexUsage, readClaudeUsage, readCodexUsage, createHarnessUsage } from '../server/harness/usage.mjs';

assert.equal(normalizeClaudeUsage({ rate_limits_available: true, rate_limits: { seven_day: { utilization: 0, resets_at: '2099-01-01T00:00:00Z' }, model_scoped: [{ display_name: 'Fable', utilization: 40, resets_at: null }] } })[0].usedPercent, 0);
assert.equal(normalizeClaudeUsage({ rate_limits_available: true, rate_limits: { seven_day: { utilization: null } } })[0].usedPercent, null);
assert.deepEqual(normalizeClaudeUsage({ rate_limits_available: false }), []);
const codex = normalizeCodexUsage({ rateLimits: { primary: { usedPercent: 53, windowDurationMins: 10080, resetsAt: 4099680000 }, secondary: { usedPercent: null } } });
assert.equal(codex[0].label, 'Weekly'); assert.equal(codex[0].usedPercent, 53); assert.equal(codex[1].usedPercent, null);
assert.equal(normalizeCodexUsage({ rateLimitsByLimitId: {}, rateLimits: { primary: { usedPercent: 0 } } })[0].usedPercent, 0);
assert.equal(normalizeCodexUsage({ rateLimits: { primary: { resetsAt: 1e100 } } })[0].resetsAt, null);
let closed = 0;
await readClaudeUsage('fixture', { queryFactory: ({ prompt, options }) => { assert.equal(typeof prompt, 'object'); assert.deepEqual(options.tools, []); assert.deepEqual(options.settingSources, []); return { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async opts => { assert.equal(opts.skipBehaviors, true); return {}; }, close: () => closed++ }; } });
assert.equal(closed, 1);
await assert.rejects(() => readClaudeUsage('fixture', { timeoutMs: 10, queryFactory: () => ({ usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () => new Promise(() => {}), close: () => closed++ }) }), /timed out/);
assert.equal(closed, 2);
let probes = 0, now = 0;
const service = createHarnessUsage({ now: () => now, listHarnesses: async () => [{ id: 'claude', status: 'ready' }, { id: 'codex', status: 'not-detected' }], readers: { claude: async () => { probes++; return {}; } } });
await Promise.all([service(), service()]); assert.equal(probes, 1); await service({ force: true }); assert.equal(probes, 1); now = 10001; await service({ force: true }); assert.equal(probes, 2); await service(); assert.equal(probes, 2); now = 70002; await service(); assert.equal(probes, 3);
const root = await mkdtemp(join(tmpdir(), 'squad-usage-'));
try {
  const executable = join(root, 'codex.cjs');
  await writeFile(executable, `#!${process.execPath}\nconst rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const m=JSON.parse(line);if(m.id===1)console.log(JSON.stringify({id:1,result:{}}));if(m.id===2){if(m.method!=='account/rateLimits/read')process.exit(4);console.log(JSON.stringify({id:2,result:{rateLimits:{primary:{usedPercent:25,windowDurationMins:300}}}}));}});`, { mode: 0o700 });
  assert.equal((await readCodexUsage(executable)).rateLimits.primary.usedPercent, 25);
} finally { await rm(root, { recursive: true, force: true }); }
console.log('Harness usage checks pass: genuine zero vs unknown, model labels, zero-prompt SDK control, disposal, timeout, cached/coalesced reads and real stdio account RPC.');
