#!/usr/bin/env node
// Checks for the activity feed normaliser (server/activity/normalize.mjs,
// re-exported by src/lib/activity.js). Builds a realistic ~200-event chat
// stream in the shape `chatStreamEventFromSdkEvent` emits, then asserts the
// acceptance criteria from issue #30: rows below 15% of raw events, a failing
// tool visible in the collapsed feed, quiet reads summarised, message deltas
// coalesced. Also folds the same run as `run.logs` lines and checks the
// route plug-in answers both endpoints.

import assert from "node:assert/strict";

import { activityFromTrace, activityStats, collapseActivity, normalizeActivity, summarizeQuiet } from "../src/lib/activity.js";
import * as route from "../server/routes/activity.route.mjs";

// ---------------------------------------------------------------------------
// Fixture: one chat turn, ~200 stream events.

const t0 = Date.parse("2026-09-26T10:00:00.000Z");
let tick = 0;
const at = () => new Date(t0 + (tick += 250)).toISOString();

const events = [];
const push = (event) => events.push(event);

push({ type: "status", status: "sdk_prepare", label: "Preparing SDK transport...", timestamp: at() });
push({ type: "status", status: "sdk_start", label: "Starting the local agent bridge...", timestamp: at() });
push({ type: "status", status: "prompt_start", label: "Sending the request to the model...", timestamp: at() });
push({ type: "status", status: "agent_start", timestamp: at() });

// Thinking before the first text.
for (const piece of ["Let me look at ", "the router first, ", "then the failing test."]) {
  push({ type: "message_delta", messageId: "sess-1", delta: "", thought: piece, timestamp: at() });
}

// Twelve quiet reads, each with a streamed result.
const readFiles = ["src/App.jsx", "src/main.jsx", "src/lib/utils.js", "src/lib/presence.js", "server.mjs", "server/events.mjs", "package.json", "vite.config.js", "DESIGN.md", "README.md", "src/locales.js", "index.html"];
readFiles.forEach((file, index) => {
  const id = `toolu_read_${index}`;
  push({ type: "tool_start", tool: { id, name: "read_file", args: { path: file }, timestamp: at() } });
  push({ type: "tool_update", toolId: id, output: `${file}: line 1\n`, stream: "stdout", timestamp: at() });
  push({ type: "tool_update", toolId: id, output: `${file}: line 2\n`, stream: "stdout", timestamp: at() });
  push({ type: "tool_end", toolId: id, toolName: "read_file", success: true, output: `${file} (2 lines)`, stream: "stdout", timestamp: at() });
});

// Two searches and a directory listing.
push({ type: "tool_start", tool: { id: "toolu_grep_1", name: "grep", args: { pattern: "useRouter", path: "src" }, timestamp: at() } });
push({ type: "tool_end", toolId: "toolu_grep_1", toolName: "grep", success: true, output: "src/App.jsx:12\nsrc/App.jsx:88", timestamp: at() });
push({ type: "tool_start", tool: { id: "toolu_glob_1", name: "glob", args: { pattern: "**/*.test.jsx" }, timestamp: at() } });
push({ type: "tool_end", toolId: "toolu_glob_1", toolName: "glob", success: true, output: "src/App.test.jsx", timestamp: at() });
push({ type: "tool_start", tool: { id: "toolu_ls_1", name: "list_dir", args: { path: "src/components" }, timestamp: at() } });
push({ type: "tool_end", toolId: "toolu_ls_1", toolName: "list_dir", success: true, output: "chat/\nchannels/\nui/", timestamp: at() });

// A streamed message: 60 deltas, one message_end.
const answerWords = "I found the bug. The router re-renders the chat column on every presence tick because the memo key includes the whole agents array. I will narrow the key to the member id and add a test.".split(" ");
for (const word of answerWords) push({ type: "message_delta", messageId: "sess-1", delta: `${word} `, timestamp: at() });
while (events.filter((event) => event.type === "message_delta" && event.delta).length < 60) {
  push({ type: "message_delta", messageId: "sess-1", delta: ". ", timestamp: at() });
}
push({ type: "message_end", messageId: "msg_01", content: answerWords.join(" "), timestamp: at() });

