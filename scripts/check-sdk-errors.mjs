#!/usr/bin/env node
// A turn that fails must say why (ADR-0061).
//
// The SDK reports provider and session failures as stream EVENTS, not as
// thrown errors: `error`, `hook_session_error`, `automode_error`. The bridge's
// stream loop only ever looked at message and tool events, so an errored turn
// ended cleanly with no assistant text, and the empty reply was rendered as
// "Autohand returned no chat text." — the same sentence whatever went wrong.
// Safety block, payload too large, context overflow and provider timeout all
// looked identical, and none of them reached the user.

import assert from "node:assert/strict";

import { firstSdkError, replyFailure, SDK_ERROR_EVENT_TYPES } from "../server/sdk-events.mjs";

// The three shapes the SDK actually declares, from its own type definitions.
const providerError = { type: "error", code: 400, message: "This message was blocked by Autohand's safety check. Rephrase it and try again.", recoverable: false, timestamp: "t" };
const sessionError = { type: "hook_session_error", error: "Request payload too large (16.44MB).", code: "PAYLOAD", timestamp: "t" };
const automodeError = { type: "automode_error", sessionId: "s1", error: "Inference stream stalled before completion.", timestamp: "t" };

assert.deepEqual([...SDK_ERROR_EVENT_TYPES].sort(), ["automode_error", "error", "hook_session_error"].sort());

// Each shape yields its own message, from the field that shape uses.
assert.equal(firstSdkError([providerError])?.message, "This message was blocked by Autohand's safety check. Rephrase it and try again.");
assert.equal(firstSdkError([sessionError])?.message, "Request payload too large (16.44MB).");
assert.equal(firstSdkError([automodeError])?.message, "Inference stream stalled before completion.");
assert.equal(firstSdkError([providerError])?.code, 400);
assert.equal(firstSdkError([sessionError])?.code, "PAYLOAD");

// The first error wins: later ones are usually knock-on.
assert.equal(firstSdkError([providerError, automodeError])?.message, providerError.message);

// A healthy turn has nothing to report.
assert.equal(firstSdkError([{ type: "agent_start" }, { type: "message_end", content: "ok" }, { type: "agent_end" }]), null);
assert.equal(firstSdkError([]), null);
assert.equal(firstSdkError(null), null);

// An event of the right type but with no text is not a usable reason.
assert.equal(firstSdkError([{ type: "error", code: 500 }]), null, "an error with no message is not a reason to show");

// --- what the caller actually asks -----------------------------------------
// replyFailure answers one question: this turn produced `reply`; is there a
// real failure to raise instead of falling back to "no chat text"?

// The case the owner hit: an errored turn with no assistant text.
const failed = replyFailure([{ type: "agent_start" }, providerError, { type: "hook_post_response" }, { type: "agent_end" }], "");
assert.ok(failed, "an errored turn with no text must produce a failure");
assert.match(failed.message, /safety check/);

// Text arrived despite a recoverable error: keep the text, say nothing.
assert.equal(
  replyFailure([{ type: "error", code: 1, message: "transient", recoverable: true }, { type: "message_end", content: "hello" }], "hello"),
  null,
  "a reply that arrived is worth more than a recoverable error"
);

// An unrecoverable error alongside text is still worth surfacing as a warning,
// but must never replace the text the member actually produced.
const partial = replyFailure([providerError], "half an answer");
assert.equal(partial, null, "text present means no failure is raised");

// Empty turn with no error at all: nothing to say beyond the existing fallback.
assert.equal(replyFailure([{ type: "agent_start" }, { type: "agent_end" }], ""), null);

// Context overflow is informational on its own, but it is the reason an empty
// turn was empty, so it counts when there is nothing to show.
const overflow = { type: "hook_context_overflow", tokensBefore: 210000, tokensAfter: 180000, croppedCount: 12, usagePercent: 104, timestamp: "t" };
const overflowed = replyFailure([overflow, { type: "agent_end" }], "");
assert.ok(overflowed, "an empty turn that overflowed its context must say so");
assert.match(overflowed.message, /context/i);
assert.match(overflowed.message, /104/, "the usage figure is the actionable part");
assert.equal(replyFailure([overflow, { type: "message_end", content: "fine" }], "fine"), null, "overflow that still answered is not a failure");

console.log("check-sdk-errors: ok");
