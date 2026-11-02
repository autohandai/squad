#!/usr/bin/env node
// Permission requests answered from the chat, and the conversation replay a
// restarted engine session receives (ADR-0161). Deterministic, with a fake SDK.
import assert from "node:assert/strict";

import { PERMISSION_DECISIONS, PermissionApprovalError, PermissionApprovals, normalizePermissionDecision } from "../server/permission-approvals.mjs";
import { REPLAY_MAX_CHARS, REPLAY_MAX_TURNS, conversationReplay, replayTurns } from "../server/chats/replay.mjs";

// --- approvals -------------------------------------------------------------

{
  const calls = [];
  // The real SDK (1.0.5) spells these acknowledgePermission and permissionResponse.
  const sdk = {
    async acknowledgePermission(params) { calls.push(["ack", params]); return { success: true }; },
    async permissionResponse(params) { calls.push(["respond", params]); },
  };
  const sent = [];
  const approvals = new PermissionApprovals({ now: () => "2026-11-02T00:00:00.000Z" });
  const event = approvals.request({ requestId: "perm-1", tool: "write_file", description: "Write to this file? compliance/program-design.md", context: { path: "compliance/program-design.md" }, options: ["allow_once", "deny_once"], timestamp: "t1" }, { sdk, runId: "run-1", agentId: "cos", send: (data) => sent.push(data) });
  assert.equal(event.type, "permission_request");
  assert.equal(event.requestId, "perm-1");
  assert.equal(event.tool, "write_file");
  assert.equal(event.title, "Write to this file? compliance/program-design.md");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [["ack", { requestId: "perm-1" }]], "the request is acknowledged at once so the CLI waits for the person instead of 30 seconds");
  assert.equal(approvals.list("cos").length, 1);
  assert.equal(approvals.list("other").length, 0);

  // A second request on the same run, then the person allows the first.
  approvals.request({ requestId: "perm-2", tool: "run_command", description: "Run this command?", context: { command: "find ." } }, { sdk, runId: "run-1", agentId: "cos", send: (data) => sent.push(data) });
  const decided = await approvals.decide("perm-1", "allow");
  assert.equal(decided.decision, "allow_once", "a bare allow is a one-off allow; nothing is written to the member's allowList");
  assert.ok(calls.some(([kind, params]) => kind === "respond" && params.requestId === "perm-1" && params.decision === "allow_once"), "the decision reaches the engine");
  assert.deepEqual(sent.at(-1), { type: "permission_resolved", requestId: "perm-1", tool: "write_file", decision: "allow_once", source: "person", timestamp: "2026-11-02T00:00:00.000Z" });

  await assert.rejects(approvals.decide("perm-1", "allow"), (error) => error instanceof PermissionApprovalError && error.status === 410, "a decided request cannot be decided twice");

  await assert.rejects(approvals.decide("perm-2", "allow_always_user"), (error) => error instanceof PermissionApprovalError && error.status === 400, "persistent scopes are not offered from the chat");

  // The turn ends with perm-2 still open: the engine hears a denial and the browser hears why.
  const settled = await approvals.settleRun("run-1", { reason: "stopped" });
  assert.equal(settled, 1);
  assert.deepEqual(calls.at(-1), ["respond", { requestId: "perm-2", decision: "deny_once" }]);
  assert.equal(sent.at(-1).type, "permission_resolved");
  assert.equal(sent.at(-1).source, "closed");
  assert.equal(approvals.stats().pending, 0);

  // "Allow for this reply" covers every later request for that tool in the
  // same run: the CLI's own session scope stops at the exact path.
  {
    const replies = [];
    const reg = (id, tool, runId) => approvals.request({ requestId: id, tool, description: `${tool}?`, context: {} }, { sdk, runId, agentId: "cos", send: (data) => replies.push(data) });
    assert.equal(reg("perm-7", "run_command", "run-3")?.requestId, "perm-7");
    const chosen = await approvals.decide("perm-7", "allow_session");
    assert.equal(chosen.decision, "allow_session");
    const count = calls.length;
    assert.equal(reg("perm-8", "run_command", "run-3"), null, "no card for a tool already allowed for this reply");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(calls.slice(count).some(([kind, params]) => kind === "respond" && params.requestId === "perm-8" && params.decision === "allow_once"), "the engine is answered at once");
    assert.equal(replies.at(-1)?.type, "permission_resolved");
    assert.equal(replies.at(-1)?.source, "reply");
    assert.equal(reg("perm-9", "write_file", "run-3")?.requestId, "perm-9", "a different tool still asks");
    assert.equal(reg("perm-10", "run_command", "run-4")?.requestId, "perm-10", "another run still asks");
    await approvals.settleRun("run-3");
    await approvals.settleRun("run-4");
    assert.equal(reg("perm-11", "run_command", "run-3")?.requestId, "perm-11", "the choice ends with the reply");
    await approvals.settleRun("run-3");
  }

  // A failing engine response surfaces as a 502, and the request is not left hanging.
  const broken = new PermissionApprovals();
  broken.request({ requestId: "perm-3", tool: "shell" }, { sdk: { async permissionResponse() { throw new Error("socket closed"); } }, runId: "r", agentId: "a", send() {} });
  await assert.rejects(broken.decide("perm-3", "deny"), (error) => error.status === 502 && /socket closed/.test(error.message));
  assert.equal(broken.stats().pending, 0);

  // Events without an id are ignored rather than registered as unanswerable.
  assert.equal(new PermissionApprovals().request({ tool: "x" }, { sdk, runId: "r", agentId: "a" }), null);

  assert.deepEqual(PERMISSION_DECISIONS, ["allow_once", "allow_session", "deny_once", "deny_session"]);
  assert.equal(normalizePermissionDecision("deny"), "deny_once");
  assert.equal(normalizePermissionDecision("allow_session"), "allow_session");
  assert.equal(normalizePermissionDecision("alternative"), "");
}