// Prominent edits and shell commands, one of which fails.
push({ type: "tool_start", tool: { id: "toolu_edit_1", name: "edit_file", args: { path: "src/App.jsx", old_string: "agents", new_string: "agent.id" }, timestamp: at() } });
push({ type: "tool_end", toolId: "toolu_edit_1", toolName: "edit_file", success: true, output: "Edited src/App.jsx", timestamp: at() });
push({ type: "tool_start", tool: { id: "toolu_write_1", name: "write_file", args: { path: "src/App.test.jsx", content: "test('memo', () => {})" }, timestamp: at() } });
push({ type: "tool_end", toolId: "toolu_write_1", toolName: "write_file", success: true, output: "Wrote 1 file", timestamp: at() });

push({ type: "tool_start", tool: { id: "toolu_bash_1", name: "bash", args: { command: "bun run test -- src/App.test.jsx" }, timestamp: at() } });
for (let index = 0; index < 20; index += 1) {
  push({ type: "tool_update", toolId: "toolu_bash_1", output: `test ${index + 1}/20 ${index === 13 ? "FAIL" : "ok"}\n`, stream: index === 13 ? "stderr" : "stdout", timestamp: at() });
}
push({ type: "tool_end", toolId: "toolu_bash_1", toolName: "bash", success: false, error: "Command failed: 1 of 20 tests failed (memo key still includes agents)", stream: "stderr", timestamp: at() });

// Recovery: another read, an edit, the tests again, the final message.
push({ type: "tool_start", tool: { id: "toolu_read_x", name: "read_file", args: { path: "src/App.jsx", offset: 80, limit: 20 }, timestamp: at() } });
push({ type: "tool_end", toolId: "toolu_read_x", toolName: "read_file", success: true, output: "…", timestamp: at() });
push({ type: "tool_start", tool: { id: "toolu_edit_2", name: "edit_file", args: { path: "src/App.jsx", old_string: "[agents]", new_string: "[agent.id]" }, timestamp: at() } });
push({ type: "tool_end", toolId: "toolu_edit_2", toolName: "edit_file", success: true, output: "Edited src/App.jsx", timestamp: at() });
push({ type: "tool_start", tool: { id: "toolu_bash_2", name: "bash", args: { command: "bun run test -- src/App.test.jsx" }, timestamp: at() } });
for (let index = 0; index < 20; index += 1) {
  push({ type: "tool_update", toolId: "toolu_bash_2", output: `test ${index + 1}/20 ok\n`, stream: "stdout", timestamp: at() });
}
push({ type: "tool_end", toolId: "toolu_bash_2", toolName: "bash", success: true, output: "20 passed", stream: "stdout", timestamp: at() });

push({ type: "permission_request", title: "Run git commit", content: '{"command":"git commit -am \\"fix memo key\\""}', timestamp: at() });
push({ type: "tool_start", tool: { id: "toolu_bash_3", name: "bash", args: { command: 'git commit -am "fix memo key"' }, timestamp: at() } });
push({ type: "tool_end", toolId: "toolu_bash_3", toolName: "bash", success: true, output: "[main 1a2b3c] fix memo key", timestamp: at() });

for (const word of "Fixed: the chat column now memoises on the member id; 20 tests pass and the change is committed.".split(" ")) {
  push({ type: "message_delta", messageId: "sess-1", delta: `${word} `, timestamp: at() });
}
push({ type: "message_end", messageId: "msg_02", content: "Fixed: the chat column now memoises on the member id; 20 tests pass and the change is committed.", timestamp: at() });
push({ type: "status", status: "agent_end", timestamp: at() });

assert.ok(events.length >= 195 && events.length <= 260, `fixture should be about 200 events, got ${events.length}`);

