#!/usr/bin/env node
// Deterministic checks for the harness adapters: assignment normalisation,
// argument construction, JSONL parsing, and the generic runner using a fake
// harness executable. No vendor CLI or network access is required.

import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import {
  DEFAULT_HARNESS_ID,
  claudeAdapter,
  codexAdapter,
  getAdapter,
  isExternalHarness,
  normalizeHarnessAssignment,
  normalizeHarnessId,
  readResumeId,
  runExternalHarness,
  writeResumeId,
} from '../server/harness/index.mjs';

function parseState() {
  return {
    resumeId: '',
    sequence: 0,
    sawDelta: false,
    startedTools: new Set(),
    toolNames: new Map(),
    warnings: [],
    timestamp: () => '2026-01-01T00:00:00.000Z',
  };
}

// --- assignment normalisation -------------------------------------------------
assert.equal(normalizeHarnessId(''), DEFAULT_HARNESS_ID);
assert.equal(normalizeHarnessId('Claude-Code'), 'claude');
assert.equal(normalizeHarnessId('openai-codex'), 'codex');
assert.equal(normalizeHarnessId('nope'), DEFAULT_HARNESS_ID);
assert.deepEqual(normalizeHarnessAssignment(undefined), { schemaVersion: 1, id: 'autohand', executablePath: '', model: '', effort: '', access: '' });
assert.deepEqual(normalizeHarnessAssignment({ id: 'codex', model: ' gpt-5 ', executablePath: '' }), {
  schemaVersion: 1,
  id: 'codex',
  executablePath: '',
  model: 'gpt-5',
  effort: '',
  access: '',
});
assert.deepEqual(normalizeHarnessAssignment({ id: 'claude', effort: ' High ', access: 'PLAN' }), { schemaVersion: 1, id: 'claude', executablePath: '', model: '', effort: 'high', access: 'plan' }, 'effort and access are normalised');
assert.equal(normalizeHarnessAssignment({ id: 'claude', effort: 'not a level!', access: 'root' }).effort, '', 'an invalid effort is dropped');
assert.equal(normalizeHarnessAssignment({ id: 'claude', access: 'root' }).access, '', 'an unknown access is dropped');
assert.equal(isExternalHarness('autohand'), false);
assert.equal(isExternalHarness({ id: 'claude' }), true);
assert.equal(getAdapter('codex').id, 'codex');

// --- codex args ---------------------------------------------------------------
{
  const { args, displayArgs } = codexAdapter.buildArgs({
    prompt: 'hello',
    workspace: '/w',
    model: 'gpt-5',
    permissions: { permissionMode: 'restricted' },
    appendSystemPrompt: 'rules',
    addDirs: ['/x'],
  });
  assert.equal(args[0], 'exec');
  assert.ok(args.includes('--json'));
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(args[args.indexOf('-C') + 1], '/w');
  assert.equal(args[args.indexOf('-m') + 1], 'gpt-5');
  assert.ok(args.at(-1).startsWith('<operating_instructions>'), 'profile is prepended to the first turn');
  assert.ok(args.at(-1).endsWith('hello'));
  assert.equal(displayArgs.at(-1), '<prompt>');
  assert.ok(!displayArgs.includes('/x'), 'display args redact directories');

  const resumed = codexAdapter.buildArgs({ prompt: 'again', workspace: '/w', resumeId: 'thread-1', permissions: { permissionMode: 'unrestricted' } });
  assert.deepEqual(resumed.args.slice(0, 3), ['exec', 'resume', 'thread-1']);
  assert.ok(!resumed.args.includes('--sandbox'), 'resume keeps the thread sandbox');
  const unrestricted = codexAdapter.buildArgs({ prompt: 'x', workspace: '/w', permissions: { permissionMode: 'unrestricted' } });
  assert.equal(unrestricted.args[unrestricted.args.indexOf('--sandbox') + 1], 'danger-full-access');

  // Access and effort (ADR-0114): an explicit access wins over the member's
  // permission level; effort travels as a config override, also on resume.
  const explicit = codexAdapter.buildArgs({ prompt: 'x', workspace: '/w', permissions: { permissionMode: 'restricted' }, access: 'write', effort: 'high' });
  assert.equal(explicit.args[explicit.args.indexOf('--sandbox') + 1], 'workspace-write', 'a restricted member can be given workspace write for one turn');
  assert.equal(explicit.args[explicit.args.indexOf('-c') + 1], 'model_reasoning_effort="high"');
  const full = codexAdapter.buildArgs({ prompt: 'x', workspace: '/w', permissions: { permissionMode: 'restricted' }, access: 'full' });
  assert.equal(full.args[full.args.indexOf('--sandbox') + 1], 'danger-full-access');
  const badEffort = codexAdapter.buildArgs({ prompt: 'x', workspace: '/w', effort: 'turbo' });
  assert.ok(!badEffort.args.includes('-c'), 'an effort Codex does not document is not sent');
  const resumedEffort = codexAdapter.buildArgs({ prompt: 'x', workspace: '/w', resumeId: 't', effort: 'xhigh' });
  assert.equal(resumedEffort.args[resumedEffort.args.indexOf('-c') + 1], 'model_reasoning_effort="xhigh"', 'effort still applies on a resumed thread');
  assert.deepEqual(codexAdapter.parseCodexConfig('model = "gpt-6.1-sol"\nmodel_reasoning_effort = "xhigh"\n[tui]\nmodel = "other"\n'), { model: 'gpt-6.1-sol', effort: 'xhigh' }, 'only top-level keys count');
  assert.deepEqual(codexAdapter.parseCodexConfig(''), { model: '', effort: '' });
}

