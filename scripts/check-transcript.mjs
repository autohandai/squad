#!/usr/bin/env node
// The transcript a window reads from the bridge's runs (ADR-0163): which
// runs count as the person's conversation, the message shape, the cut-off
// for a chat that was put away, and how a window merges it into what it
// already holds without duplicating the turns it sent itself.
import assert from "node:assert/strict";

import { isPersonRun, transcriptFromRuns } from "../server/chats/transcript.mjs";
import { RUN_HISTORY_TRACE_BYTES, boundedTrace, historyRecord, runFromRecord } from "../server/runs/history.mjs";
import { mergeTranscript, transcriptKey } from "../src/lib/transcript.js";

const t = (minute) => new Date(Date.UTC(2026, 10, 2, 9, minute)).toISOString();
function run(overrides) {
  return { id: `run-${overrides.requestId || Math.random()}`, agentId: "alex", kind: "chat", mode: "chat", channel: null, status: "completed", startedAt: t(0), finishedAt: t(1), durationMs: 60000, prompt: "p", personPrompt: "", reply: "r", logs: [], ...overrides };
}

// --- which runs are the person's conversation ------------------------------
assert.equal(isPersonRun(run({ person: true })), true);
assert.equal(isPersonRun(run({ person: false })), false, "the bridge's flag wins");
assert.equal(isPersonRun(run({ requestId: "goal-1" })), false, "old records: goal turns by prefix");
assert.equal(isPersonRun(run({ requestId: "chat-1" })), true, "old records: a chat id is a person turn");
assert.equal(isPersonRun(run({ requestId: "queue-1" })), true, "a queued follow-up was typed by the person");
assert.equal(isPersonRun(run({ channel: { id: "general" } })), false, "channel turns are not the direct conversation");
assert.equal(isPersonRun(run({ kind: "launch", mode: "prompt" })), false, "launched runs are not turns");

// --- the transcript ---------------------------------------------------------
const runs = new Map([
  ["a", run({ id: "a", requestId: "chat-1", person: true, startedAt: t(0), finishedAt: t(1), personPrompt: "Hello there\nsecond line", prompt: "Briefing… Hello there second line", reply: "Hi.", trace: { events: [{ type: "tool_start", name: "read_file" }] }, effectiveModel: { provider: "anthropic", model: "sonnet" } })],
  ["b", run({ id: "b", requestId: "chat-2", person: true, startedAt: t(5), finishedAt: t(6), prompt: "Old record without personPrompt", reply: "", status: "failed", logs: [{ source: "stderr", line: "engine exited 1", at: t(6) }] })],
  ["c", run({ id: "c", requestId: "goal-1", person: false, startedAt: t(7), prompt: "goal turn", reply: "goal reply" })],
  ["d", run({ id: "d", requestId: "chat-3", person: true, agentId: "noah", startedAt: t(8), prompt: "someone else's", reply: "x" })],
  ["e", run({ id: "e", requestId: "chat-4", person: true, startedAt: t(9), finishedAt: null, durationMs: null, status: "running", prompt: "Still going", reply: "" })],
  ["f", run({ id: "f", requestId: "chat-5", person: true, channel: { id: "general" }, startedAt: t(10), prompt: "channel", reply: "y" })],
]);
const transcript = transcriptFromRuns(runs, { memberId: "alex", memberName: "Alex" });
assert.equal(transcript.turns, 3, "three direct turns for alex: two finished, one live");
assert.equal(transcript.live, true);
assert.deepEqual(transcript.messages.map((m) => m.id), ["chat-1-u", "chat-1-a", "chat-2-u", "chat-2-a", "chat-4-u", "chat-4-a"], "ids are the sending window's, oldest first");
const [u1, a1, , a2, , a4] = transcript.messages;
assert.equal(u1.body, "Hello there\nsecond line", "the typed prompt, not the briefed one");
assert.equal(u1.role, "user");
assert.equal(u1.fromBridge, true);
assert.equal(a1.status, "complete");
assert.equal(a1.body, "Hi.");
assert.equal(a1.completedAt, t(1));
assert.equal(a1.durationMs, 60000);
assert.equal(a1.runId, "a");
assert.deepEqual(a1.trace, { events: [{ type: "tool_start", name: "read_file" }] }, "the newest answers carry their trace for Work details");
assert.deepEqual(a1.effectiveModel, { provider: "anthropic", model: "sonnet" });
assert.equal(transcript.messages[2].body, "Old record without personPrompt", "falls back to the briefed prompt");
assert.equal(a2.status, "error");
assert.equal(a2.body, "Alex could not answer: engine exited 1", "a failed turn says why from the log");
assert.equal(a4.status, "loading");
assert.equal(a4.body, "Alex is thinking...");
assert.equal("completedAt" in a4, false);

