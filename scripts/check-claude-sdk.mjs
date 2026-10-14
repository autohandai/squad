import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as adapter from '../server/harness/claude.mjs';
import { claudeSdkOptions, runClaudeSdk } from '../server/harness/claude-sdk.mjs';
import { fallbackCandidates, limitCooldown, modelLimit } from '../server/harness/claude-model-recovery.mjs';
import { stageClaudeSdk } from './stage-claude-sdk.mjs';
import { pathToFileURL } from 'node:url';

assert.equal(modelLimit('Usage limit reached.', { status: 'rejected', rateLimitType: 'five_hour' }, 'rate_limit'), null);
assert.equal(modelLimit("You've reached your Fable limit.", { status: 'rejected', rateLimitType: 'seven_day' }, 'rate_limit'), null);
assert.equal(modelLimit("You've reached your Fable limit.", undefined, 'authentication_failed'), null);
assert.equal(modelLimit('Credit balance is too low.', undefined, 'billing_error'), null);
assert.equal(modelLimit('Rate limit reached', undefined, 'rate_limit'), null);
assert.equal(modelLimit("You've reached your Fable limit. Switch to another model.", undefined, 'rate_limit').model, 'fable');
assert.equal(modelLimit('', { status: 'rejected', rateLimitType: 'seven_day_fable' }).model, 'fable');
assert.equal(modelLimit('', { status: 'allowed_warning', rateLimitType: 'seven_day_opus' }), null);
const realLimit = { status: 'rejected', rateLimitType: 'seven_day_overage_included', resetsAt: 1792267200, overageStatus: 'rejected', overageDisabledReason: 'org_level_disabled', unifiedWindows: { five_hour: { utilization: 0.03 }, seven_day: { utilization: 0.73 }, seven_day_overage_included: { utilization: 1 } } };
assert.equal(modelLimit("You've reached your Fable limit. Switch to another model.", realLimit, 'rate_limit').model, 'fable', 'The captured live Fable refusal is model-specific despite its bucket name');
assert.equal(modelLimit("You've reached your Fable limit.", { ...realLimit, unifiedWindows: { seven_day: { utilization: 1 } } }, 'rate_limit'), null, 'A full account window still stops recovery');
const catalog = [{ value: 'fable', resolvedModel: 'claude-fable' }, { value: 'claude-fable' }, { value: 'opus', resolvedModel: 'claude-opus' }, { value: 'sonnet' }];
assert.deepEqual(fallbackCandidates(catalog, 'claude-fable', {}).map(row => row.value), ['opus', 'sonnet']);
assert.deepEqual(fallbackCandidates(catalog, 'fable', { 'claude-opus': { until: 1000 } }, 500).map(row => row.value), ['sonnet']);
assert.ok(fallbackCandidates(catalog, 'fable', { opus: { until: 1000 } }, 1500).some(row => row.value === 'opus'));
assert.equal(limitCooldown({}, 1000), 301000);
const translated = await claudeSdkOptions({ executable: '/fake/claude', cwd: '/workspace', env: {}, args: adapter.buildArgs({ prompt: 'hello', workspace: '/workspace', model: 'sonnet', resumeId: 'saved', access: 'plan', effort: 'high', appendSystemPrompt: 'member rules', addDirs: ['/other'] }).args });
assert.equal(translated.prompt, 'hello');
assert.equal(translated.options.permissionMode, 'plan');
assert.equal(translated.options.systemPrompt.append, 'member rules');
assert.equal(translated.options.resume, 'saved');
assert.equal(translated.options.effort, 'high');
assert.deepEqual(translated.options.additionalDirectories, ['/workspace', '/other']);
assert.equal(translated.options.pathToClaudeCodeExecutable, '/fake/claude');
const observation = await claudeSdkOptions({ executable: '/fake/claude', cwd: '/scratch', env: { AUTOHAND_SQUAD_OBSERVATION: '1' }, args: ['-p', 'review', '--tools', '', '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config', '--permission-mode', 'plan'] });
assert.deepEqual(observation.options.tools, []);
assert.deepEqual(observation.options.settingSources, []);
assert.deepEqual(observation.options.mcpServers, {});