// --- claude args --------------------------------------------------------------
{
  const { args } = claudeAdapter.buildArgs({
    prompt: 'hello',
    workspace: '/w',
    model: 'sonnet',
    permissions: { permissionMode: 'interactive' },
    appendSystemPrompt: 'rules',
    addDirs: ['/x'],
    resumeId: 'sess-1',
  });
  assert.deepEqual(args.slice(0, 2), ['-p', 'hello'], 'prompt is bound to -p before variadic options');
  assert.equal(args[args.indexOf('--resume') + 1], 'sess-1');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.equal(args.filter((item) => item === '--add-dir').length, 2, 'each directory uses its own --add-dir flag');
  assert.equal(args.at(-1), '/x', 'nothing follows the last --add-dir value');
  const restricted = claudeAdapter.buildArgs({ prompt: 'x', workspace: '/w', permissions: { permissionMode: 'restricted' } });
  assert.equal(restricted.args[restricted.args.indexOf('--permission-mode') + 1], 'plan');
  const bypass = claudeAdapter.buildArgs({ prompt: 'x', workspace: '/w', permissions: { permissionMode: 'unrestricted' } });
  assert.ok(bypass.args.includes('--dangerously-skip-permissions'));

  // Access and effort (ADR-0114).
  const planOff = claudeAdapter.buildArgs({ prompt: 'x', workspace: '/w', permissions: { permissionMode: 'restricted' }, policy: 'restricted', access: 'write', effort: 'high', efforts: ['low', 'medium', 'high'] });
  assert.equal(planOff.args[planOff.args.indexOf('--permission-mode') + 1], 'acceptEdits', 'plan mode can be switched off for a restricted member');
  assert.equal(planOff.args[planOff.args.indexOf('--effort') + 1], 'high');
  const planOn = claudeAdapter.buildArgs({ prompt: 'x', workspace: '/w', permissions: { permissionMode: 'unrestricted' }, access: 'plan' });
  assert.equal(planOn.args[planOn.args.indexOf('--permission-mode') + 1], 'plan', 'plan mode can be switched on for an unrestricted member');
  assert.ok(!planOn.args.includes('--dangerously-skip-permissions'));
  const unsupported = claudeAdapter.buildArgs({ prompt: 'x', workspace: '/w', effort: 'max', efforts: ['low', 'medium', 'high'] });
  assert.ok(!unsupported.args.includes('--effort'), 'an effort this binary does not list is not sent');
  const unknownList = claudeAdapter.buildArgs({ prompt: 'x', workspace: '/w', effort: 'max', efforts: [] });
  assert.equal(unknownList.args[unknownList.args.indexOf('--effort') + 1], 'max', 'no list known: the value goes through');
  const help = `  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
  --model <model>                       Model for the current session. Provide
                                        an alias for the latest model (e.g.
                                        'fable', 'opus', or 'sonnet') or a
                                        model's full name.
  -n, --name <name>                     Set a display name for this session
  --permission-mode <mode>              Permission mode to use for the session
                                        (choices: "acceptEdits", "auto",
                                        "bypassPermissions", "manual",
                                        "dontAsk", "plan")
`;
  assert.deepEqual(claudeAdapter.parseClaudeHelp(help), { efforts: ['low', 'medium', 'high', 'xhigh', 'max'], permissionModes: ['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan'], modelAliases: ['fable', 'opus', 'sonnet', 'haiku'] }, 'the option lists come from the binary\'s own help');
  assert.deepEqual(claudeAdapter.parseClaudeHelp(''), { efforts: [], permissionModes: [], modelAliases: [] }, 'an older binary without --effort offers nothing');
}