const sinced = transcriptFromRuns(runs, { memberId: "alex", since: t(5) });
assert.deepEqual(sinced.messages.map((m) => m.id), ["chat-2-u", "chat-2-a", "chat-4-u", "chat-4-a"], "since leaves out the chat that was put away");
assert.equal(transcriptFromRuns(runs, { memberId: "alex", limit: 1 }).messages.length, 2, "limit keeps the newest turns");
assert.equal("trace" in transcriptFromRuns(runs, { memberId: "alex", traces: 0 }).messages[1], false, "traces=0 sends no trace");
assert.equal(transcriptFromRuns([...runs.values()], { memberId: "alex" }).turns, 3, "a list works as well as the Map");
assert.deepEqual(transcriptFromRuns(runs, { memberId: "nobody" }), { messages: [], turns: 0, live: false });

// --- history keeps what the transcript needs -------------------------------
const record = historyRecord(run({ id: "h", requestId: "chat-9", person: true, personPrompt: "typed", trace: { events: [{ type: "x" }] }, status: "completed" }));
assert.equal(record.requestId, "chat-9");
assert.equal(record.person, true);
assert.equal(record.personPrompt, "typed");
assert.deepEqual(record.trace, { events: [{ type: "x" }] });
assert.equal(historyRecord(run({ status: "completed", trace: { events: [{ pad: "x".repeat(RUN_HISTORY_TRACE_BYTES) }] } })).trace, null, "a trace over the cap is dropped, not truncated");
assert.equal(boundedTrace("no"), null);
const restored = runFromRecord(record);
assert.equal(isPersonRun(restored), true);
assert.equal(transcriptFromRuns([restored], { memberId: "alex" }).messages[1].trace.events[0].type, "x", "a restored run still yields its trace");

// --- merging into a window --------------------------------------------------
const fmt = (iso) => new Date(iso).toISOString().slice(11, 16);
const local = [
  { id: "welcome", role: "agent", body: "Hi, I am Alex.", status: "complete" },
  { id: "chat-1-u", role: "user", body: "Hello there\nsecond line", status: "complete", startedAt: t(0), requestId: "chat-1" },
  { id: "chat-1-a", role: "agent", body: "Hi.", status: "complete", startedAt: t(0), completedAt: t(1), requestId: "chat-1" },
];
const same = mergeTranscript(local, transcript.messages.slice(0, 2), { formatTime: fmt });
assert.equal(same.messages, local, "the sending window sees no change for turns it has");
assert.equal(same.added, 0);

const merged = mergeTranscript(local, transcript.messages, { formatTime: fmt });
assert.equal(merged.added, 4);
assert.deepEqual(merged.messages.map((m) => m.id), ["welcome", "chat-1-u", "chat-1-a", "chat-2-u", "chat-2-a", "chat-4-u", "chat-4-a"], "new turns land after the ones already held; the note without a time stays first");
assert.equal(merged.messages[3].time, "09:05", "the time label is formatted for the window");
assert.equal(merged.messages[3].fromBridge, true);
assert.equal(local.length, 3, "the window's list is not mutated");

