// BroadcastChannel transports explicit mutations, never complete conversation
// snapshots. Replacing snapshots lets one window erase the other's reply.
// Symbol metadata survives object spreads but stays out of JSON/Object.entries.
// The persisted member.conversationStartedAt should also travel on events, so
// reopening a window retains the reset boundary without persisting this symbol.
export const SHARED_CONVERSATION_STATE = Symbol.for("autohandSquad.sharedConversationState");

const reserved = new Set(["__proto__", "constructor", "prototype"]);
const validId = value => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,256}$/.test(value) && !reserved.has(value);
const timestamp = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ? Date.parse(value) : NaN;
const isPlainObject = value => value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const terminalStatuses = new Set(['complete', 'error', 'stopped']);

function clonePayload(input) {
  if (!isPlainObject(input)) return null;
  try {
    const encoded = JSON.stringify(input);
    if (encoded.length > 512_000) return null;
    const result = JSON.parse(encoded);
    let nodes = 0;
    function valid(value, depth = 0) {
      if (++nodes > 20_000 || depth > 16) return false;
      if (Array.isArray(value)) return value.length <= 5000 && value.every(item => valid(item, depth + 1));
      if (value && typeof value === "object") {
        const entries = Object.entries(value);
        return entries.length <= 200 && entries.every(([key, item]) => !reserved.has(key) && valid(item, depth + 1));
      }
      return value === null || ["string", "number", "boolean"].includes(typeof value);
    }
    return valid(result) ? result : null;
  } catch { return null; }
}

function mutationTime(payload, at) {
  const stated = timestamp(payload?.updatedAt);
  return Number.isFinite(stated) ? stated : at;
}

function cloneMutationPayload(input, allowTerminalFallback) {
  const cloned = clonePayload(input);
  if (cloned || !allowTerminalFallback || !isPlainObject(input) || !terminalStatuses.has(input.status)) return cloned;
  // Final raw output can exceed the bounded cross-window message envelope.
  // Keep the answer and terminal controls; retain the existing streamed
  // diagnostics instead of dropping the entire final mutation.
  const { trace, streamEvents, computerUse, ...controls } = input;
  const terminal = clonePayload(controls);
  return terminal ? { ...terminal, workDetailsLimited: true } : null;
}

/** Bound a final broadcast before sending it to another Squad window. */
export function conversationEventForSharing(event) {
  if (!isPlainObject(event) || event.type !== 'message.patch') return event;
  const patch = cloneMutationPayload(event.patch, true);
  return patch ? { ...event, patch } : event;
}

/**
 * Events: { type, memberId, at, conversationStartedAt?, message? / messageId?
 * / patch? / messages? }. Reset may supply cutoff (defaults to at) and an
 * initial messages array. Call for local mutations as well as received events.
 * Invalid, duplicate and stale mutations return the original object.
 */
export function applySharedConversationEvent(currentMessages, event) {
  if (!isPlainObject(currentMessages) || !isPlainObject(event) || !validId(event.memberId)) return currentMessages;
  const at = timestamp(event.at);
  if (!Number.isFinite(at)) return currentMessages;
  const memberId = event.memberId;
  const state = currentMessages[SHARED_CONVERSATION_STATE] || { cutoffs: {}, clocks: {} };
  const persistedCutoff = timestamp(event.conversationStartedAt);
  const cutoff = Math.max(state.cutoffs[memberId] || 0, Number.isFinite(persistedCutoff) ? persistedCutoff : 0);
  const existing = Array.isArray(currentMessages[memberId]) ? currentMessages[memberId] : [];
  function changed(messages, nextState) {
    return { ...currentMessages, [memberId]: messages, [SHARED_CONVERSATION_STATE]: nextState };
  }

  if (event.type === "messages.reset") {
    const resetAt = event.cutoff === undefined ? at : timestamp(event.cutoff);
    if (!Number.isFinite(resetAt) || resetAt > at || resetAt <= (state.cutoffs[memberId] || 0) || resetAt < cutoff) return currentMessages;
    if (event.messages !== undefined && (!Array.isArray(event.messages) || event.messages.length > 100)) return currentMessages;
    const messages = [];
    const ids = new Set();
    for (const raw of event.messages || []) {
      const message = clonePayload(raw);
      if (!message || !validId(message.id) || ids.has(message.id)) return currentMessages;
      ids.add(message.id);
      messages.push({ ...message, updatedAt: event.at, startedAt: event.at });
    }
    // A reset can arrive after another window already appended a genuinely
    // newer request. Clear the old thread, retaining work beyond the cutoff.
    const retained = existing.filter(message => Number.isFinite(timestamp(message?.startedAt)) && timestamp(message.startedAt) > resetAt);
    const retainedIds = new Set(retained.map(message => message.id));
    const nextMessages = [...messages.filter(message => !retainedIds.has(message.id)), ...retained];
    const clocks = { ...state.clocks, [memberId]: Object.fromEntries(Object.entries(state.clocks[memberId] || {}).filter(([id]) => retainedIds.has(id))) };
    return changed(nextMessages, { cutoffs: { ...state.cutoffs, [memberId]: resetAt }, clocks });
  }

  if (!["message.append", "message.patch"].includes(event.type) || at <= cutoff) return currentMessages;
  const append = event.type === "message.append";
  const payload = cloneMutationPayload(append ? event.message : event.patch, !append);
  const messageId = append ? payload?.id : event.messageId;
  if (!payload || !validId(messageId)) return currentMessages;
  const startedAt = timestamp(payload.startedAt);
  if (Number.isFinite(startedAt) && startedAt <= cutoff) return currentMessages;
  const index = existing.findIndex(message => message?.id === messageId);
  if (!append && index < 0) return currentMessages; // A patch never resurrects a removed message.
  const previous = index >= 0 ? existing[index] : null;
  const previousStartedAt = timestamp(previous?.startedAt);
  if (Number.isFinite(previousStartedAt) && previousStartedAt <= cutoff) return currentMessages;
  const clock = mutationTime(payload, at);
  const previousClock = Math.max(state.clocks[memberId]?.[messageId] || 0, Number.isFinite(timestamp(previous?.updatedAt)) ? timestamp(previous.updatedAt) : 0);
  if (clock < previousClock || clock <= cutoff) return currentMessages;
  // Redelivery of an append is idempotent; updates belong to message.patch.
  if (append && previous) return currentMessages;
  if (!append && previous && terminalStatuses.has(previous.status) && payload.status === "loading") return currentMessages;
  const { id: _ignoredId, ...patch } = payload;
  const message = append
    ? { ...payload, startedAt: Number.isFinite(startedAt) ? payload.startedAt : event.at, updatedAt: new Date(clock).toISOString() }
    : { ...previous, ...patch, id: messageId, updatedAt: new Date(clock).toISOString() };
  if (previous && JSON.stringify(previous) === JSON.stringify(message)) return currentMessages;
  const messages = append ? [...existing, message].sort((a, b) => {
    const aTime = timestamp(a?.startedAt);
    const bTime = timestamp(b?.startedAt);
    if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) return 0;
    const roleOrder = role => role === "user" ? 0 : role === "agent" ? 1 : 2;
    return aTime - bTime || roleOrder(a.role) - roleOrder(b.role) || String(a.id).localeCompare(String(b.id));
  }) : existing.map((item, itemIndex) => itemIndex === index ? message : item);
  return changed(messages, {
    cutoffs: cutoff > 0 ? { ...state.cutoffs, [memberId]: cutoff } : state.cutoffs,
    clocks: { ...state.clocks, [memberId]: { ...state.clocks[memberId], [messageId]: clock } },
  });
}
