#!/usr/bin/env node
// Export conversation (ADR-0161 §3.2): the record and the Markdown carry the
// turns, tools, permission decisions and written files. Deterministic.
import assert from "node:assert/strict";

import { conversationFileName, conversationMarkdown, conversationRecord } from "../src/lib/conversation-export.js";
import { savedChatTranscript } from "../server/team/service.mjs";

const agent = { id: "cos", name: "Chief of Staff", role: "Chief of Staff", workspace: "/tmp/pie-shop" };
const messages = [
  { id: "u1", role: "user", body: "Write the plan.", status: "complete", time: "20:06" },
  { id: "a1", role: "agent", body: "Done. Created docs/plan.md.", status: "complete", completedAt: "2026-11-02T07:17:16.000Z", durationMs: 9100, effectiveModel: { model: "fantail" },
    trace: { toolCalls: [{ name: "write_file" }, { name: "write_file" }] },
    streamEvents: [
      { type: "tool_start", tool: { name: "write_file" } },
      { type: "permission_request", requestId: "p1", tool: "write_file" },
      { type: "permission_resolved", requestId: "p1", tool: "write_file", decision: "allow_once", source: "person" },
      { type: "status", status: "changes_applied", files: ["docs/plan.md"] },
    ] },
  { id: "a0", role: "agent", body: "old draft", status: "complete", superseded: true },
];
const record = conversationRecord(agent, messages, { exportedAt: "2026-11-02T07:20:00.000Z" });
assert.equal(record.messages.length, 2, "superseded messages stay out");
assert.deepEqual(record.messages[1].tools, ["write_file"]);
assert.deepEqual(record.messages[1].approvals, [{ tool: "write_file", decision: "allow_once", source: "person" }]);
assert.deepEqual(record.messages[1].filesApplied, ["docs/plan.md"]);
assert.equal(record.workspace, "/tmp/pie-shop");
const markdown = conversationMarkdown(record);
assert.match(markdown, /^# Conversation with Chief of Staff \(Chief of Staff\)/);
assert.match(markdown, /## You · 20:06\n\nWrite the plan\./);
assert.match(markdown, /> Tools: write_file/);
assert.match(markdown, /> Permissions: write_file allow_once/);
assert.match(markdown, /> Files written: docs\/plan\.md/);
assert.equal(conversationFileName(record, "md"), "squad-conversation-chief-of-staff-2026-11-02-07-20.md");

// squad_read_chat reads a saved chat with the same facts.
const saved = savedChatTranscript({ id: "chat-1", title: "Plan", startedAt: "s", endedAt: "e", messages: [
  { role: "user", body: "Write the plan." },
  { role: "agent", body: "x".repeat(3000), trace: { toolCalls: [{ name: "write_file" }] } },
  { role: "system", body: "ignored" },
] });
assert.equal(saved.turns.length, 2);
assert.equal(saved.turns[0].role, "person");
assert.ok(saved.turns[1].text.endsWith("…") && saved.turns[1].text.length === 2400, "long turns are clipped");
assert.deepEqual(saved.turns[1].tools, ["write_file"]);
assert.equal(savedChatTranscript(null), null);

console.log("check-conversation-export: ok");
