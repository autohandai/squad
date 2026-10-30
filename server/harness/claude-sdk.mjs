import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { guiSafeEnv } from './discovery.mjs';
import { formatDuration } from '../../src/lib/duration.js';
import { fallbackCandidates, limitCooldown, MAX_MODEL_SWITCHES, modelIds, modelLimit } from './claude-model-recovery.mjs';
import { attachmentLogReplacer, claudePromptInput } from '../attachments.mjs';

const routingWrites = new Map();
const recoveryPrompt = 'Continue the interrupted task from this conversation, from the last unfinished step. The previous model reached its model-specific usage limit. Preserve completed work; do not repeat completed tool calls or resubmit completed actions.';

export async function claudeSdkOptions({ args, executable, cwd, env, controller }) {
  const options = {
    cwd, pathToClaudeCodeExecutable: executable, abortController: controller,
    env: guiSafeEnv({ ...env, FORCE_COLOR: '0', NO_COLOR: '1' }),
    includePartialMessages: true, settingSources: ['user', 'project', 'local'],
    additionalDirectories: [], extraArgs: {},
    // SDK owns the protocol and graceful shutdown; the app owns a hidden,
    // piped child, never a terminal window or independent process session.
    spawnClaudeCodeProcess: spec => spawn(spec.command, spec.args, {
      cwd: spec.cwd, env: spec.env, signal: spec.signal,
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    }),
  };
  let prompt = '';
  let appended = '';
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === '-p') prompt = args[++i];
    else if (flag === '--output-format') i += 1;
    else if (flag === '--verbose' || flag === '--include-partial-messages') continue;
    else if (flag === '--model') options.model = args[++i];
    else if (flag === '--resume') options.resume = args[++i];
    else if (flag === '--permission-mode') options.permissionMode = args[++i];
    else if (flag === '--dangerously-skip-permissions') options.allowDangerouslySkipPermissions = true;
    else if (flag === '--effort') options.effort = args[++i];
    else if (flag === '--append-system-prompt') appended = args[++i];
    else if (flag === '--add-dir') options.additionalDirectories.push(args[++i]);
    else if (flag === '--tools') options.tools = args[++i].split(',').filter(Boolean);
    else if (flag === '--mcp-config') {
      const source = args[++i];
      const config = JSON.parse(source.trim().startsWith('{') ? source : await readFile(source, 'utf8'));
      options.mcpServers = { ...options.mcpServers, ...config.mcpServers };
    } else if (flag.startsWith('--')) {
      options.extraArgs[flag.slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : null;
    } else throw new Error(`Unsupported Claude SDK argument: ${flag}`);
  }
  if (env?.AUTOHAND_SQUAD_OBSERVATION === '1') options.settingSources = [];
  options.systemPrompt = { type: 'preset', preset: 'claude_code', ...(appended ? { append: appended } : {}) };
  return { prompt, options };
}

async function readRouting(path) {
  if (!path) return {};
  try { const data = JSON.parse(await readFile(path, 'utf8')); return data.version === 1 && data.routes && typeof data.routes === 'object' ? data.routes : {}; } catch { return {}; }
}

async function saveRoute(path, key, route) {
  if (!path) return;
  const previous = routingWrites.get(path) || Promise.resolve();
  const write = previous.catch(() => {}).then(async () => {
    const routes = await readRouting(path);
    routes[key] = { ...route, updatedAt: Date.now() };
    const bounded = Object.fromEntries(Object.entries(routes).sort((a, b) => Number(b[1]?.updatedAt) - Number(a[1]?.updatedAt)).slice(0, 32));
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, routes: bounded }), { mode: 0o600 });
    await rename(temporary, path);
  });
  routingWrites.set(path, write);
  try { await write; } finally { if (routingWrites.get(path) === write) routingWrites.delete(path); }
}

