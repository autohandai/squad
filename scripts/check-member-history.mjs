// Member History row text (bug hunt, desktop pass 55-60).
import assert from "node:assert/strict";
import { groupRecordsByDay, plainPreview, recordSummary, withoutEchoedMentions } from "../src/lib/member-history.js";

const at = "2026-09-28T09:00:00.000Z";
assert.equal(
  // The real stored row (~/.autohand/squad/audit, 140-character preview).
  recordSummary({ id: "a", kind: "message", at, summary: "Replied in channel: Based on my squad member configuration, here's what I have access to: **Selected repository for this run:** - `/Users/igorcosta/Documents/a" }),
  "Replied in channel: Based on my squad member configuration, here's what I have access to: Selected repository for this run…",
  "markdown is read as text and a cut preview ends on a word with an ellipsis",
);
assert.equal(recordSummary({ id: "b", kind: "message", at, summary: "Replied in channel: Autohand returned no chat text." }), "Replied in channel, with no text");
assert.equal(recordSummary({ id: "c", kind: "run", at, summary: "Stopped" }), "Stopped by you");
assert.equal(recordSummary({ id: "d", kind: "message", at, summary: "Replied: Hey! What are we working on today?" }), "Replied: Hey! What are we working on today?");
assert.equal(plainPreview("short"), "short");

const reply = { id: "r", kind: "message", eventName: "chat.finished", at, summary: "Replied in channel: @Iris — from my side: I didn't touch install.sh today." };
const mention = { id: "m", kind: "message", eventName: "mention.received", at: "2026-09-28T09:00:05.000Z", summary: "Mentioned: @Iris — from my side: I didn't touch install.sh today." };
const other = { id: "o", kind: "message", eventName: "mention.received", at, summary: "Mentioned: can you look at the build?" };
assert.deepEqual(withoutEchoedMentions([mention, reply, other]).map((item) => item.id), ["r", "o"], "a mention echoed by the reply is one row");
assert.equal(groupRecordsByDay([mention, reply, other], { now: Date.parse("2026-10-14T00:00:00Z") })[0].records.length, 2);
import { recordFailed } from "../src/lib/member-history.js";
const refused = { id: "x", kind: "message", at, summary: "Replied: ⚠️ The request was malformed and could not be processed. This message was blocked by Autohand's safety check." };
assert.ok(recordFailed(refused), "a refusal stored as a reply is a failure");
assert.match(recordSummary(refused), /^Could not reply: The request was malformed/);
console.log("member history rows checked");
