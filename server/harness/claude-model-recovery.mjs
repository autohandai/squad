// Recovery is limited to a named model's exhausted allowance. A listed model
// is a candidate, not proof of remaining allowance; only a completed turn is.
export const MAX_MODEL_SWITCHES = 3;
export const UNKNOWN_RESET_COOLDOWN_MS = 5 * 60_000;

export function modelLimit(message, rateLimitInfo, errorCode = '') {
  if (errorCode && errorCode !== 'rate_limit') return null;
  const type = String(rateLimitInfo?.rateLimitType || '');
  const text = String(message || '');
  const named = text.match(/(?:you(?:'|’)?ve|you have)\s+(?:reached|hit)\s+your\s+([\w.-]+)\s+limit\b/i);
  // Claude 2.1.296 reports a Fable-only refusal in the overage-included
  // bucket while its unified five-hour/week windows still have capacity.
  // The bucket alone is not evidence that every model is exhausted.
  const windows = rateLimitInfo?.unifiedWindows;
  const accountFull = ['five_hour', 'seven_day'].some(window => Number(windows?.[window]?.utilization) >= 1);
  if (accountFull) return null;
  if (rateLimitInfo?.status === 'rejected' && ['five_hour', 'seven_day', 'overage'].includes(type)) return null;
  if (type === 'seven_day_overage_included' && !named) return null;
  const typed = type.match(/^seven_day_(?!overage)([\w.-]+)$/);
  if (!named && !(rateLimitInfo?.status === 'rejected' && typed)) return null;
  return { model: (named?.[1] || typed[1]).toLowerCase(), resetsAt: rateLimitInfo?.resetsAt };
}

export function modelIds(model) {
  const ids = [model?.value || model?.id, model?.resolvedModel].filter(value => typeof value === 'string' && value).map(value => value.toLowerCase());
  return [...new Set(ids.flatMap(value => [value, value.match(/^claude-([a-z]+)(?:-|$)/)?.[1]].filter(Boolean)))];
}

export function fallbackCandidates(models, currentModel, blocked, now = Date.now()) {
  const current = String(currentModel || '').toLowerCase();
  const currentRow = models.find(row => modelIds(row).includes(current));
  const excluded = new Set([current, ...modelIds(currentRow)]);
  const seen = new Set();
  return models.filter(row => {
    const ids = modelIds(row);
    const id = row.value || row.id;
    if (!id || seen.has(id) || ids.some(value => excluded.has(value) || Number(blocked?.[value]?.until) > now)) return false;
    ids.forEach(value => seen.add(value));
    return true;
  });
}

export function limitCooldown(limit, now = Date.now()) {
  const reset = Number(limit?.resetsAt) * 1000;
  // Ignore stale/invalid reset receipts; a finite cooldown permits a later
  // recheck without immediately hammering the same exhausted model.
  return Number.isFinite(reset) && reset > now ? Math.min(reset, now + 8 * 24 * 60 * 60_000) : now + UNKNOWN_RESET_COOLDOWN_MS;
}
