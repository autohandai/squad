#!/usr/bin/env node
// A member on a break stops what it is doing and declines new work until the
// break ends. These are the rules the chat and channel dispatch paths share,
// so they live in one pure module and are checked here rather than in a
// browser. See docs/adrs/ADR-0027-member-breaks.md.

import assert from "node:assert/strict";

import {
  BREAK_STATUS,
  beginBreak,
  declineNotice,
  endBreak,
  isOnBreak,
  memberAvailability,
} from "../src/lib/member-availability.js";

const copy = {
  memberOnBreak: "{name} is on a break",
  memberOnBreakReply: "I'm on a break, so I'm not picking up new work. End my break and I'll get straight to it.",
  memberBreakEnded: "Back from a break.",
};

// --- isOnBreak -------------------------------------------------------------

assert.equal(isOnBreak({ status: BREAK_STATUS }), true, "the break status counts as a break");
assert.equal(isOnBreak({ status: "active" }), false, "an active member is not on a break");
assert.equal(isOnBreak({ status: "offline" }), false, "offline is not a break: it is not deliberate");
assert.equal(isOnBreak(null), false, "no member is not on a break");
assert.equal(isOnBreak({}), false, "a member with no status is available");

// --- memberAvailability ----------------------------------------------------

{
  const available = memberAvailability({ id: "m1", name: "Noah", status: "active" }, copy);
  assert.equal(available.canWork, true);
  assert.equal(available.reason, "");
  assert.equal(available.notice, "");
}

{
  const resting = memberAvailability({ id: "m1", name: "Noah", status: BREAK_STATUS }, copy);
  assert.equal(resting.canWork, false, "a member on a break declines work");
  assert.equal(resting.reason, "break");
  assert.equal(resting.notice, "Noah is on a break", "the notice names the member");
  assert.equal(resting.reply, copy.memberOnBreakReply, "the decline is written in the member's voice");
}

{
  // Falling back to English keeps the guard working before copy is translated.
  const resting = memberAvailability({ id: "m1", name: "Iris", status: BREAK_STATUS }, {});
  assert.match(resting.notice, /Iris/, "the fallback still names the member");
  assert.ok(resting.reply.length > 0, "the fallback still explains itself");
}

// --- begin and end ---------------------------------------------------------

{
  const patch = beginBreak({ id: "m1", status: "active" });
  assert.equal(patch.status, BREAK_STATUS);
  assert.ok(patch.breakStartedAt, "a break records when it started");
  assert.equal(Number.isNaN(Date.parse(patch.breakStartedAt)), false, "the start time is an ISO date");
}

{
  const patch = endBreak({ id: "m1", status: BREAK_STATUS, breakStartedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(patch.status, "active");
  assert.equal(patch.breakStartedAt, "", "ending a break clears the start time");
}

{
  // Ending a break on a member that was never on one must not invent state.
  const patch = endBreak({ id: "m1", status: "active" });
  assert.equal(patch.status, "active");
}

// --- declineNotice ---------------------------------------------------------

assert.equal(
  declineNotice({ name: "Kai", status: BREAK_STATUS }, copy),
  "Kai is on a break",
  "the notice is one short sentence"
);
assert.equal(declineNotice({ name: "Kai", status: "active" }, copy), "", "an available member has nothing to say");

// --- the guard is total ----------------------------------------------------

for (const status of ["active", "away", "offline", BREAK_STATUS, "", undefined, null]) {
  const result = memberAvailability({ id: "m", name: "M", status }, copy);
  assert.equal(typeof result.canWork, "boolean", `canWork is always a boolean for status ${String(status)}`);
  assert.equal(typeof result.reply, "string", `reply is always a string for status ${String(status)}`);
  // Only a break declines. Everything else is allowed to work, including
  // offline, because the bridge decides whether it can actually reach it.
  assert.equal(result.canWork, status !== BREAK_STATUS, `only a break declines (status ${String(status)})`);
}

console.log("check-member-availability: ok");