// ---------------------------------------------------------------------------
// Stream events → items.

const items = normalizeActivity(events, { status: "completed" });
const rows = collapseActivity(items);
const stats = activityStats(items);

console.log(`raw events: ${events.length}; items: ${items.length}; collapsed rows: ${rows.length}; ${summarizeQuiet(items)}`);

assert.ok(rows.length < events.length * 0.15, `collapsed rows ${rows.length} must be below 15% of ${events.length} events`);
assert.ok(rows.length >= 8, `a real run should still read as several rows, got ${rows.length}`);

// Every id unique and deterministic across a second pass.
assert.equal(new Set(items.map((item) => item.id)).size, items.length, "item ids are unique");
assert.deepEqual(normalizeActivity(events, { status: "completed" }).map((item) => item.id), items.map((item) => item.id), "ids are deterministic");

// Message deltas coalesce: 60+ deltas → one message item with the full text.
const messages = items.filter((item) => item.kind === "message");
assert.equal(messages.length, 2, `two message items expected, got ${messages.length}`);
assert.equal(messages[0].detail, answerWords.join(" "), "message_end content replaces the coalesced deltas");
assert.equal(messages[0].state, "done");
assert.equal(messages[0].id, "message:sess-1:1");

// Thought deltas coalesce into one quiet thought.
const thoughts = items.filter((item) => item.kind === "thought");
assert.equal(thoughts.length, 1);
assert.ok(thoughts[0].quiet && thoughts[0].detail.includes("failing test"));

// Reads are quiet and summarised; the summary sentence counts them.
const reads = items.filter((item) => item.verb === "read");
assert.equal(reads.length, 13, `13 reads, got ${reads.length}`);
assert.ok(reads.every((item) => item.quiet && item.state === "done"), "reads are quiet and done");
assert.ok(summarizeQuiet(items).startsWith("read 13 files"), summarizeQuiet(items));
assert.ok(summarizeQuiet(items).includes("2 searches"), summarizeQuiet(items));
const firstSummary = rows.find((row) => row.kind === "summary" && row.items.some((item) => item.verb === "read"));
assert.ok(firstSummary, "quiet reads collapse into a summary row");
assert.ok(firstSummary.label.startsWith("read 12 files"), `summary label: ${firstSummary.label}`);
assert.ok(rows.some((row) => row.kind === "summary" && row.items.some((item) => item.verb === "search")), "searches join the quiet run");

// Tool pairing by id: the streamed bash output lands on the tool row.
const failedBash = items.find((item) => item.id === "tool:toolu_bash_1");
assert.ok(failedBash, "tool_start/tool_end pair by id");
assert.equal(failedBash.kind, "shell");
assert.equal(failedBash.state, "failed");
assert.equal(failedBash.quiet, false);
assert.equal(failedBash.object, "bun run test -- src/App.test.jsx");
assert.match(failedBash.outcome, /1 of 20 tests failed/);
assert.ok(failedBash.detail.includes("test 14/20 FAIL"), "tool_update output is kept in detail");
assert.deepEqual(failedBash.refs, [{ type: "command", value: "bun run test -- src/App.test.jsx" }]);

// The failure is visible in the collapsed output without expanding anything.
assert.ok(rows.some((row) => row.id === "tool:toolu_bash_1" && row.state === "failed"), "failed tool is a top-level collapsed row");

// Edits and writes are prominent rows.
for (const id of ["tool:toolu_edit_1", "tool:toolu_write_1", "tool:toolu_edit_2"]) {
  const row = rows.find((candidate) => candidate.id === id);
  assert.ok(row && row.kind === "edit" && !row.quiet && row.state === "done", `${id} is a prominent edit row`);
}
assert.equal(rows.find((row) => row.id === "tool:toolu_edit_1").object, "src/App.jsx");