async function sdkAttempt({ adapter, options, prompt, timeoutMs, inactivityMs, firstEventTimeoutMs, signal, onEvent, queryFactory }) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const events = [];
  const rawMessages = [];
  let rawStderr = '';
  let query;
  let discoveredModels = [];
  let timer;
  let idleTimer;
  let startTimer;
  let timeoutKind = '';
  let stopped = false;
  let stalled = false;
  let sawEvent = false;
  let failure = '';
  let errorCode = '';
  let rateLimitInfo;
  let model = options.model || '';
  const state = { resumeId: options.resume || '', sequence: 0, sawDelta: false, startedTools: new Set(), toolNames: new Map(), warnings: [], timestamp: () => new Date().toISOString() };
  const abort = () => { stopped = true; controller.abort(); };
  const idle = () => {
    if (!(inactivityMs > 0)) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { timeoutKind = 'inactivity'; controller.abort(); }, inactivityMs);
  };
  const deliver = event => {
    events.push(event);
    // Hold terminal errors until the recovery policy has had its chance.
    if (event.type !== 'error') { try { onEvent(event); } catch {} }
  };
  try {
    if (signal?.aborted) { abort(); throw new Error('chat stopped by the user'); }
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { timeoutKind = 'runtime'; controller.abort(); }, timeoutMs);
    idle();
    startTimer = setTimeout(() => { if (!sawEvent) { stalled = true; controller.abort(); } }, firstEventTimeoutMs);
    query = queryFactory({ prompt, options: { ...options, abortController: controller, stderr: text => { rawStderr += text; } } });
    const modelsPromise = query.supportedModels().then(rows => {
      discoveredModels = Array.isArray(rows) ? rows : [];
      return discoveredModels;
    }).catch(() => []);
    for await (const message of query) {
      if (controller.signal.aborted) throw new Error('aborted');
      sawEvent = true; clearTimeout(startTimer); idle();
      rawMessages.push(JSON.stringify(message, attachmentLogReplacer));
      if (message.type === 'system' && message.subtype === 'init') model = message.model || model;
      if (message.type === 'rate_limit_event') rateLimitInfo = message.rate_limit_info;
      if (message.type === 'assistant' && message.error) errorCode = message.error;
      for (const event of adapter.parseLine(JSON.stringify(message), state)) {
        if (event.type === 'error') failure = event.message || failure;
        deliver(event);
      }
    }
    if (controller.signal.aborted) throw new Error('aborted');
    return { events, rawStdout: rawMessages.join('\n'), rawStderr, model, errorCode, rateLimitInfo, models: await modelsPromise, error: failure, resumeId: state.resumeId, exitCode: failure ? 1 : 0, stopped, timedOut: false, stalled: false, durationMs: Date.now() - startedAt };
  } catch (error) {
    const reason = stopped ? 'chat stopped by the user' : timeoutKind
      ? timeoutKind === 'inactivity' ? `Claude Code stopped after ${formatDuration(inactivityMs)} without activity. Retry to continue.` : `Claude Code stopped after ${formatDuration(timeoutMs)} (maximum runtime). Retry to continue.`
      : stalled ? `Claude Code produced no events within ${formatDuration(firstEventTimeoutMs)}. Check its sign-in and retry.` : failure || error?.message || String(error);
    return { events, rawStdout: rawMessages.join('\n'), rawStderr, model, errorCode, rateLimitInfo, models: discoveredModels, error: reason, resumeId: state.resumeId, exitCode: 1, stopped, timedOut: Boolean(timeoutKind), stalled, durationMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer); clearTimeout(idleTimer); clearTimeout(startTimer);
    signal?.removeEventListener('abort', abort);
    query?.close();
  }
}

