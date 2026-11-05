import { spawn } from 'node:child_process';
import { guiSafeEnv } from './discovery.mjs';

const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value * 10) / 10 : null;
const date = value => { const at = typeof value === 'number' ? value * 1000 : Date.parse(value || ''); return Number.isFinite(at) && at > 0 && at <= 8.64e15 ? new Date(at).toISOString() : null; };
const label = value => String(value || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80);
const window = (id, name, used, reset) => ({ id, label: label(name), usedPercent: percent(used), resetsAt: date(reset) });

export function normalizeCodexUsage(input) {
  const reported = input?.rateLimitsByLimitId && typeof input.rateLimitsByLimitId === 'object' ? Object.entries(input.rateLimitsByLimitId).slice(0, 4) : [];
  const buckets = reported.length ? reported : [['codex', input?.rateLimits]];
  return buckets.flatMap(([id, bucket]) => ['primary', 'secondary'].flatMap(key => {
    const item = bucket?.[key];
    if (!item || typeof item !== 'object') return [];
    const minutes = item.windowDurationMins;
    const duration = minutes === 10080 ? 'Weekly' : minutes === 300 ? '5 h' : minutes === 1440 ? 'Daily' : Number.isFinite(minutes) && minutes > 0 ? `${minutes} min` : key === 'secondary' ? 'Weekly' : 'Session';
    return [window(`${id}:${key}`, [bucket.limitName, duration].filter(Boolean).join(' · '), item.usedPercent, item.resetsAt)];
  })).slice(0, 8);
}

export function normalizeClaudeUsage(input) {
  if (input?.rate_limits_available !== true || !input.rate_limits) return [];
  const limits = input.rate_limits;
  return [...[['five_hour', '5 h'], ['seven_day', 'Weekly'], ['seven_day_opus', 'Opus'], ['seven_day_sonnet', 'Sonnet'], ['seven_day_oauth_apps', 'Apps']].flatMap(([id, name]) => limits[id] ? [window(id, name, limits[id].utilization, limits[id].resets_at)] : []),
    ...(Array.isArray(limits.model_scoped) ? limits.model_scoped.slice(0, 8).map((item, index) => window(`model:${index}`, item.display_name || 'Model', item.utilization, item.resets_at)) : [])].slice(0, 8);
}

export function readCodexUsage(executable, { timeoutMs = 10000, env = process.env, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(executable, ['app-server'], { env: guiSafeEnv(env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let done = false, buffer = '', bytes = 0, killTimer;
    const finish = (error, value) => {
      if (done) return;
      done = true; clearTimeout(timer);
      child.stdin.end();
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 500); killTimer.unref?.();
      error ? reject(error) : resolve(value);
    };
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    const timer = setTimeout(() => finish(new Error('Usage request timed out.')), timeoutMs);
    child.on('error', () => finish(new Error('The harness could not be started.')));
    child.on('exit', () => { clearTimeout(killTimer); if (!done) finish(new Error('The harness did not report usage.')); });
    child.stdin.on('error', () => { if (!done) finish(new Error('The usage connection closed.')); });
    child.stderr.on('data', () => {});
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 2_000_000) return finish(new Error('Usage response exceeded its limit.'));
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\n'); if (end < 0) break;
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let frame; try { frame = JSON.parse(line); } catch { continue; }
        if (frame.id === 1) {
          if (frame.error) return finish(new Error('This Codex version does not report account limits.'));
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'account/rateLimits/read', params: {} });
        } else if (frame.id === 2) return finish(frame.error ? new Error('Account limits are unavailable for this connection.') : null, frame.result);
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'autohand_squad_usage', title: 'Squad usage', version: '1' }, capabilities: {} } });
  });
}

export async function readClaudeUsage(executable, { timeoutMs = 10000, cwd, env = process.env, queryFactory } = {}) {
  const controller = new AbortController();
  let release;
  const prompt = { async *[Symbol.asyncIterator]() { await new Promise(resolve => { release = resolve; }); } };
  const query = queryFactory || (await import('@anthropic-ai/claude-agent-sdk')).query;
  let session, timer;
  try {
    session = query({ prompt, options: { pathToClaudeCodeExecutable: executable, cwd, env: guiSafeEnv({ ...env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }), abortController: controller, tools: [], mcpServers: {}, settingSources: [], persistSession: false } });
    const method = session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    if (typeof method !== 'function') throw new Error('This Claude Code version does not report usage.');
    return await Promise.race([method.call(session, { skipBehaviors: true }), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Usage request timed out.')); }, timeoutMs); })]);
  } finally { clearTimeout(timer); release?.(); controller.abort(); session?.close(); }
}

export function createHarnessUsage({ listHarnesses, cwd, readers = { codex: readCodexUsage, claude: readClaudeUsage }, now = Date.now, ttlMs = 60000 }) {
  let cached, expiresAt = 0, pending, lastStarted = -Infinity;
  return async ({ force = false } = {}) => {
    if (pending) return pending;
    if (cached && now() < expiresAt && (!force || now() - lastStarted < 10000)) return cached;
    lastStarted = now();
    pending = (async () => {
      const connected = (await listHarnesses()).filter(item => ['codex', 'claude'].includes(item.id) && item.status === 'ready').slice(0, 2);
      const harnesses = await Promise.all(connected.map(async harness => {
        const base = { id: harness.id, label: harness.label || (harness.id === 'codex' ? 'Codex' : 'Claude Code'), updatedAt: new Date(now()).toISOString() };
        try {
          const data = await readers[harness.id](harness.executablePath, { cwd });
          const windows = harness.id === 'codex' ? normalizeCodexUsage(data) : normalizeClaudeUsage(data);
          return { ...base, status: windows.length ? 'available' : 'unavailable', windows, ...(windows.length ? {} : { message: 'Plan limits are not reported for this connection.' }) };
        } catch { return { ...base, status: 'unavailable', windows: [], message: 'Usage is unavailable. Check this harness’s connection or version.' }; }
      }));
      cached = { harnesses, updatedAt: new Date(now()).toISOString() }; expiresAt = now() + ttlMs;
      return cached;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
