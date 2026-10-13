import assert from "node:assert/strict";
import {
  channelProposalRows,
  cutOnWord,
  decisionRows,
  needsYouSummary,
  routineProposalRows,
  stoppedWorkRows,
  unreadRows,
  workAttentionCount,
  workRowsInProgress,
  workRowsNeedingYou,
  workViewForRoute,
} from "../src/lib/work-attention.js";

const handoff = { id: "h", task: { id: "handoff" }, title: "Review the fix", at: "2026-10-14T09:00:00.000Z" };
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

// The sidebar count is decisions plus unread, never the stopped work (ADR-0121):
// a failed reply is already an unread reply, so it was counted twice.
const decisions = { approvals: [{ id: "a" }], handoffs: [handoff], memoryProposals: [{ id: "m" }], rows };
assert.equal(workAttentionCount({ ...decisions, replies: [{}], unreadChannels: [{}] }), 5, "three decisions and two unread");
assert.equal(workAttentionCount(decisions), 3, "Reading updates retains unresolved decisions");
assert.equal(workAttentionCount({ ...decisions, channelProposals: [{ id: "c" }], routineProposals: [{ id: "r" }], vaultRequests: [{ id: "v" }], folderRequests: [{ id: "f" }] }), 7, "every decision kind counts once");
assert.equal(workAttentionCount({ rows }), 0, "stopped work alone does not move the badge");
assert.equal(workViewForRoute("/work"), "needs-you");
assert.equal(workViewForRoute("/work", "in-progress"), "in-progress");
assert.equal(workViewForRoute("/work?task=done", "needs-you"), "all");
assert.equal(workViewForRoute("/work?run=run-1", "needs-you"), "all");
assert.equal(workViewForRoute("/work?view=needs-you&task=blocked", "all"), "needs-you");
assert.equal(workViewForRoute("/inbox", "all"), "needs-you");
assert.equal(workViewForRoute("/mission-control", "needs-you"), "all");
assert.equal(workViewForRoute("/work?handoff=h-1", "all"), "needs-you");
assert.equal(workViewForRoute("/work?view=unknown", "unknown"), "needs-you");

// ---- decisions: grouped by kind in a fixed order, newest first inside a kind
const members = [{ id: "alex", name: "Alex" }, { id: "noah", name: "Noah" }];
const list = decisionRows({
  memoryProposals: [{ id: "m1", title: "Memory", at: "2026-10-14T08:00:00.000Z" }],
  approvals: [{ id: "a-old", title: "Release checklist", detail: "#ops · Noah", at: "2026-10-14T07:00:00.000Z" }, { id: "a-new", title: "Deploy gate", detail: "#ops · Alex", at: "2026-10-14T09:30:00.000Z" }],
  vaultRequests: [{ id: "v-pay", title: "Alex wants to pay 19.99 USD to Fastmail", request: { type: "payment" }, at: "2026-10-14T09:00:00.000Z" }, { id: "v-secret", title: "Alex needs GitHub login", request: { type: "secret" }, at: "2026-10-14T09:10:00.000Z" }],
  folderRequests: [{ id: "f1", title: "Alex needs /leads", at: "2026-10-14T09:20:00.000Z" }],
  handoffs: [{ ...handoff, who: "Noah → Iris" }],
  channelProposals: channelProposalRows([{ id: "c1", status: "proposed", actorId: "noah", action: { name: "client-abc", purpose: "The ABC rollout." }, createdAt: "2026-10-14T06:00:00.000Z" }, { id: "c2", status: "created", actorId: "noah", action: { name: "done" } }], members),
  routineProposals: routineProposalRows([{ id: "r1", status: "proposed", memberId: "alex", title: "Sync the sheet", description: "Every weekday at 09:00", timeZone: "Pacific/Auckland", createdAt: "2026-10-14T05:00:00.000Z" }, { id: "r2", status: "proposed", memberId: "alex", title: "Expired", expired: true }], members),
});
assert.deepEqual(list.map((row) => row.kind), ["approval", "approval", "vault", "vault", "folder", "handoff", "channel", "routine", "memory"], "kinds in order, one row per pending item");
assert.deepEqual(list.filter((row) => row.kind === "approval").map((row) => row.id), ["a-new", "a-old"], "newest first inside a kind");
assert.deepEqual(list.filter((row) => row.kind === "vault").map((row) => row.id), ["v-secret", "v-pay"]);
assert.deepEqual(list.map((row) => row.action), ["Approve", "Approve", "Open secure form", "Decide payment", "Allow or decline", "Review handoff", "Approve channel", "Confirm routine", "Review memory"], "each row names the exact action word");
assert.equal(list.find((row) => row.kind === "channel").title, "Noah proposes #client-abc");
assert.equal(list.find((row) => row.kind === "routine").title, "Alex proposes a routine: Sync the sheet");
assert.equal(list.find((row) => row.kind === "routine").detail, "Every weekday at 09:00 · Pacific/Auckland");
assert.equal(list.find((row) => row.kind === "handoff").who, "Noah → Iris");
assert.equal(list.length, workAttentionCount({ approvals: [{}, {}], vaultRequests: [{}, {}], folderRequests: [{}], handoffs: [{}], channelProposals: [{}], routineProposals: [{}], memoryProposals: [{}] }), "the badge counts exactly the decision rows");