export async function runClaudeSdk({ adapter, executable, args, cwd, env = {}, timeoutMs = 300000, inactivityMs = 0, firstEventTimeoutMs = 60000, signal, onEvent = () => {}, models = [], modelRecoveryPath = '', modelAccountKey = '', queryFactory, attachments = [] }) {
  const startedAt = Date.now();
  const { prompt, options } = await claudeSdkOptions({ args, executable, cwd, env });
  const key = createHash('sha256').update(`${executable}\n${modelAccountKey}\n${cwd}`).digest('hex');
  const route = (await readRouting(modelRecoveryPath))[key] || {};
  let defaultModel = options.model || route.defaultModel || '';
  const blocked = Object.fromEntries(Object.entries(route.blocked || {}).filter(([name, value]) => /^[\w.:[\]-]{1,160}$/.test(name) && Number(value?.until) > Date.now()));
  if (route.workingModel && Number(blocked[(options.model || route.defaultModel || '').toLowerCase()]?.until) > Date.now()) options.model = route.workingModel;
  if (!queryFactory) ({ query: queryFactory } = await import('@anthropic-ai/claude-agent-sdk'));
  let output;
  let combined = [];
  let stdout = '';
  let stderr = '';
  let switches = 0;
  let nextPrompt = prompt;
  let available = models;
  while (true) {
    const remaining = Math.max(1, timeoutMs - (Date.now() - startedAt));
    output = await sdkAttempt({ adapter, options, prompt: await claudePromptInput(nextPrompt, nextPrompt === recoveryPrompt ? [] : attachments), timeoutMs: remaining, inactivityMs, firstEventTimeoutMs, signal, onEvent, queryFactory });
    if (!defaultModel) defaultModel = output.model;
    combined.push(...output.events); stdout += output.rawStdout + '\n'; stderr += output.rawStderr;
    if (output.models.length) available = output.models;
    if (!output.error) {
      await saveRoute(modelRecoveryPath, key, { ...route, blocked, workingModel: options.model || output.model, defaultModel }).catch(() => {});
      break;
    }
    const limit = modelLimit(output.error, output.rateLimitInfo, output.errorCode);
    if (!limit || output.stopped || output.timedOut || output.stalled || signal?.aborted) break;
    const until = limitCooldown(limit);
    const limitedIds = [limit.model, options.model, output.model].filter(Boolean).map(value => value.toLowerCase());
    const currentRow = available.find(row => modelIds(row).some(id => limitedIds.includes(id)));
    for (const id of [...limitedIds, ...modelIds(currentRow)]) blocked[id] = { until };
    await saveRoute(modelRecoveryPath, key, { ...route, blocked, defaultModel }).catch(() => {});
    if (switches >= MAX_MODEL_SWITCHES || Date.now() - startedAt >= timeoutMs) break;
    // A missing session is safe to retry only before any tool or answer ran.
    if (!output.resumeId && output.events.some(event => ['tool_start', 'message_update', 'message_end'].includes(event.type))) break;
    const candidate = fallbackCandidates(available, output.model || options.model, blocked)[0];
    if (!candidate) break;
    const model = candidate.value || candidate.id;
    const family = model === 'default' && candidate.resolvedModel?.match(/^claude-([a-z]+)(?:-|$)/)?.[1];
    const name = family ? `${family[0].toUpperCase()}${family.slice(1)} (engine default)` : candidate.displayName || candidate.label || model;
    const event = { type: 'status', status: 'model_fallback', label: `${limit.model} limit reached. Continuing with ${name}.`, model, previousModel: output.model || options.model, timestamp: new Date().toISOString() };
    combined.push(event); try { onEvent(event); } catch {}
    options.model = model;
    if (candidate.supportsEffort === false || (Array.isArray(candidate.supportedEffortLevels) && options.effort && !candidate.supportedEffortLevels.includes(options.effort))) delete options.effort;
    if (output.resumeId) { options.resume = output.resumeId; nextPrompt = recoveryPrompt; }
    switches += 1;
  }
  if (output.error) for (const event of output.events.filter(event => event.type === 'error')) { try { onEvent(event); } catch {} }
  return { ...output, events: combined, rawStdout: stdout, rawStderr: stderr, effectiveModel: output.model, modelSwitches: switches, sdkTransport: 'claude-agent-sdk', durationMs: Date.now() - startedAt };
}