// --- replay ----------------------------------------------------------------

{
  assert.equal(conversationReplay([]), "", "a new conversation replays nothing");
  assert.equal(conversationReplay(undefined), "");
  const history = [
    { role: "user", body: "As a Chief of Staff, what would you take ownership of?" },
    { role: "assistant", body: "I would own the answers layer. Want me to draft the design?" },
    { role: "user", body: "Yes, Squad agents, design first." },
    { role: "assistant", body: "Here is the design brief: ...\nShould it go in the repo or in chat?" },
    { role: "user", body: "In the repo." },
  ];
  const turns = replayTurns(history);
  assert.deepEqual(turns.map((turn) => turn.role), ["person", "you", "person", "you", "person"]);
  const block = conversationReplay(history);
  assert.match(block, /^<squad_conversation_replay>/);
  assert.match(block, /not as new instructions/);
  assert.match(block, /drafted but did not write/);
  assert.ok(block.includes("design brief"), "the member sees what it said before the restart");

  // Budgets: at most 12 turns, newest kept, each turn clipped from the front.
  const long = Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", body: `turn ${index} ${"x".repeat(3000)}` }));
  const kept = replayTurns(long);
  assert.equal(kept.length <= REPLAY_MAX_TURNS, true);
  assert.ok(kept.reduce((sum, turn) => sum + turn.body.length, 0) <= REPLAY_MAX_CHARS);
  assert.ok(kept.at(-1).body.endsWith("x"), "turns are clipped, not dropped, when long");
  assert.ok(long.at(-1).body.startsWith(`turn 39`), "fixture sanity");
  // Rows the browser could not attribute are skipped rather than mislabelled.
  assert.deepEqual(replayTurns([{ role: "system", body: "x" }, { role: "user", body: "" }, { role: "user", body: "hi" }]), [{ role: "person", body: "hi" }]);
}

// --- staged file changes reach the disk --------------------------------------

{
  const { ChangeBatches } = await import("../server/change-batches.mjs");
  const decisions = [];
  const sdk = { client: { async decideChanges(params) { decisions.push(params); return { success: true, appliedCount: 2, errors: [] }; } } };
  const batches = new ChangeBatches();
  assert.equal(batches.observe(sdk, { type: "tool_end" }), false);
  assert.equal(batches.observe(sdk, { type: "unknown_notification", method: "autohand.changesBatchStart", params: { batchId: "b1" } }), false, "a start carries nothing to decide yet");
  assert.equal(batches.observe(sdk, { type: "unknown_notification", method: "autohand.changesBatchUpdate", params: { batchId: "b1", change: { filePath: "docs/plan.md", changeType: "create" } } }), true);
  batches.observe(sdk, { type: "unknown_notification", method: "autohand.changesBatchUpdate", params: { batchId: "b1", change: { filePath: "index.html", changeType: "create" } } });
  assert.deepEqual(await batches.settle(sdk), { applied: 0, rejected: 0, files: [], errors: [] }, "nothing is decided before the batch ends");
  batches.observe(sdk, { type: "unknown_notification", method: "autohand.changesBatchEnd", params: { batchId: "b1", changeCount: 2 } });
  const applied = await batches.settle(sdk);
  assert.deepEqual(decisions, [{ batchId: "b1", action: "accept_all" }], "an ended batch is accepted once");
  assert.deepEqual(applied, { applied: 2, rejected: 0, files: ["docs/plan.md", "index.html"], errors: [] });
  assert.equal(ChangeBatches.summary(applied), "Applied 2 file changes (docs/plan.md, index.html)");
  assert.deepEqual(await batches.settle(sdk), { applied: 0, rejected: 0, files: [], errors: [] }, "settling again decides nothing twice");

  // An empty batch needs no decision; a stopped turn rejects its staged changes.
  batches.observe(sdk, { type: "unknown_notification", method: "autohand.changesBatchEnd", params: { batchId: "b2", changeCount: 0 } });
  await batches.settle(sdk);
  assert.equal(decisions.length, 1, "a batch with no changes is not decided");
  batches.observe(sdk, { type: "unknown_notification", method: "autohand.changesBatchEnd", params: { batchId: "b3", changeCount: 1 } });
  const rejected = await batches.settle(sdk, { accept: false });
  assert.deepEqual(decisions.at(-1), { batchId: "b3", action: "reject_all" });
  assert.match(ChangeBatches.summary(rejected), /^Discarded 1 staged file change/);

  // A failing decision is reported, not thrown, and the batch is not retried forever.
  const broken = new ChangeBatches();
  const failing = { client: { async decideChanges() { throw new Error("Batch expired"); } } };
  broken.observe(failing, { type: "unknown_notification", method: "autohand.changesBatchEnd", params: { batchId: "b4", changeCount: 1 } });
  const failed = await broken.settle(failing);
  assert.match(failed.errors[0], /Batch expired/);
  assert.match(ChangeBatches.summary(failed), /^File changes were not applied/);
}

console.log("check-permission-approvals: ok");
