import { harnessLabel, normalizeHarnessAssignment, normalizeHarnessId } from './harness.js';

export function fallbackLabel(routing, { model = true } = {}) {
  if (!routing?.fallback || !routing.used?.harness) return '';
  return `fallback via ${harnessLabel(routing.used.harness)}${model && routing.used.model ? ` · ${routing.used.model}` : ''}`;
}

export const MAX_FALLBACKS = 4;

export function connectedHarnesses(catalog) {
  return (Array.isArray(catalog) ? catalog : []).filter(engine => engine.status === 'ready' && (!engine.fetchOnUse || engine.installed));
}

/** The company behind an engine: "Autohand" and "Autohand AI" are one. */
export function engineCompany(engine) {
  const raw = String(engine?.vendor || engine?.id || '').toLowerCase().replace(/[<(].*$/, '');
  return raw.replace(/\b(ai|inc|llc|ltd|team)\b\.?/g, '').replace(/[^a-z0-9]/g, '') || String(engine?.id || '');
}
const isAdapter = engine => String(engine?.id || '').startsWith('acp:') || String(engine?.id || '').endsWith('-acp');

/**
 * Automatic fallbacks: one per company, never the primary's own company (its
 * quota and sign-in usually fail together), first-party CLIs before ACP
 * adapters, each with a concrete model when the engine lists one.
 */
export function automaticFallbacks(ready, primary, primaryId) {
  const taken = new Set([engineCompany(primary || { id: primaryId })]);
  const ordered = [...ready.filter(engine => !isAdapter(engine)), ...ready.filter(isAdapter)];
  const routes = [];
  for (const engine of ordered) {
    if (engine.id === primaryId || routes.length >= MAX_FALLBACKS) continue;
    const company = engineCompany(engine);
    if (taken.has(company)) continue;
    taken.add(company);
    const models = Array.isArray(engine.models) ? engine.models.map(item => typeof item === 'string' ? item : item?.id).filter(Boolean) : [];
    routes.push({ harness: normalizeHarnessAssignment({ id: engine.id, model: engine.defaults?.model || models[0] || '', effort: engine.defaults?.effort }) });
  }
  return routes;
}

/** Creation only. Saved/editable routing is never recomputed on later turns. */
export function initialMemberExecution(catalog, { harness, modelRouting } = {}) {
  const engines = Array.isArray(catalog) ? catalog : [];
  const ready = connectedHarnesses(engines);
  const requested = typeof harness === 'string' ? { id: harness } : harness;
  const primaryId = requested?.id || ready.find(engine => engine.isDefault)?.id || ready[0]?.id || 'autohand';
  const primary = engines.find(engine => engine.id === primaryId);
  const assignment = engine => normalizeHarnessAssignment({ id: engine.id, model: engine.defaults?.model, effort: engine.defaults?.effort });
  return {
    harness: normalizeHarnessAssignment({ ...assignment(primary || { id: primaryId }), ...requested,
      model: requested?.model || primary?.defaults?.model || '',
      effort: requested?.effort || primary?.defaults?.effort || '',
    }),
    // An explicit empty list is a user choice, including imported presets.
    modelRouting: modelRouting === undefined
      ? normalizeModelRouting({ fallbacks: automaticFallbacks(ready, primary, primaryId), allowAgentChanges: false })
      : normalizeModelRouting(modelRouting, { strict: true }),
  };
}

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

const ENGINE_REASONS = {
  quota: 'has reached its usage limit', 'sign-in': 'needs sign-in', overload: 'is overloaded',
  startup: 'could not start', timeout: 'did not respond', runtime: 'kept failing',
};

/**
 * Which engine answers this member right now, from the router's saved health
 * (GET /api/members/:id/model-routing). `fallback` is false while the primary
 * answers. The chat header uses this so it never names the primary while a
 * fallback is replying (ADR-0231).
 */
export function engineInUse({ agent, routing, health = {}, harnesses = [], now = Date.now() }) {
  const primary = primaryRoute({ agent });
  const blocked = route => { const entry = health[routeKey(route)]; return entry && Number(entry.blockedUntil) > now ? entry : null; };
  const ready = route => { const engine = harnesses.find(item => item.id === route.harness.id); return !engine || engine.status === 'ready'; };
  const cooling = blocked(primary);
  const primaryLabel = harnessLabel(primary.harness.id);
  if (!cooling) return { fallback: false, route: primary, label: primaryLabel, model: primary.harness.model || '', primaryLabel, sentence: '' };
  const rows = normalizeModelRouting(routing ?? agent?.modelRouting).fallbacks;
  const index = rows.findIndex(row => !blocked(row) && ready(row));
  const phrase = ENGINE_REASONS[cooling.reason] || "can't answer";
  if (index < 0) return { fallback: true, route: null, label: '', model: '', primaryLabel, retryAt: Number(cooling.blockedUntil), sentence: `${primaryLabel} ${phrase} and no fallback can answer right now` };
  const route = rows[index];
  const label = harnessLabel(route.harness.id);
  return { fallback: true, index, route, label, model: route.harness.model || '', primaryLabel, retryAt: Number(cooling.blockedUntil), sentence: `Using ${label} while ${primaryLabel} ${phrase}` };
}
