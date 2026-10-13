import assert from "node:assert/strict";
import { applySharedConversationEvent as apply, conversationEventForSharing, SHARED_CONVERSATION_STATE } from "../src/lib/shared-conversations.js";

const time = ms => new Date(Date.UTC(2026, 9, 1, 16, 0, 0, ms)).toISOString();
const append = (id, at, extra = {}) => ({ type: "message.append", memberId: "noah", at: time(at), message: { id, role: "agent", body: "Answer", status: "loading", ...extra } });
const patch = (id, at, fields) => ({ type: "message.patch", memberId: "noah", messageId: id, at: time(at), patch: fields });
const otherMessages = [{ id: "eva-existing", body: "Independent conversation" }];
const original = { eva: otherMessages };
let main = apply(original, append("main-answer", 1));
let quick = apply(original, append("quick-answer", 2));
main = apply(main, append("quick-answer", 2));
quick = apply(quick, append("main-answer", 1));
for (const event of [patch("main-answer", 3, { body: "Main completed", status: "complete" }), patch("quick-answer", 4, { body: "Quick completed", status: "complete" })]) {
  main = apply(main, event); quick = apply(quick, event);
}
assert.deepEqual(main.noah, quick.noah);
assert.equal(main.eva, otherMessages);
assert.equal(quick.eva, otherMessages);
assert.equal(apply(main, append("main-answer", 5, { body: "Duplicate append" })), main);
assert.equal(apply(main, patch("main-answer", 2, { body: "Stale stream" })), main);
assert.equal(apply(main, patch("main-answer", 20, { body: "Old marker", updatedAt: time(1) })), main);
assert.equal(apply(main, patch("main-answer", 3, { body: "Terminal regressed", status: "loading" })), main);
assert.equal(apply(main, patch("unknown-answer", 7, { body: "Must not create a row" })), main);
assert.equal(main.noah.find(message => message.id === "main-answer").status, "complete");

const reset = { type: "messages.reset", memberId: "noah", at: time(10), cutoff: time(10), messages: [] };
const resetMain = apply(main, reset);
assert.deepEqual(resetMain.noah, []);
assert.equal(resetMain.eva, otherMessages);
assert.equal(apply(resetMain, reset), resetMain);
assert.equal(apply(resetMain, { ...reset, at: time(9), cutoff: time(9) }), resetMain);
assert.equal(apply(resetMain, append("late-old-append", 8)), resetMain);
assert.equal(apply(resetMain, append("old-thread-late-work", 12, { startedAt: time(1) })), resetMain);
assert.equal(apply(resetMain, patch("main-answer", 12, { body: "Post-reset old reply" })), resetMain);
const newConversation = apply(resetMain, append("new-question", 11, { role: "user", body: "New request" }));
assert.equal(newConversation.noah.length, 1);
assert.equal(newConversation.noah[0].id, "new-question");
const newReply = apply(newConversation, append("new-answer", 12));
const finished = apply(newReply, patch("new-answer", 13, { body: "New answer", status: "complete" }));
assert.equal(finished.noah.length, 2);
assert.equal(finished.noah[1].body, "New answer");
const delayedReset = apply(apply(main, append("new-while-reset-in-transit", 12)), reset);
assert.deepEqual(delayedReset.noah.map(message => message.id), ["new-while-reset-in-transit"]);
const spread = { ...finished };
assert.equal(spread[SHARED_CONVERSATION_STATE], finished[SHARED_CONVERSATION_STATE]);
assert.ok(!JSON.stringify(spread).includes("cutoffs"));
assert.deepEqual(Object.keys(spread).sort(), ["eva", "noah"]);

// Persisted member cutoff maintains the boundary after JSON hydration.
const hydrated = JSON.parse(JSON.stringify(resetMain));
assert.equal(apply(hydrated, { ...append("old-after-reopen", 8), conversationStartedAt: time(10) }), hydrated);
assert.equal(apply(hydrated, { ...append("old-thread-after-reopen", 12, { startedAt: time(1) }), conversationStartedAt: time(10) }), hydrated);
assert.equal(apply(hydrated, { ...append("new-after-reopen", 12), conversationStartedAt: time(10) }).noah.length, 1);

for (const event of [null, {}, { ...append("valid", 12), memberId: "__proto__" }, { ...append("valid", 12), at: "invalid" },
  append("constructor", 12), { ...patch("new-answer", 13, {}), patch: "not an object" },
  append("oversize", 12, { body: "x".repeat(513_000) }),
  { ...reset, messages: [{ id: "same" }, { id: "same" }] },
  { ...reset, messages: [JSON.parse('{"id":"safe","__proto__":{"polluted":true}}')] },
  { ...reset, cutoff: time(15) },
]) assert.equal(apply(resetMain, event), resetMain);
const cyclic = {}; cyclic.self = cyclic;
assert.equal(apply(resetMain, append("cyclic", 12, { trace: cyclic })), resetMain);
assert.equal(Object.prototype.polluted, undefined);
const tied = apply(apply({}, append("chat-a", 20)), append("chat-u", 20, { role: "user" }));
assert.deepEqual(tied.noah.map(message => message.id), ["chat-u", "chat-a"]);
assert.deepEqual(original, { eva: otherMessages });
console.log("Shared conversations: concurrent answers, patch isolation, duplicate/stale mutations, reset boundaries, hydration and invalid payload checks passed.");

// Final diagnostics can be larger than a live, truncated work-details patch.
// An oversized trace must never discard the timeout/completion itself.
const working = apply({}, append('long-reply', 1, { trace: { events: [{ type: 'tool_start', toolName: 'Read' }] } }));
for (const status of ['error', 'complete', 'stopped']) {
  const fields = { status, body: status === 'error' ? 'Claude Code timed out after 300 s' : 'Final answer retained', completedAt: time(300_001), durationMs: 300_000, activityLabel: '', trace: { raw: { stdout: 'diagnostic '.repeat(60_000) } }, streamEvents: [] };
  const ended = apply(working, patch('long-reply', 300_001, fields));
  const shared = conversationEventForSharing(patch('long-reply', 300_001, fields));
  assert.ok(JSON.stringify(shared).length < 512_000, 'The sender broadcasts a bounded terminal mutation');
  assert.deepEqual(apply(working, shared).noah, ended.noah, 'Other windows receive the same terminal controls');
  assert.equal(ended.noah[0].status, status, 'Large work details cannot leave a terminal reply loading');
  assert.equal(ended.noah[0].durationMs, 300_000);
  assert.equal(ended.noah[0].body, fields.body);
  assert.deepEqual(ended.noah[0].trace.events, working.noah[0].trace.events, 'Keep the already received work details');
  assert.equal(apply(ended, patch('long-reply', 300_010, { status: 'loading', body: 'late delta' })), ended, 'Late progress cannot restart a terminal timer');
  assert.equal(apply({noah:[]}, patch('long-reply', 300_001, fields)).noah.length, 0, 'A terminal patch cannot resurrect a removed reply');
}
console.log('Terminal updates: large diagnostics preserve final status, duration, answer and existing details; late progress cannot reopen the timer.');
