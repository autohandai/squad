// Per-member context gauge (ADR-0111). Pure: no I/O, unit-checked by
// scripts/check-queues.mjs.
//
// A harness reports token usage for the turn it just finished. The tokens the
// model read on the *last request* of that turn are the best available
// measure of how full the member's context is, because the next request
// re-sends that context plus whatever the turn added. The gauge is only a
// number when both halves are known: the tokens the harness reported and the
// window of the model that read them. Guessing either half would show a
// confident percentage that is wrong, so unknown means absent.
//
// What each harness reports (checked against the adapters in server/harness
// and the fixture in scripts/check-queues.mjs):
//
//   Claude Code  `result` → usage { input_tokens, cache_creation_input_tokens,
//                cache_read_input_tokens, output_tokens } and, in current
//                builds, modelUsage[model].contextWindow. Context = the sum of
//                the three input figures; cache reads are context the model
//                saw even though they are billed differently.
//   Codex        `turn.completed` → usage { input_tokens, cached_input_tokens,
//                output_tokens }; input_tokens already includes the cached
//                part. No window is reported, so the gauge needs a catalog
//                window for the model, which the bridge does not have for
//                OpenAI models today: absent.
//   Autohand SDK no usage event reaches the trace today; only
//                `hook_context_overflow` with usagePercent once the ceiling
//                is hit (server/sdk-events.mjs). Absent until it reports.

export const CONTEXT_WARNING_PERCENT = 85;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function first(source, keys) {
  for (const key of keys) {
    const value = number(source?.[key]);
    if (value) return value;
  }
  return 0;
}

/**
 * `{ contextTokens, contextWindow }` from a harness usage object. Either value
 * is 0 when the harness did not say.
 */
export function contextUsageFromUsage(usage) {
  if (!usage || typeof usage !== "object") return { contextTokens: 0, contextWindow: 0 };
  const input = first(usage, ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens"]);
  const cacheCreation = first(usage, ["cache_creation_input_tokens", "cacheCreationInputTokens"]);
  const cacheRead = first(usage, ["cache_read_input_tokens", "cacheReadInputTokens"]);
  // Codex folds cached input into input_tokens; Claude reports it beside.
  const contextTokens = input + cacheCreation + cacheRead;
  let contextWindow = first(usage, ["contextWindow", "context_window", "model_context_window", "modelContextWindow"]);
  if (!contextWindow && usage.modelUsage && typeof usage.modelUsage === "object") {
    for (const entry of Object.values(usage.modelUsage)) {
      contextWindow = first(entry, ["contextWindow", "context_window"]);
      if (contextWindow) break;
    }
  }
  return { contextTokens, contextWindow };
}

/**
 * The gauge the UI shows, or null when either half is unknown.
 * `percent` is rounded to a whole number and capped at 100.
 */
export function contextGauge({ contextTokens, contextWindow, model = "", harness = "", at = "" } = {}) {
  const used = number(contextTokens);
  const window = number(contextWindow);
  if (!used || !window) return null;
  const percent = Math.min(100, Math.round((used / window) * 100));
  return { percent, usedTokens: used, window, warning: percent >= CONTEXT_WARNING_PERCENT, model: String(model || ""), harness: String(harness || ""), at: String(at || "") };
}