// ---- unread: replies and channels as one list, newest first
const unread = unreadRows({ replies: [{ id: "reply-alex", agentId: "alex", name: "Alex", count: 2, preview: "Done.", at: "2026-10-14T09:00:00.000Z" }], unreadChannels: [{ channel: { id: "ops", name: "ops" }, preview: "Waiting for approval", latestAt: "2026-10-14T09:30:00.000Z" }] });
assert.deepEqual(unread.map((row) => row.title), ["#ops", "Alex · 2"]);

// ---- work that stopped: one line each, never the command line
const COMMAND = "claude -p 'changed go ahead' --output-format stream-json --verbose --mcp-config '<squad-managed-mcp-config>'";
const owner = { id: "alex", name: "Alex" };
const stoppedInput = [
  { id: "run-chat", status: "failed", owner, run: { id: "chat", mode: "chat", title: "changed go ahead and ship the pricing page copy we agreed on this morning, then tell me when the deploy is green", command: COMMAND, startedAt: "2026-10-14T09:00:00.000Z" }, blocker: "", summary: COMMAND, updatedAt: "2026-10-14T09:00:05.000Z", detailPath: "/work?run=chat" },
  { id: "run-titleless", status: "failed", owner, run: { id: "bare", mode: "chat", title: COMMAND, command: COMMAND }, blocker: "", updatedAt: "2026-10-14T08:00:00.000Z" },
  { id: "run-goal", status: "failed", owner, run: { id: "goal", mode: "goal", title: "Goal: keep the sheet in sync", command: COMMAND }, blocker: "Standalone run failed before a parent task was linked.", updatedAt: "2026-10-14T07:00:00.000Z" },
  { id: "run-launch", status: "failed", owner: { id: "noah", name: "Noah" }, run: { id: "launch", mode: "prompt", title: "Launch: nightly smoke test", command: "autohand run --prompt 'smoke'" }, blocker: "Standalone run failed before a parent task was linked.", updatedAt: "2026-10-14T06:00:00.000Z" },
  { id: "task-blocked", status: "blocked", owner: { id: "noah", name: "Noah" }, task: { id: "t1", title: "Migrate the billing webhooks" }, blocker: "The staging key is missing from the environment, so the webhook test cannot run.", updatedAt: "2026-10-14T05:00:00.000Z" },
  { id: "task-handoff", status: "handoff-pending", owner, task: handoff.task, blocker: "Awaiting handoff review" },
  { id: "run-ok", status: "completed", owner, run: { id: "ok", mode: "chat", title: "Fine", command: COMMAND } },
];
const stopped = stoppedWorkRows(stoppedInput, [handoff], { statusLabels: { failed: "failed", blocked: "blocked" } });
assert.deepEqual(stopped.map((row) => row.id), ["run-chat", "run-titleless", "run-goal", "run-launch", "task-blocked"], "a pending handoff is a decision, not stopped work; completed work is not listed");
assert.deepEqual(stopped.map((row) => row.kind), ["chat", "chat", "goal", "launched", "task"]);
assert.deepEqual(stopped.map((row) => row.action), ["retry-chat", "retry-chat", "open-chat", "replay", "open-chat"], "Retry in chat for a reply, Replay only for a launched run");
const chat = stopped[0];
assert.equal(chat.member, "Alex");
assert.equal(chat.title, "changed go ahead and ship the pricing page copy we agreed on this morning, then tell me…", "the question is cut on a word");
assert.equal(chat.statusLabel, "failed");
assert.equal(chat.reason, "", "a reply's failure stays in the conversation");
for (const row of stopped) {
  const text = JSON.stringify([row.title, row.reason, row.member, row.statusLabel]);
  assert.ok(!text.includes("--output-format") && !text.includes("autohand run"), `no command line on a stopped row: ${text}`);
  assert.ok(!text.includes("Standalone run failed"), `no standalone-run sentence: ${text}`);
}
assert.equal(stopped[1].title, "chat reply", "a run whose title is its command line reads as a chat reply");
assert.equal(stopped[4].reason, "The staging key is missing from the environment, so the webhook test cannot run.", "a task keeps its own blocker on one line");
assert.equal(cutOnWord("short"), "short");
assert.equal(cutOnWord("a".repeat(100)).length, 89, "a single long word is cut hard");

// ---- the sentence under the title names only what is true
assert.equal(needsYouSummary({ decisions: 2, unread: 1, stopped: 3, working: 1 }), "2 decisions · 1 unread · 3 stopped · 1 working");
assert.equal(needsYouSummary({ decisions: 1 }), "1 decision");
assert.equal(needsYouSummary({}), "You're caught up. Nothing needs you right now.");
assert.equal(needsYouSummary({ decisions: 2 }, { workDecisionMany: "{count} décisions" }, (n) => `[${n}]`), "[2] décisions");

console.log("Work attention checks passed: decisions grouped by kind newest first with their action words, unread as one list, stopped work as one line without command text, the badge equal to decisions plus unread, saved filters, legacy routes and record deep links.");