// Approval resolves once the next tool starts; status runs coalesce.
const approval = items.find((item) => item.kind === "approval");
assert.ok(approval && approval.state === "done" && approval.object === "Run git commit");
assert.equal(items.filter((item) => item.kind === "status").length, 2, "leading and trailing status runs each coalesce to one item");
assert.equal(items[0].id, "status:1");
assert.equal(items[0].object, "agent start");

assert.equal(stats.failed, 1);
assert.equal(stats.pending, 0);

// ---------------------------------------------------------------------------
// Live feed: ids are stable while events keep arriving, rows update in place.

const half = normalizeActivity(events.slice(0, 120), { status: "running", live: true });
const full = normalizeActivity(events, { status: "running", live: true });
assert.deepEqual(half.map((item) => item.id), full.slice(0, half.length).map((item) => item.id), "a growing stream keeps earlier ids");

const midBash = events.findIndex((event) => event.type === "tool_end" && event.toolId === "toolu_bash_1");
const pendingSnapshot = normalizeActivity(events.slice(0, midBash), { status: "running", live: true });
const pendingBash = pendingSnapshot.find((item) => item.id === "tool:toolu_bash_1");
assert.equal(pendingBash.state, "pending", "a tool without its result is pending");
assert.ok(pendingBash.detail.includes("test 14/20 FAIL"), "streamed output shows while pending");
const stopped = normalizeActivity(events.slice(0, midBash), { status: "stopped" });
assert.equal(stopped.find((item) => item.id === "tool:toolu_bash_1").state, "failed", "a stopped run fails its pending tools");

// ---------------------------------------------------------------------------
// Raw SDK events and trace events fold the same way.

const sdkItems = normalizeActivity(
  [
    { type: "message_update", messageId: "s", delta: "Hi ", timestamp: at() },
    { type: "message_update", messageId: "s", delta: "there", timestamp: at() },
    { type: "tool_start", toolId: "t1", toolName: "Read", args: { file_path: "/a.js" }, timestamp: at() },
    { type: "tool_end", toolId: "t1", toolName: "Read", success: true, output: "…", timestamp: at() },
    { type: "tool_start", toolId: "t2", toolName: "apply_patch", args: { changes: [{ kind: "update", path: "b.js" }] }, timestamp: at() },
    { type: "tool_end", toolId: "t2", toolName: "apply_patch", success: false, error: "patch did not apply", timestamp: at() },
    { type: "error", message: "Codex turn failed", timestamp: at() },
  ],
  { status: "failed" }
);
assert.deepEqual(
  sdkItems.map((item) => [item.id, item.kind, item.state, item.quiet]),
  [
    ["message:s:1", "message", "done", false],
    ["tool:t1", "tool", "done", true],
    ["tool:t2", "edit", "failed", false],
    ["error:1", "error", "failed", false],
  ]
);
assert.equal(sdkItems[0].detail, "Hi there");
assert.equal(sdkItems[2].object, "b.js");

const traceItems = activityFromTrace({
  events: [
    { type: "thought", thought: "plan", reflection: "", timestamp: "2026-09-26T10:00:00.000Z" },
    { type: "tool_call", call: { id: "c1", name: "search", args: { query: "foo" } }, timestamp: "2026-09-26T10:00:01.000Z" },
    { type: "status", status: "cli_start", title: "Running local runtime...", timestamp: "2026-09-26T10:00:02.000Z" },
  ],
  toolCalls: [{ id: "c1", name: "search", args: { query: "foo" } }],
  toolResults: [{ id: "c1", name: "search", content: "3 hits", timestamp: "2026-09-26T10:00:03.000Z" }],
  messages: [{ role: "assistant", content: "Done.", timestamp: "2026-09-26T10:00:04.000Z" }],
});
assert.equal(traceItems.find((item) => item.id === "tool:c1").state, "done", "live-trace toolResults resolve trace tool_call rows");
assert.equal(traceItems.find((item) => item.id === "tool:c1").outcome, "3 hits");
assert.equal(traceItems.at(-1).kind, "message");

