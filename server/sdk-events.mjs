// Reading failure out of an SDK event stream (ADR-0061).
//
// The Autohand SDK reports provider and session failures as events on the
// stream, not as thrown errors, and each kind carries its text in a different
// field: `error` has `message`, `hook_session_error` and `automode_error` have
// `error`. The bridge's stream loop only ever inspected message and tool
// events, so an errored turn ended cleanly with nothing in it and the empty
// reply became "Autohand returned no chat text." — one sentence standing in for
// a safety block, an oversized payload, a stalled stream and a context
// overflow alike, none of which the user could act on.

/** The event types that mean the turn failed. */
export const SDK_ERROR_EVENT_TYPES = ["error", "hook_session_error", "automode_error"];

function messageOf(event) {
  // `error` uses `message`; the two hook shapes use `error`.
  const text = String(event?.message ?? event?.error ?? "").trim();
  return text;
}

/**
 * The first failure on the stream, or null. First rather than last: a stalled
 * stream or an aborted session usually follows the real cause, and the first
 * one is what the user needs to read.
 */
export function firstSdkError(events) {
  if (!Array.isArray(events)) return null;
  for (const event of events) {
    if (!SDK_ERROR_EVENT_TYPES.includes(event?.type)) continue;
    const message = messageOf(event);
    // A typed error with no text is not something worth showing anyone.
    if (!message) continue;
    return {
      type: event.type,
      message,
      code: event.code ?? null,
      recoverable: event.recoverable === true,
    };
  }
  return null;
}

/** The context-overflow event, which explains an empty turn that hit the ceiling. */
function contextOverflow(events) {
  if (!Array.isArray(events)) return null;
  return events.find((event) => event?.type === "hook_context_overflow") || null;
}

/**
 * Given a finished turn's events and the text extracted from it, the failure
 * to raise instead of falling back to "no chat text" — or null.
 *
 * Answer text wins, except for a recognized CLI-generated provider notice.
 * A member that answered has answered, and replacing
 * its words with an error because something recoverable happened on the way
 * would lose the only thing the user asked for.
 */
export function replyFailure(events, reply) {
  const text = String(reply || '').trim().replace(/\r\n/g, '\n');
  // CLI 0.9.11 emits this entire quota notice as message_end, with exit 0 and
  // no typed error. Match its complete wrapper, never arbitrary quota words
  // in an answer, a quoted log or a completed piece of work.
  if (/^(?:⚠\uFE0F?\s*)?Autohand AI monthly request quota reached\.\nYou've used all your requests for this month\.\nResets [^\n]+\nUpgrade your Autohand Code plan for more usage: https:\/\/console\.autohand\.ai\/upgrade\/\?from=cli&tier=[a-z0-9_-]+$/i.test(text)) {
    return { type: 'provider_quota_notice', message: text, code: 429, recoverable: true };
  }
  if (text) return null;

  const failure = firstSdkError(events);
  if (failure) return failure;

  const overflow = contextOverflow(events);
  if (overflow) {
    const percent = Number(overflow.usagePercent);
    const detail = Number.isFinite(percent) ? ` (${percent}% of the window)` : "";
    return {
      type: overflow.type,
      message: `The conversation outgrew this member's context${detail} and the turn ended with nothing to say. Start a new conversation, or narrow the workspace.`,
      code: null,
      recoverable: true,
    };
  }

  return null;
}