const directory = await mkdtemp(join(tmpdir(), 'squad-claude-sdk-'));
const requests = [];
let closed = 0;
let mode = 'recover';
const queryFactory = ({ prompt, options }) => {
  const model = options.model || 'fable';
  requests.push({ model, prompt, resume: options.resume, options });
  const query = (async function* () {
    yield { type: 'system', subtype: 'init', model, session_id: 'saved-session' };
    if (mode === 'stop' || mode === 'silent') {
      await new Promise(resolve => options.abortController.signal.addEventListener('abort', resolve, { once: true }));
      throw new Error('aborted');
    }
    if (mode === 'progress') {
      for (let i = 0; i < 5; i += 1) { await new Promise(resolve => setTimeout(resolve, 25)); yield { type: 'system', subtype: 'working' }; }
    }
    if ((model === 'fable' && mode === 'recover') || mode === 'all-limited' || mode === 'account-limit' || mode === 'auth') {
      const text = mode === 'auth' ? 'Sign in required.' : mode === 'account-limit' ? 'Usage limit reached.' : `You've reached your ${model} limit. Switch to another model.`;
      yield { type: 'assistant', error: mode === 'auth' ? 'authentication_failed' : 'rate_limit', message: { content: [{ type: 'text', text }] } };
      yield { type: 'result', subtype: 'error_during_execution', is_error: true, errors: [text] };
    } else {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Complete.' }] } };
      yield { type: 'result', subtype: 'success', result: 'Complete.' };
    }
  })();
  query.supportedModels = async () => [{ value: 'fable' }, { value: 'opus' }, { value: 'sonnet' }, { value: 'haiku' }];
  query.close = () => { closed += 1; };
  return query;
};
const run = extra => runClaudeSdk({ adapter, executable: '/fake/claude', cwd: directory, args: adapter.buildArgs({ prompt: 'Original task.', access: 'full' }).args, modelRecoveryPath: join(directory, 'models.json'), queryFactory, timeoutMs: 3000, firstEventTimeoutMs: 500, ...extra });
try {
  const events = [];
  const recovered = await run({ onEvent: event => events.push(event) });
  assert.equal(recovered.error, '');
  assert.equal(recovered.effectiveModel, 'opus');
  assert.deepEqual(requests.map(request => request.model), ['fable', 'opus']);
  assert.equal(requests[1].resume, 'saved-session');
  assert.match(requests[1].prompt, /do not repeat completed tool calls/);
  assert.ok(!events.some(event => event.type === 'error'), 'Recoverable quota errors do not terminate the live stream');
  const routing = JSON.parse(await readFile(join(directory, 'models.json'), 'utf8'));
  assert.equal(Object.values(routing.routes)[0].defaultModel, 'fable', 'Engine default is remembered separately from the model that recovered');
  const again = await run();
  assert.equal(again.error, '');
  assert.equal(requests.at(-1).model, 'opus', 'Default-model cooldown survives the next run');
  for (const failureMode of ['account-limit', 'auth', 'all-limited']) {
    mode = failureMode;
    const count = requests.length;
    const result = await run({ modelRecoveryPath: '' });
    assert.ok(result.error);
    assert.equal(requests.length - count, failureMode === 'all-limited' ? 4 : 1, `${failureMode} has a bounded, correctly scoped recovery policy`);
  }
  mode = 'stop';
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  const stopped = await run({ modelRecoveryPath: '', signal: controller.signal });
  assert.equal(stopped.stopped, true);
  assert.match(stopped.error, /stopped by the user/);
  mode = 'silent';
  const idle = await run({ modelRecoveryPath: '', inactivityMs: 40 });
  assert.equal(idle.timedOut, true);
  assert.match(idle.error, /without activity/);
  mode = 'progress';
  assert.equal((await run({ modelRecoveryPath: '', inactivityMs: 50 })).error, '', 'SDK progress renews the silence window');
  assert.equal((await run({ modelRecoveryPath: '', timeoutMs: 50 })).timedOut, true, 'Activity cannot exceed the overall deadline');
  assert.equal(closed, requests.length, 'Each SDK query is closed, including stopped/failed attempts');
  await stageClaudeSdk(join(process.cwd(), 'node_modules'), directory);
  const sdk = await import(pathToFileURL(join(directory, 'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs')));
  assert.equal(typeof sdk.query, 'function', 'Packaged SDK imports outside this repository');
  console.log('Claude SDK checks passed: permission/profile/folder/MCP mapping, no-tool observation, model-only recovery, canonical aliases, bounded exhaustion, default cooldown, same-session continuation, Stop, silence/runtime limits, query cleanup and isolated packaged import.');
} finally { await rm(directory, { recursive: true, force: true }); }