// ---------------------------------------------------------------------------
// run.logs lines (appendLog + appendSdkEventLog shape).

const logs = [
  { source: "system", line: "started Claude Code 2.1 transport claude --print", at: at() },
  { source: "channel", line: "Channel dispatch #frontend thread th-1.", at: at() },
  { source: "sdk", line: "agent started: claude-sonnet", at: at() },
  { source: "tool", line: "started read_file {", at: at() },
  { source: "tool", line: '  "path": "src/App.jsx"', at: at() },
  { source: "tool", line: "}", at: at() },
  { source: "stdout", line: "1: import React", at: at() },
  { source: "tool", line: "read_file completed at 2026-09-26T10:05:00.000Z", at: at() },
  { source: "tool", line: "started bash {", at: at() },
  { source: "tool", line: '  "command": "cargo test"', at: at() },
  { source: "tool", line: "}", at: at() },
  { source: "stdout", line: "running 3 tests", at: at() },
  { source: "stderr", line: "test db::migrate ... FAILED", at: at() },
  { source: "tool", line: "bash failed at 2026-09-26T10:06:00.000Z", at: at() },
  { source: "stdout", line: "The migration test fails because the fixture is stale.", at: at() },
  { source: "stdout", line: "I will regenerate it.", at: at() },
  { source: "permission", line: "bash requested permission: regenerate fixtures", at: at() },
  { source: "stderr", line: "warning: unused variable", at: at() },
  { source: "sdk", line: "agent ended: completed", at: at() },
];
const logItems = normalizeActivity(logs, { status: "completed" });
const kinds = logItems.map((item) => `${item.kind}:${item.state}${item.quiet ? ":q" : ""}`);
assert.deepEqual(kinds, ["status:done:q", "tool:done:q", "shell:failed", "message:done", "approval:done", "status:done:q", "status:done:q"], kinds.join(", "));
assert.equal(logItems[1].object, "src/App.jsx", "multi-line JSON args parse back into an object");
assert.equal(logItems[2].object, "cargo test");
assert.equal(logItems[2].endedAt, "2026-09-26T10:06:00.000Z");
assert.ok(logItems[2].detail.includes("[stderr] test db::migrate ... FAILED"));
assert.equal(logItems[3].detail.trim(), "The migration test fails because the fixture is stale.\nI will regenerate it.", "consecutive stdout lines coalesce into one message");
assert.equal(logItems[4].object, "bash: regenerate fixtures");
assert.equal(collapseActivity(logItems).length, 5, "log feed collapses quiet runs");

// ---------------------------------------------------------------------------
// Route plug-in.

const runs = new Map([["run-1", { id: "run-1", status: "failed", logs }]]);
const ctx = {
  runs,
  json: (res, status, body) => Object.assign(res, { status, body }),
  readBody: async (req) => req.body,
};
const res = {};
assert.equal(await route.handle({ method: "GET" }, res, new URL("http://x/api/runs/run-1/activity"), ctx), true);
assert.equal(res.status, 200);
assert.equal(res.body.data.source, "logs");
assert.equal(res.body.data.items.length, logItems.length);
assert.equal(res.body.data.raw.length, logs.length);
const missing = {};
await route.handle({ method: "GET" }, missing, new URL("http://x/api/runs/nope/activity"), ctx);
assert.equal(missing.status, 404);
const posted = {};
assert.equal(await route.handle({ method: "POST", body: { events, status: "completed" } }, posted, new URL("http://x/api/activity/normalize"), ctx), true);
assert.equal(posted.status, 200);
assert.equal(posted.body.data.rows.length, rows.length);
assert.equal(posted.body.data.stats.failed, 1);
assert.equal(await route.handle({ method: "GET" }, {}, new URL("http://x/api/other"), ctx), false);

console.log(`check:activity ok — ${items.length} items, ${rows.length} rows from ${events.length} events (${Math.round((rows.length / events.length) * 100)}%)`);