// A turn sent from this window under a different message id but the same request id (a retry) is not duplicated.
const retried = [{ id: "chat-local-u", role: "user", body: "Hello there", status: "complete", startedAt: t(0), requestId: "chat-1" }, { id: "chat-local-a", role: "agent", body: "Hi.", status: "complete", startedAt: t(0), requestId: "chat-1" }];
assert.equal(mergeTranscript(retried, transcript.messages.slice(0, 2), { formatTime: fmt }).added, 0, "same request id, same role: already here");

// Older turns arrive in time order among what is held.
const later = [{ id: "chat-4-u", role: "user", body: "Still going", status: "complete", startedAt: t(9), requestId: "chat-4" }];
const back = mergeTranscript(later, transcript.messages.slice(0, 4), { formatTime: fmt });
assert.deepEqual(back.messages.map((m) => m.id), ["chat-1-u", "chat-1-a", "chat-2-u", "chat-2-a", "chat-4-u"], "earlier turns go before the one held");

// The cut-off: a turn from a chat that was put away is left out even when the bridge sends it.
assert.equal(mergeTranscript([], transcript.messages, { since: t(9), formatTime: fmt }).messages.length, 2);

// A live turn learnt from the bridge resolves on the next merge; one the window itself is streaming is left alone.
const live = mergeTranscript([], transcript.messages.slice(4), { formatTime: fmt }).messages;
assert.equal(live[1].status, "loading");
const finished = mergeTranscript(live, [{ ...transcript.messages[5], status: "complete", body: "Done now.", completedAt: t(10) }], { formatTime: fmt });
assert.equal(finished.updated, 1);
assert.equal(finished.messages[1].body, "Done now.");
assert.equal(finished.messages[1].status, "complete");
const own = [{ id: "chat-4-a", role: "agent", body: "streaming…", status: "loading", startedAt: t(9), requestId: "chat-4" }];
assert.equal(mergeTranscript(own, [{ ...transcript.messages[5], status: "complete", body: "Done now." }], { formatTime: fmt }).messages, own, "a turn this window is streaming is never overwritten by the bridge's copy");

// A turn sent by this window before the bridge kept request ids: the bridge's copy has other ids and
// the briefed prompt, but the same question at the same minute, so neither bubble is added again.
const legacyLocal = [
  { id: "chat-old-u", role: "user", body: "Hello there\nsecond line", status: "complete", startedAt: t(0) },
  { id: "chat-old-a", role: "agent", body: "Hi.", status: "complete", startedAt: t(0), completedAt: t(1) },
];
const legacyIncoming = transcriptFromRuns([{ ...runs.get("a"), requestId: "", personPrompt: "", startedAt: new Date(Date.parse(t(0)) + 4000).toISOString() }], { memberId: "alex" }).messages;
assert.deepEqual(legacyIncoming.map((m) => m.id), ["a-u", "a-a"], "no request id: the run id names the bubbles");
assert.equal(mergeTranscript(legacyLocal, legacyIncoming, { formatTime: fmt }).messages, legacyLocal, "same question at the same minute: the turn and its answer are already here");
assert.equal(mergeTranscript(legacyLocal, legacyIncoming.map((m) => ({ ...m, startedAt: t(30) })), { formatTime: fmt }).added, 2, "the same words half an hour later are another turn");

// The key that triggers a refresh changes when a turn starts or ends.
const list = [{ id: "a", agentId: "alex", kind: "chat", status: "running" }, { id: "b", agentId: "alex", kind: "chat", status: "completed", channel: { id: "g" } }, { id: "c", agentId: "noah", kind: "chat", status: "completed" }];
assert.equal(transcriptKey(list, "alex"), "a:running");
assert.equal(transcriptKey(list.map((r) => (r.id === "a" ? { ...r, status: "completed" } : r)), "alex"), "a:completed");

console.log("check-transcript: ok");
