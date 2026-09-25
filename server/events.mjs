// Bridge-wide event bus. server.mjs emits domain events at the points where
// something happened (a run finished, a chat reply landed, a handoff waits,
// an approval is pending, a mention arrived) and feature modules under
// server/routes subscribe: the audit trail appends a record, notifications
// post a toast, the search index picks up new text.
//
// Event names are dotted, lower-case: "run.finished", "chat.finished",
// "handoff.pending", "approval.pending", "mention.received", "member.stopped".
// Payloads are plain JSON objects and always carry `at` (ISO time) and, when a
// member is involved, `memberId`.

import { EventEmitter } from "node:events";

export const bridgeEvents = new EventEmitter();
bridgeEvents.setMaxListeners(64);

export function emitBridgeEvent(name, payload = {}) {
  const event = { name, at: new Date().toISOString(), ...payload };
  try {
    bridgeEvents.emit(name, event);
    bridgeEvents.emit("*", event);
  } catch (error) {
    console.error(`bridge event listener failed for ${name}: ${error?.message || error}`);
  }
  return event;
}
