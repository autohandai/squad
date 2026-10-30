import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AcpConnection, PROTOCOL_VERSION } from '../acp/client.mjs';
import { detectHarness, isAcpHarness, normalizeHarnessAssignment } from './registry.mjs';
import { guiSafeEnv } from './discovery.mjs';

const TTL = 2 * 60_000;
const PROBE_MS = 12_000;

export function modelRows(input = []) {
  const seen = new Set();
  return (Array.isArray(input) ? input : Object.values(input || {})).flatMap(row => {
    if (typeof row === 'string') row = { id: row };
    if (!row || typeof row !== 'object') return [];
    const id = String(row?.value || row?.modelId || row?.slug || row?.model || row?.id || '').trim();
    if (!id || id.length > 200 || seen.has(id) || row.hidden === true || row.visibility === 'hide' || row.cliSupported === false) return [];
    seen.add(id);
    return [{ id, label: String(row.displayName || row.display_name || row.name || row.label || id), detail: String(row.description || row.detail || ''), ...(Array.isArray(row.supportedEffortLevels) ? { efforts: row.supportedEffortLevels } : Array.isArray(row.supportedReasoningEfforts) ? { efforts: row.supportedReasoningEfforts.map(item => item.reasoningEffort) } : {}) }];
  });
}

/** Read models without sending a prompt or granting file/terminal access. */
export async function probeRpcModels(readiness, { cwd, acp = false, timeoutMs = PROBE_MS, signal } = {}) {
  const child = spawn(readiness.executablePath, acp ? readiness.launchArgs || [] : ['app-server'], {
    cwd, env: guiSafeEnv(process.env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(readiness.executablePath),
  });
  child.stderr.on('data', () => {});
  child.stdin.on('error', () => {});
  const connection = new AcpConnection(child);
  child.on('error', error => connection.close(error));
  const abort = () => connection.close(new Error('Model discovery was cancelled.'));
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const deadline = Date.now() + timeoutMs;
  const request = (method, params) => connection.request(method, params, { timeoutMs: Math.max(1, deadline - Date.now()) });
  try {
    if (acp) {
      await request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'autohand-squad-models', version: '1' } });
      const session = await request('session/new', { cwd, mcpServers: [] });
      const option = session.configOptions?.find(item => item.category === 'model' || item.id === 'model');
      const choices = option?.options?.flatMap(item => item.options || [item]) || [];
      return { models: modelRows(session.models?.availableModels || choices), defaultModel: String(session.models?.currentModelId || option?.currentValue || ''), modelSelection: Boolean(session.models?.availableModels?.length || choices.length) };
    }
    await request('initialize', { clientInfo: { name: 'autohand_squad_models', title: 'Squad model discovery', version: '1' }, capabilities: {} });
    connection.send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    const rows = [];
    let cursor;
    for (let page = 0; page < 20; page++) {
      const result = await request('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      rows.push(...(result.data || []));
      if (!result.nextCursor || result.nextCursor === cursor) break;
      cursor = result.nextCursor;
    }
    return { models: modelRows(rows), defaultModel: String(rows.find(row => row.isDefault)?.model || rows.find(row => row.isDefault)?.id || '') };
  } finally {
    signal?.removeEventListener('abort', abort);
    connection.close(new Error('Model discovery finished.'));
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      let timer;
      await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1000); })]);
      clearTimeout(timer);
    }
  }
}

