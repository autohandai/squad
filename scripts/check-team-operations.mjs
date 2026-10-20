#!/usr/bin/env node
// Persisted service and transport contracts. No provider or running app is used.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createTeamService } from "../server/team/service.mjs";
import { createTeamStore, TEAM_MEMORY_LIMIT } from "../server/team/store.mjs";
import { runTeamProxy } from "../server/team/mcp-server.mjs";
import { mergeMemberProfile, profileReceipts } from "../src/lib/member-shaping.js";

const directory = await mkdtemp(join(tmpdir(), "squad-team-operations-"));
let team;
try {
  const stale = { id: "a", name: "Eva", role: "QA", profileRevision: 1, harness: { id: "codex" } };
  const saved = { id: "a", name: "Viggas", role: "Release QA", description: "Owns releases.", profileRevision: 2, harness: { id: "claude" } };
  assert.deepEqual(mergeMemberProfile(stale, saved), { ...stale, name: "Viggas", role: "Release QA", description: "Owns releases.", profileRevision: 2 }, "canonical profile fields converge without overwriting engine configuration");
  assert.equal(mergeMemberProfile(saved, stale).name, "Viggas");
  assert.equal(profileReceipts([{ type: "profile", status: "failed", patch: { name: "Wrong" } }]).length, 0);
  const members = [{ id: "a", name: "Alex" }, { id: "b", name: "Blair" }, { id: "c", name: "Casey" }];
  let active = 0, peak = 0, deliveries = 0;
  const events = [];
  team = createTeamService({
    stateDir: directory, rootDir: process.cwd(), bridgeUrl: "http://127.0.0.1:12345",
    members: async () => members, isBusy: async () => false,
    deliver: async ({ message }) => {
      active++; peak = Math.max(peak, active); deliveries++;
      await new Promise(resolve => setTimeout(resolve, 10));
      active--; return { reply: message === "no text" ? "" : `Answer: ${message}` };
    },
    emit: (name, detail) => events.push({ name, detail }),
  });
  let sequence = 0;
  const open = async (memberId, workspace = "/workspace/one", runId = `run-${memberId}`) => {
    const work = await team.openWork({ memberId, workspace, runId });
    return { ...work, token: work.mcpServer.env.AUTOHAND_SQUAD_TEAM_TOKEN };
  };
  const call = (work, name, args = {}) => team.dispatch(work.token, { jsonrpc: "2.0", id: ++sequence, method: "tools/call", params: { name, arguments: args } });
  const a = await open("a"), b = await open("b");
  const shared = (await call(a, "squad_remember", { text: "Use NZ English." })).structuredContent;
  const personal = (await call(a, "squad_remember", { text: "I own typography.", scope: "me" })).structuredContent;
  const project = (await call(a, "squad_remember", { text: "The release branch is release/one.", scope: "project" })).structuredContent;
  assert.equal((await call(a, "squad_remember", { text: "use nz English!" })).structuredContent.alreadyKnown, true);
  let recall = (await call(b, "squad_recall")).structuredContent.memories;
  assert.deepEqual(new Set(recall.map(memory => memory.id)), new Set([shared.id, project.id]), "same-project teammates see team/project memory, never another member's personal entries");
  const otherProject = await open("c", "/workspace/two");
  recall = (await call(otherProject, "squad_recall")).structuredContent.memories;
  assert.deepEqual(recall.map(memory => memory.id), [shared.id]);
  assert.equal((await call(b, "squad_update_memory", { id: shared.id, text: "Use US English." })).isError, true);
  assert.equal((await call(b, "squad_forget", { id: personal.id })).isError, true);
  assert.equal((await call(a, "squad_update_memory", { id: shared.id, text: "Use concise NZ English." })).structuredContent.updated, shared.id);
  await team.updateMemory(shared.id, "Write clear NZ English.");
  assert.equal((await call(b, "squad_recall", { query: "clear nz" })).structuredContent.memories[0].text, "Write clear NZ English.");
  for (const args of [{ text: "x", scope: "someone-else" }, { text: "x", authorId: "b" }, { text: 42 }, { text: "password: fixture-password" }]) assert.equal((await call(a, "squad_remember", args)).isError, true);
  assert.equal((await call(a, "squad_message", { to: "Blair", message: "x", wait_seconds: "5" })).isError, true);
  assert.equal((await call(a, "squad_team", { memberId: "b" })).isError, true);
  assert.equal((await call(a, "squad_channel_messages", { channel_id: "x", limit: 101 })).isError, true);

  const request = { to: "Blair", message: "Review typography", wait_seconds: 0, request_id: "review-once" };
  const [first, duplicate] = await Promise.all([call(a, "squad_message", request), call(a, "squad_message", request)]);
  assert.equal(first.structuredContent.deliveryId, duplicate.structuredContent.deliveryId);
  await Promise.all([call(a, "squad_message", { to: "Blair", message: "Review spacing", wait_seconds: 1 }), call(otherProject, "squad_message", { to: "Blair", message: "Review contrast", wait_seconds: 1 })]);
  assert.equal(deliveries, 3, "a retry dispatches no duplicate work");
  assert.equal(peak, 1, "concurrent senders are serialized at the recipient");
  assert.equal((await call(a, "squad_message", { ...request, message: "Different content" })).isError, true);
  const empty = await call(a, "squad_message", { to: "Blair", message: "no text", wait_seconds: 1 });
  assert.equal(empty.structuredContent.status, "completed without reply text");
  const collected = await Promise.all([call(a, "squad_replies"), call(a, "squad_replies")]);
  const late = collected.flatMap(result => result.structuredContent.replies);
  assert.equal(late.filter(reply => reply.status === "replied" && reply.reply === "Answer: Review typography").length, 1, "concurrent collectors acknowledge the late reply once");
  assert.equal((await call(a, "squad_replies")).structuredContent.replies.length, 0, "late replies are acknowledged once");
  assert.ok(events.some(event => event.name === "team.message.finished"));
  team.finishWork(a.runId);
  await assert.rejects(() => call(a, "squad_remember", { text: "No active turn." }), /no active Squad turn/);
  const resumed = await open("a", "/workspace/one", "next-run-a");
  assert.equal(resumed.token, a.token, "a stable credential preserves warm engine sessions");
  assert.match(resumed.instructions, /Write clear NZ English/);
  team.closeMember("a");
  await assert.rejects(() => call(resumed, "squad_team"), /expired/);
  members[1].removed = true;
  await assert.rejects(() => call(b, "squad_team"), /no longer available/);

  const store = createTeamStore({ stateDir: join(directory, "limits") });
  await Promise.all(Array.from({ length: TEAM_MEMORY_LIMIT }, (_, index) => store.remember({ text: `Fact ${index}`, authorId: "a" })));
  await assert.rejects(() => store.remember({ text: "Overflow fact", authorId: "a" }), /memory is full/);
  assert.equal((await store.read()).memory.length, TEAM_MEMORY_LIMIT, "full memory refuses insertion without silently dropping a fact");
  const pending = await store.addDelivery({ fromId: "a", toId: "b", message: "Pending work", requestId: "pending" });
  assert.equal(await store.recover(), 1);
  assert.equal((await store.read()).deliveries.find(item => item.id === pending.id).status, "interrupted");
  assert.equal(await store.recover(), 0);

  // Both engine framings, fragmented UTF-8 input, and concurrent calls. A slow
  // teammate wait must not block the directory request that follows it.
  const input = new PassThrough(), output = new PassThrough();
  let bytes = Buffer.alloc(0), releaseSlow, fastDone;
  output.on("data", chunk => { bytes = Buffer.concat([bytes, chunk]); });
  const slow = new Promise(resolve => { releaseSlow = resolve; });
  const fast = new Promise(resolve => { fastDone = resolve; });
  const proxy = runTeamProxy({ input, output, url: "http://127.0.0.1:12345/api/team/mcp", token: "fixture", fetchRequest: async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.id === 1) await slow;
    else fastDone();
    return { ok: true, json: async () => ({ success: true, data: { id: request.id, text: "Kia ora 🥝" } }) };
  } });
  const firstFrame = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "squad_message" } }));
  const secondFrame = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
  const wire = Buffer.concat([firstFrame, Buffer.from("\nContent-Length: " + secondFrame.length + "\r\n\r\n"), secondFrame]);
  for (let offset = 0; offset < wire.length; offset += 7) input.write(wire.subarray(offset, offset + 7));
  await fast;
  await new Promise(resolve => setImmediate(resolve));
  assert.match(bytes.toString(), /^Content-Length:/, "the fast second call is answered before the waiting first call");
  releaseSlow(); input.end(); await proxy;
  const headerEnd = bytes.indexOf("\r\n\r\n");
  const size = Number(/Content-Length: (\d+)/.exec(bytes.subarray(0, headerEnd).toString())[1]);
  assert.equal(JSON.parse(bytes.subarray(headerEnd + 4, headerEnd + 4 + size)).result.text, "Kia ora 🥝");
  assert.equal(JSON.parse(bytes.subarray(headerEnd + 4 + size).toString()).id, 1);
  await assert.rejects(() => runTeamProxy({ url: "https://example.test/api/team/mcp", token: "fixture" }), /local Squad team session/);
  console.log("Team operation checks passed: scoped CRUD, permissions, strict schemas, deduplication, serialized delivery, empty answers, lifecycle, capacity, restart recovery and both concurrent MCP framings.");
} finally {
  team?.close();
  await rm(directory, { recursive: true, force: true });
}
