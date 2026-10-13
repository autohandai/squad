import assert from "node:assert/strict";
import { workAttentionCount, workRowsInProgress, workRowsNeedingYou, workViewForRoute } from "../src/lib/work-attention.js";

const handoff = { task: { id: "handoff" } };
const rows = [
  { id: "handoff", task: handoff.task, status: "handoff-pending" },
  { id: "blocked", status: "blocked" },
  { id: "failed", status: "failed" },
  { id: "working", status: "running" },
  { id: "queued", status: "pending" },
  { id: "done", status: "completed", blocker: "Historical blocker" },
];
assert.deepEqual(workRowsNeedingYou(rows, [handoff]).map((row) => row.id), ["blocked", "failed"]);
assert.deepEqual(workRowsInProgress(rows).map((row) => row.id), ["working", "queued"]);
const decisions = { approvals: [{}], handoffs: [handoff], memoryProposals: [{}], rows };
assert.equal(workAttentionCount({ ...decisions, replies: [{}], unreadChannels: [{}] }), 7);
assert.equal(workAttentionCount(decisions), 5, "Reading updates retains unresolved decisions and failures");
assert.equal(workViewForRoute("/work"), "needs-you");
assert.equal(workViewForRoute("/work", "in-progress"), "in-progress");
assert.equal(workViewForRoute("/work?task=done", "needs-you"), "all");
assert.equal(workViewForRoute("/work?run=run-1", "needs-you"), "all");
assert.equal(workViewForRoute("/work?view=needs-you&task=blocked", "all"), "needs-you");
assert.equal(workViewForRoute("/inbox", "all"), "needs-you");
assert.equal(workViewForRoute("/mission-control", "needs-you"), "all");
assert.equal(workViewForRoute("/work?handoff=h-1", "all"), "needs-you");
assert.equal(workViewForRoute("/work?view=unknown", "unknown"), "needs-you");
console.log("Work attention checks passed: priority, deduplication, pending decisions, saved filters, legacy routes and record deep links.");