export async function probeClaudeModels(readiness, { cwd, timeoutMs = PROBE_MS, signal, queryFactory } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  let release;
  let query;
  let timer;
  try {
    const queryFn = queryFactory || (await import('@anthropic-ai/claude-agent-sdk')).query;
    // Keep streaming input open but empty: initialize models without a user
    // message, inference, MCP servers, tool grants or a persisted chat.
    const prompt = (async function* () { await new Promise(resolve => { release = resolve; }); })();
    query = queryFn({ prompt, options: { cwd, pathToClaudeCodeExecutable: readiness.executablePath, abortController: controller, settingSources: ['user', 'project', 'local'], settings: { disableAllHooks: true }, tools: [], mcpServers: {}, strictMcpConfig: true, persistSession: false, env: guiSafeEnv(process.env) } });
    const models = await Promise.race([query.supportedModels(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Claude model discovery timed out.')); }, timeoutMs); })]);
    return { models: modelRows(models) };
  } finally {
    clearTimeout(timer); release?.(); controller.abort(); query?.close();
    signal?.removeEventListener('abort', abort);
  }
}

export function createModelCatalog({ autohandHomeDir, readProviderSettings, contextFor, defaultWorkspace }) {
  const cache = new Map();
  const pending = new Map();
  async function discover(input, signal) {
    const assignment = normalizeHarnessAssignment(input);
    const provider = String(input.provider || '');
    const cwd = input.workspace || defaultWorkspace();
    if (assignment.id === 'autohand') {
      const settings = await readProviderSettings();
      const providerId = provider || settings.defaultProvider;
      if (!settings.providers?.[providerId]) throw Object.assign(new Error('Choose a known provider.'), { status: 400 });
      let catalog = {};
      try { catalog = JSON.parse(await readFile(join(autohandHomeDir, 'model-catalog', 'models.json'), 'utf8')); } catch {}
      const providerCatalog = catalog.providers?.[providerId] || catalog[providerId];
      const models = modelRows(providerCatalog?.models || providerCatalog || settings.providers[providerId].models || []);
      return { harness: assignment.id, provider: providerId, models, defaultModel: settings.providers[providerId].model || providerCatalog?.defaultModel || '', source: providerCatalog ? 'harness-catalog' : 'provider-catalog', modelSelection: true };
    }
    const readiness = await detectHarness(assignment.id, { explicitPath: assignment.executablePath, refresh: input.refresh, context: contextFor(assignment.id) });
    if (readiness.status !== 'ready') return { harness: assignment.id, models: modelRows(readiness.models), defaultModel: readiness.defaults?.model || '', source: 'unavailable', detail: readiness.detail, modelSelection: !isAcpHarness(assignment) };
    let discovered;
    try {
      if (assignment.id === 'codex') discovered = await probeRpcModels(readiness, { cwd, signal });
      else if (assignment.id === 'claude') discovered = await probeClaudeModels(readiness, { cwd, signal });
      else if (readiness.fetchOnUse && !readiness.installed) return { harness: assignment.id, models: [], source: 'unavailable', detail: 'Start this engine once to prepare it before loading its models.', modelSelection: false };
      else discovered = await probeRpcModels(readiness, { cwd, acp: true, signal });
      return { harness: assignment.id, ...discovered, defaultModel: discovered.defaultModel || readiness.defaults?.model || '', source: 'engine', modelSelection: discovered.modelSelection !== false };
    } catch (error) {
      if (signal?.aborted) throw error;
      const previous = cache.get(input.key)?.data;
      return { harness: assignment.id, models: previous?.models || modelRows(readiness.models), defaultModel: previous?.defaultModel || readiness.defaults?.model || '', modelSelection: previous?.modelSelection ?? !isAcpHarness(assignment), source: previous ? 'cached' : 'cli-settings', stale: true, detail: `Could not refresh models: ${error.message}` };
    }
  }
  return {
    async get(input = {}, { signal } = {}) {
      const key = JSON.stringify([input.id || 'autohand', input.executablePath || '', input.provider || '', input.workspace || defaultWorkspace()]);
      const saved = cache.get(key);
      if (!input.refresh && saved && Date.now() - saved.at < TTL) return saved.data;
      if (pending.has(key)) return pending.get(key);
      const work = discover({ ...input, key }, signal).then(data => {
        const value = { ...data, checkedAt: new Date().toISOString() };
        if (!value.stale) cache.set(key, { at: Date.now(), data: value });
        while (cache.size > 128) cache.delete(cache.keys().next().value);
        return value;
      }).finally(() => pending.delete(key));
      pending.set(key, work);
      return work;
    },
  };
}
