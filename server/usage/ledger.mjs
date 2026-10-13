// Usage ledger (ADR-0105): the per-member, per-model and per-day breakdown
// that /api/analytics serves as `usage.byMember`, `usage.byModel` and
// `usage.byDay`. Pure: it takes the normalized usage records the bridge
// already builds from telemetry.jsonl and the run records, plus the member
// list from web-status.json, and returns rows. No file access here so
// scripts/check-usage-and-system.mjs can import it directly.

export const LEDGER_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

function timestampMillis(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^unix-ms:\d+$/.test(text)) return Number(text.slice("unix-ms:".length));
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function count(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

/** ISO calendar day (UTC) for a record timestamp, or "" when unknown. */
export function usageDayKey(value) {
  const millis = timestampMillis(value);
  if (millis === null) return "";
  return new Date(millis).toISOString().slice(0, 10);
}

/** Member id -> display name from the web-status.json members list. */
export function memberNameMap(members) {
  const map = new Map();
  for (const member of Array.isArray(members) ? members : []) {
    const id = String(member?.id || "").trim();
    const name = String(member?.name || "").trim();
    if (id && name) map.set(id, name);
  }
  return map;
}

/**
 * A telemetry event and the run record it came from describe the same work;
 * when both carry the run id the run record is dropped so tokens are not
 * counted twice. Records without a run id are kept as they are.
 */
export function dedupeUsageRecords(records) {
  const seen = new Set();
  const kept = [];
  for (const record of records) {
    if (!record) continue;
    const runId = String(record.runId || "").trim();
    if (runId && record.source !== "run") seen.add(runId);
  }
  for (const record of records) {
    if (!record) continue;
    const runId = String(record.runId || "").trim();
    if (runId && record.source === "run" && seen.has(runId)) continue;
    kept.push(record);
  }
  return kept;
}

function emptyRow(key, label) {
  return { key, label, runs: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, steps: null, durationMs: 0, lastAt: null };
}

function addRecord(row, record) {
  row.runs += 1;
  row.inputTokens += count(record.inputTokens);
  row.outputTokens += count(record.outputTokens);
  row.totalTokens += count(record.tokens) || count(record.inputTokens) + count(record.outputTokens);
  row.durationMs += count(record.durationMs);
  if (record.steps !== null && record.steps !== undefined && Number.isFinite(Number(record.steps))) {
    row.steps = (row.steps || 0) + Math.max(0, Math.round(Number(record.steps)));
  }
  const at = timestampMillis(record.at);
  if (at !== null && (!row.lastAt || at > timestampMillis(row.lastAt))) row.lastAt = new Date(at).toISOString();
}

function rowsBy(records, keyFor, labelFor) {
  const rows = new Map();
  for (const record of records) {
    const key = keyFor(record);
    if (!rows.has(key)) rows.set(key, emptyRow(key, labelFor(record, key)));
    addRecord(rows.get(key), record);
  }
  return Array.from(rows.values());
}

function byTotals(a, b) {
  return b.totalTokens - a.totalTokens || b.runs - a.runs || b.durationMs - a.durationMs || a.label.localeCompare(b.label);
}

export function modelKey(record) {
  const provider = String(record?.provider || "").trim();
  const model = String(record?.model || "").trim();
  if (!provider && !model) return "unknown";
  return provider && model ? `${provider}/${model}` : model || provider;
}

export function modelLabel(record) {
  const provider = String(record?.provider || "").trim();
  const model = String(record?.model || "").trim();
  if (!provider && !model) return "Unknown model";
  if (provider && model) return `${model} (${provider})`;
  return model || `${provider} default`;
}

/**
 * Build the ledger.
 *   records  normalized usage records: { at, runId?, agentId, provider, model,
 *            tokens, inputTokens, outputTokens, durationMs, steps?, source }
 *   members  web-status.json members ({ id, name })
 *   now      reference time (ms or Date); the window is the last 30 days
 */
export function usageLedger({ records = [], members = [], now = Date.now(), days = LEDGER_WINDOW_DAYS } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const since = nowMs - days * DAY_MS;
  const names = memberNameMap(members);
  const windowed = dedupeUsageRecords(records).filter((record) => {
    const at = timestampMillis(record.at);
    return at !== null && at >= since && at <= nowMs + DAY_MS;
  });

  const byMember = rowsBy(
    windowed,
    (record) => String(record.agentId || "").trim() || "unassigned",
    (record, key) => (key === "unassigned" ? "Unassigned" : names.get(key) || key)
  ).sort(byTotals);

  const byModel = rowsBy(windowed, modelKey, (record) => modelLabel(record)).sort(byTotals);

  const byDay = rowsBy(
    windowed,
    (record) => usageDayKey(record.at),
    (record, key) => key
  )
    .filter((row) => row.key)
    .sort((a, b) => b.key.localeCompare(a.key));

  return {
    ledgerWindowDays: days,
    ledgerSince: new Date(since).toISOString(),
    ledgerRecords: windowed.length,
    byMember,
    byModel,
    byDay,
  };
}

/**
 * Cache keyed on what the ledger reads, so the daemon-backed analytics path
 * (polled every second by the Usage page) does not re-parse a 60 MB
 * telemetry.jsonl on every request. `signature` is whatever the caller can
 * compute cheaply (file size + mtime + live run count).
 */
export function createUsageLedgerCache() {
  let signature = null;
  let value = null;
  return {
    async get(nextSignature, compute) {
      if (value && signature === nextSignature) return value;
      const next = await compute();
      value = next;
      signature = nextSignature;
      return next;
    },
    clear() {
      signature = null;
      value = null;
    },
  };
}
