import { harnessLabel, normalizeHarnessAssignment, normalizeHarnessId } from './harness.js';

export function fallbackLabel(routing, { model = true } = {}) {
  if (!routing?.fallback || !routing.used?.harness) return '';
  return `fallback via ${harnessLabel(routing.used.harness)}${model && routing.used.model ? ` · ${routing.used.model}` : ''}`;
}

export const MAX_FALLBACKS = 4;
export function routeKey(route) { return JSON.stringify([route.harness.id, route.harness.executablePath || '', route.provider || '', route.harness.model || '']); }
export function normalizeModelRouting(value, { strict = false } = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const rows = Array.isArray(source.fallbacks) ? source.fallbacks : [];
  if (strict && (!Array.isArray(source.fallbacks) || rows.length > MAX_FALLBACKS)) throw new Error(`Choose up to ${MAX_FALLBACKS} fallbacks.`);
  const seen = new Set();
  const fallbacks = [];
  for (const row of rows.slice(0, MAX_FALLBACKS)) {
    const raw = String(row?.harness?.id || row?.id || '').trim().toLowerCase();
    const id = normalizeHarnessId(raw);
    if (!raw || (id === 'autohand' && !['autohand', 'autohand-code', 'autohandai'].includes(raw))) { if (strict) throw new Error('Choose a known coding engine.'); continue; }
    const normalized = normalizeHarnessAssignment({ ...row.harness, id });
    // A fallback selects an engine/model, never a broader permission mode.
    const { access: _access, ...harness } = normalized;
    const route = { harness, ...(id === 'autohand' && row.provider ? { provider: String(row.provider).trim().slice(0, 100) } : {}) };
    const key = routeKey(route);
    if (seen.has(key)) { if (strict) throw new Error('This engine and model is already a fallback.'); continue; }
    seen.add(key); fallbacks.push(route);
  }
  return { version: 1, fallbacks, allowAgentChanges: source.allowAgentChanges === true };
}

export function primaryRoute(payload) {
  const harness = normalizeHarnessAssignment(payload.agent?.harness);
  return { harness: { ...harness, model: String(payload.model || harness.model || (harness.id === 'autohand' && payload.agent?.modelAssignment?.mode === 'override' ? payload.agent.modelAssignment.model : '') || ''), effort: String(payload.effort || harness.effort || '') }, ...(harness.id === 'autohand' && payload.agent?.modelAssignment?.mode === 'override' ? { provider: payload.agent.modelAssignment.provider } : {}) };
}