// --- codex parsing ------------------------------------------------------------
{
  const state = parseState();
  const lines = [
    { type: 'thread.started', thread_id: 't-1' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'w', type: 'error', message: 'skills budget shortened' } },
    { type: 'item.started', item: { id: 'c1', type: 'command_execution', command: 'ls', status: 'in_progress' } },
    { type: 'item.completed', item: { id: 'c1', type: 'command_execution', command: 'ls', aggregated_output: 'a\nb', exit_code: 0 } },
    { type: 'item.completed', item: { id: 'r', type: 'reasoning', text: 'thinking' } },
    { type: 'item.completed', item: { id: 'm', type: 'agent_message', text: 'pong' } },
    { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } },
  ];
  const events = lines.flatMap((line) => codexAdapter.parseLine(JSON.stringify(line), state));
  const types = events.map((event) => event.type);
  assert.deepEqual(types, ['agent_start', 'status', 'tool_update', 'tool_start', 'tool_end', 'message_update', 'message_end', 'usage', 'agent_end']);
  assert.equal(codexAdapter.resumeIdFrom(state), 't-1');
  assert.equal(state.warnings.length, 1, 'non-fatal codex error items become warnings');
  assert.ok(!events.some((event) => event.type === 'error'));
  const failed = codexAdapter.parseLine(JSON.stringify({ type: 'turn.failed', error: { message: 'boom' } }), state);
  assert.equal(failed[0].type, 'error');
  assert.equal(codexAdapter.parseLine('not json', state)[0].type, 'raw');
}

// --- claude parsing -----------------------------------------------------------
{
  const state = parseState();
  const lines = [
    { type: 'system', subtype: 'init', session_id: 's-1', model: 'claude' },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'po' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ng' } } },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'pong' }, { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'a\nb', is_error: false }] } },
    { type: 'result', subtype: 'success', result: 'pong', session_id: 's-1', usage: { input_tokens: 1, output_tokens: 1 } },
  ];
  const events = lines.flatMap((line) => claudeAdapter.parseLine(JSON.stringify(line), state));
  const types = events.map((event) => event.type);
  assert.deepEqual(types, ['agent_start', 'message_update', 'message_update', 'message_end', 'tool_start', 'tool_end', 'usage', 'agent_end']);
  assert.equal(events.find((event) => event.type === 'tool_end').toolName, 'Bash');
  assert.equal(claudeAdapter.resumeIdFrom(state), 's-1');
  const errored = claudeAdapter.parseLine(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'too many turns' }), parseState());
  assert.equal(errored.at(-1).type, 'error');
}

// --- session store ------------------------------------------------------------
{
  const home = await mkdtemp(join(tmpdir(), 'squad-harness-store-'));
  try {
    assert.equal(await readResumeId(home, 'codex', '/w'), '');
    await writeResumeId(home, 'codex', '/w', 'thread-9');
    assert.equal(await readResumeId(home, 'codex', '/w'), 'thread-9');
    await writeResumeId(home, 'codex', '/w', '');
    assert.equal(await readResumeId(home, 'codex', '/w'), '');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

// --- generic runner with a fake harness ---------------------------------------
{
  const dir = await mkdtemp(join(tmpdir(), 'squad-fake-harness-'));
  const script = join(dir, 'fake-harness.mjs');
  await writeFile(
    script,
    [
      'const lines = [',
      '  { type: "thread.started", thread_id: "fake-thread" },',
      '  { type: "item.completed", item: { id: "m", type: "agent_message", text: "fake reply" } },',
      '  { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },',
      '];',
      'for (const line of lines) process.stdout.write(JSON.stringify(line) + "\\n");',
      'process.stderr.write("diagnostic\\n");',
    ].join('\n'),
    'utf8',
  );
  await chmod(script, 0o755);
  try {
    const seen = [];
    const output = await runExternalHarness({
      adapter: codexAdapter,
      executable: process.execPath,
      args: [script],
      cwd: dir,
      timeoutMs: 20000,
      firstEventTimeoutMs: 20000,
      onEvent: (event) => seen.push(event.type),
    });
    assert.equal(output.error, '', `fake run should succeed: ${output.error}`);
    assert.equal(output.exitCode, 0);
    assert.equal(output.resumeId, 'fake-thread');
    assert.ok(seen.includes('message_end'));
    assert.ok(output.rawStderr.includes('diagnostic'));

    const controller = new AbortController();
    const hang = join(dir, 'hang.mjs');
    await writeFile(hang, 'process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "h" }) + "\\n"); setInterval(() => {}, 1000);', 'utf8');
    setTimeout(() => controller.abort(), 300);
    const aborted = await runExternalHarness({
      adapter: codexAdapter,
      executable: process.execPath,
      args: [hang],
      cwd: dir,
      timeoutMs: 20000,
      signal: controller.signal,
    });
    assert.equal(aborted.stopped, true, 'abort signal stops the child');
    assert.match(aborted.error, /stopped by the user/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

console.log('Harness adapter checks passed.');
