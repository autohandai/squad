// Merging the bridge's transcript into a window's conversation (ADR-0163).
//
// `GET /api/members/:id/transcript` returns the member's direct turns as
// messages with the ids the sending window used (`<requestId>-u/-a`). This
// adds the ones this window has never seen, in time order, and leaves what
// it already holds alone, so the window that sent a turn sees no change and
// every other window sees the conversation.

function at(message) {
  const value = Date.parse(message?.startedAt || message?.createdAt || message?.completedAt || "");
  return Number.isFinite(value) ? value : NaN;
}

const collapse = (body) => String(body || "").replace(/\s+/g, " ").trim();
// A turn this window sent before the bridge kept request ids (runs written
// by an earlier Squad) has no id in common with the bridge's copy. The
// person's question at the same minute, with one body containing the other
// (the bridge's copy may carry the briefing), is the same turn.
const SAME_TURN_MS = 2 * 60 * 1000;
function sameQuestion(local, incoming) {
  if (local?.role !== "user" || incoming?.role !== "user") return false;
  const a = at(local);
  const b = at(incoming);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > SAME_TURN_MS) return false;
  const mine = collapse(local.body);
  const theirs = collapse(incoming.body);
  return Boolean(mine) && Boolean(theirs) && (mine === theirs || theirs.endsWith(mine) || mine.endsWith(theirs));
}

/**
 * mergeTranscript(current, incoming, { since, formatTime })
 *   current     the window's messages for the member (any order it renders)
 *   incoming    transcript messages from the bridge, oldest first
 *   since       ISO time; anything that started before it is skipped
 *   formatTime  (iso) => "09:41", for the message's time label
 * → { messages, added, updated }; `messages` is `current` itself when nothing changed
 */
export function mergeTranscript(current, incoming, { since = "", formatTime = () => "" } = {}) {
  const list = Array.isArray(current) ? current : [];
  const cutoff = since ? Date.parse(since) : NaN;
  const ids = new Set(list.map((message) => message?.id));
  const byRequest = new Set(list.filter((message) => message?.requestId).map((message) => `${message.requestId}:${message.role}`));
  let messages = list;
  let added = 0;
  let updated = 0;
  // Turns whose question this window already had: their answer is here too.
  const heldTurns = new Set();
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    if (!raw || typeof raw.id !== "string" || !raw.id) continue;
    const started = at(raw);
    if (Number.isFinite(cutoff) && Number.isFinite(started) && started < cutoff) continue;
    const message = { ...raw, time: raw.time || (raw.startedAt ? formatTime(raw.startedAt) : ""), fromBridge: true };
    if (raw.requestId && raw.role === "agent" && heldTurns.has(raw.requestId)) continue;
    if (raw.requestId && raw.role === "user" && !ids.has(raw.id) && list.some((item) => sameQuestion(item, raw))) {
      heldTurns.add(raw.requestId);
      continue;
    }
    if (ids.has(raw.id)) {
      // A turn this window learnt of from the bridge while it was running:
      // the bridge now has its answer.
      const index = messages.findIndex((item) => item?.id === raw.id);
      const existing = messages[index];
      if (existing?.fromBridge && existing.status === "loading" && raw.status !== "loading") {
        messages = messages === list ? [...list] : messages;
        messages[index] = { ...existing, ...message };
        updated += 1;
      }
      continue;
    }
    if (raw.requestId && byRequest.has(`${raw.requestId}:${raw.role}`)) continue;
    messages = messages === list ? [...list] : messages;
    // After the last message that started no later than this one; a message
    // without a time (a Squad note) never moves.
    let index = messages.length;
    if (Number.isFinite(started)) {
      let last = -1;
      messages.forEach((item, position) => {
        const when = at(item);
        if (Number.isFinite(when) && when <= started) last = position;
      });
      if (last >= 0) index = last + 1;
      else if (messages.some((item) => Number.isFinite(at(item)))) index = messages.findIndex((item) => Number.isFinite(at(item)));
    }
    messages.splice(index, 0, message);
    ids.add(raw.id);
    if (raw.requestId) byRequest.add(`${raw.requestId}:${raw.role}`);
    added += 1;
  }
  return { messages, added, updated };
}

/** One string per member that changes when a chat turn starts or finishes. */
export function transcriptKey(runs, memberId) {
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => run && run.agentId === memberId && (run.kind === "chat" || run.mode === "chat") && !run.channel)
    .map((run) => `${run.id}:${run.status}`)
    .join("|");
}
