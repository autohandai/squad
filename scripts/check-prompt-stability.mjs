#!/usr/bin/env node
// The SDK system prompt must not change between two messages to the same
// member in the same workspace. The warm session pool keys on it, so any
// churn here costs a full CLI cold start (~42 s measured) on every message.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/App.jsx", "utf8");

// buildTeammateContext is the part that used to carry volatile presence.
const start = source.indexOf("function buildTeammateContext(");
assert.ok(start > 0, "buildTeammateContext exists");
const body = source.slice(start, source.indexOf("\n}", start));

for (const volatile of ["memberPresenceForAgent", "presence?.label", "Date.now(", "new Date("]) {
  assert.ok(!body.includes(volatile), `the system prompt must not embed ${volatile}`);
}

// The profile handed to the SDK is built from these three, and none of them
// may read live run or task state.
const profileLine = source.split("\n").find((line) => line.includes("const profile = [buildAgentProfile("));
assert.ok(profileLine, "the profile is still assembled in one place");
assert.ok(!profileLine.includes("briefingContext"), "the briefing rides on the prompt, not the system prompt");

// Channel replies must not pin the CLI transport: it bypasses the warm pool
// and spawns a fresh CLI per message, measured at 15 s against 4 s.
assert.ok(
  !source.includes('transport: "cli"'),
  "channel dispatch must not pin the CLI transport; the bridge falls back on its own"
);

// Reply length (ADR-0055). The owner asked for short answers; these lines are
// the only thing asking for them, and they are easy to lose in a file this
// size. They are also constant, so they cost the warm pool nothing.
const profileStart = source.indexOf("function buildAgentProfile(");
assert.ok(profileStart > 0, "buildAgentProfile exists");
const profileBody = source.slice(profileStart, source.indexOf("\n}", profileStart));
for (const rule of [
  "One to three short sentences is the default",
  "Length is a cost to justify",
  "Do not open with a greeting",
  "Do not report repository or workspace status that nobody asked for",
  "Prose by default",
]) {
  assert.ok(profileBody.includes(rule), `the member prompt must still say: ${rule}`);
}
assert.ok(!/\$\{[^}]*\}/.test(profileBody.slice(profileBody.indexOf("One to three short"), profileBody.indexOf("Prose by default"))), "the reply-length rules must stay constant, not interpolated");

console.log("check-prompt-stability: ok");
