#!/usr/bin/env node
import assert from "node:assert/strict";
import { normalizeTaskProgress, taskProgressFromEvents, taskProgressFromMessage, taskProgressCounts, taskProgressSummary } from "../src/lib/task-progress.js";

let passed = 0;
function check(name, run) { run(); passed += 1; console.log(`ok ${passed} - ${name}`); }
const plan = (first = "in_progress", second = "pending") => ({ type: "plan_update", plan: [{ id: "inspect", step: "Inspect the failure", status: first }, { id: "verify", step: "Verify the change", status: second }] });

check("no checklist is invented from prose, tool activity, or contentless plan status", () => {
  assert.equal(taskProgressFromMessage({ body: "Everything is done.", status: "complete", streamEvents: [{ type: "status", status: "todo_list" }, { type: "step", step: 4 }, { type: "tool_start", tool: { name: "read_file", args: { path: "app.js" } } }] }), null);
});
check("latest complete canonical plan replaces earlier states", () => {
  const progress = taskProgressFromEvents([plan(), { type: "tool_end", success: true }, plan("completed", "in_progress")]);
  assert.deepEqual(progress.items.map((item) => item.status), ["completed", "in_progress"]);
  assert.equal(taskProgressSummary(progress, { isLoading: true }), "1 of 2 tasks completed · 1 in progress");
});
check("turn completion never marks unreported items completed", () => {
  const progress = taskProgressFromMessage({ status: "complete", streamEvents: [plan(), { type: "status", status: "agent_end" }] });
  assert.deepEqual(progress.items.map((item) => item.status), ["in_progress", "pending"]);
  assert.equal(taskProgressSummary(progress), "0 of 2 tasks completed · 1 pending · 1 without a completion update");
});
check("stop, error, and pause disclose the run state while retaining task states", () => {
  const progress = normalizeTaskProgress(plan());
  assert.match(taskProgressSummary(progress, { status: "stopped" }), /^Stopped · 0 of 2/);
  assert.match(taskProgressSummary(progress, { status: "error" }), /^Run failed · 0 of 2/);
  assert.match(taskProgressSummary(progress, { status: "paused" }), /^Paused · 0 of 2/);
  assert.match(taskProgressSummary(progress, { status: "blocked" }), /^Blocked · 0 of 2/);
});
check("Codex raw todo booleans and Claude TodoWrite args retain explicit state", () => {
  assert.deepEqual(taskProgressFromEvents([{ type: "item.updated", item: { type: "todo_list", items: [{ text: "Read", completed: true }, { text: "Test", completed: false }] } }]).items.map((item) => item.status), ["completed", "pending"]);
  const progress = taskProgressFromEvents([{ type: "tool_start", tool: { id: "todo-1", name: "TodoWrite", args: { todos: [{ content: "Test", status: "in_progress" }] } } }]);
  assert.equal(progress.items[0].status, "in_progress");
});
check("pinned Autohand todo_write tasks restore actual statuses from stored traces", () => {
  const call = { id: "autohand-tasks", name: "todo_write", args: { tasks: [{ content: "Inspect behavior", status: "completed", activeForm: "Inspecting behavior" }, { content: "Verify changes", status: "in_progress", activeForm: "Verifying changes" }] } };
  const progress = taskProgressFromMessage({ trace: { toolCalls: [call], toolResults: [{ id: call.id, success: true }] } });
  assert.deepEqual(progress.items.map((item) => item.status), ["completed", "in_progress"]);
  assert.equal(progress.items[0].title, "Inspect behavior");
  assert.equal(taskProgressFromMessage({ trace: { toolCalls: [call], toolResults: [{ id: call.id, success: false }] } }), null);
});
check("JSON tool args and namespaced update_plan are supported", () => {
  assert.equal(taskProgressFromEvents([{ type: "tool_call", call: { id: "p1", name: "functions.update_plan", args: JSON.stringify({ plan: [{ step: "Verify", status: "completed" }] }) } }]).items[0].status, "completed");
});
check("failed tool writes do not replace the previous successful plan", () => {
  const failed = { type: "tool_start", tool: { id: "bad", name: "TodoWrite", args: { todos: [{ content: "Pretend done", status: "completed" }] } } };
  assert.equal(taskProgressFromEvents([plan(), failed, { type: "tool_end", toolId: "bad", success: false }]).items[0].id, "inspect");
  assert.equal(taskProgressFromEvents([failed, { type: "tool_result", result: { id: "bad", is_error: true } }]), null);
});
check("unknown and unsafe state keys stay unknown", () => {
  const progress = normalizeTaskProgress({ items: [{ title: "Unknown", status: "maybe" }, { title: "Prototype", status: "__proto__" }, { title: "No state" }] });
  assert.deepEqual(progress.items.map((item) => item.status), ["unknown", "unknown", "unknown"]);
  assert.equal(taskProgressCounts({ items: [{ status: "total" }] }).unknown, 1);
});
check("stable fallback IDs survive task reorder and duplicate titles remain separate", () => {
  const left = normalizeTaskProgress({ items: [{ title: "Read" }, { title: "Test" }, { title: "Read" }] });
  const right = normalizeTaskProgress({ items: [{ title: "Test" }, { title: "Read" }, { title: "Read" }] });
  assert.equal(left.items[0].id, right.items[1].id);
  assert.equal(left.items[1].id, right.items[0].id);
  assert.notEqual(left.items[0].id, left.items[2].id);
});
check("duplicate explicit IDs reconcile to the last reported state", () => {
  const progress = normalizeTaskProgress({ items: [{ id: "one", title: "Read", status: "pending" }, { id: "one", title: "Read", status: "completed" }] });
  assert.equal(progress.items.length, 1);
  assert.equal(progress.items[0].status, "completed");
});
check("explicit empty snapshot clears stale checklist", () => {
  assert.deepEqual(taskProgressFromEvents([plan(), { type: "progress", items: [] }]).items, []);
  assert.deepEqual(taskProgressFromMessage({ progress: { items: [] }, streamEvents: [plan()] }).items, []);
});
check("durable raw and serialized plan traces restore the final checklist", () => {
  assert.equal(taskProgressFromMessage({ trace: { events: [{ type: "plan_update", content: JSON.stringify(plan("completed", "completed")) }] } }).items[1].status, "completed");
  const progress = taskProgressFromMessage({ trace: { toolCalls: [{ id: "stored", name: "update_plan", args: { plan: [{ step: "Verify", status: "completed" }] } }] } });
  assert.equal(taskProgressSummary(progress), "1 task completed");
});
check("persisted task calls obey tool failure outcomes", () => {
  assert.equal(taskProgressFromMessage({ trace: { toolCalls: [{ id: "failed", name: "TodoWrite", args: { todos: [{ content: "Verify", status: "completed" }] } }], toolResults: [{ id: "failed", is_error: true }] } }), null);
});
check("goal/progress snapshots have priority over earlier stream plans", () => {
  const message = { goal: { status: "completed", checklist: [{ id: "ship", title: "Ship", status: "completed" }], summary: "Shipped the change." }, streamEvents: [plan()] };
  assert.equal(taskProgressFromMessage(message).items[0].id, "ship");
  message.progress = { items: [{ id: "now", title: "Current", status: "blocked" }], summary: "Input needed", outcome: "blocked" };
  assert.equal(taskProgressFromMessage(message).summary, "Input needed");
});
check("failed, blocked and cancelled items are never counted as completed", () => {
  const progress = normalizeTaskProgress({ items: ["completed", "failed", "blocked", "cancelled"].map((status) => ({ title: status, status })) });
  assert.equal(taskProgressSummary(progress), "1 of 4 tasks completed · 1 failed · 1 blocked · 1 cancelled");
});
check("malformed payloads have no invented checklist", () => {
  for (const value of [null, "not json", { summary: "All done" }, { items: "not an array" }]) assert.equal(normalizeTaskProgress(value), null);
  assert.deepEqual(normalizeTaskProgress({ items: [null, {}, { title: " " }] }).items, []);
});
console.log(`${passed} task progress checks passed.`);
