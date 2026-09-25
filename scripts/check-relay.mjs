#!/usr/bin/env node
// Deterministic checks for the self-hosted relay (ADR-0026): the WebSocket
// framer, the relay REST/stream surface, two bridge clients syncing through
// it, last-writer-wins on conflicting edits, presence, and offline mode.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FrameParser, encodeFrame } from "../relay/ws.mjs";
import { startRelay, parseTokens } from "../relay/server.mjs";
import { createRelaySync, mergeChannelsState } from "../server/relay/sync.mjs";
import {
  buildWorkspaceList,
  currentWorkspace,
  memberOwnership,
  ownershipLabel,
  peopleSentence,
  relayStatusSentence,
  selectWorkspace,
} from "../src/lib/workspaces.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, { timeoutMs = 1000, label = "condition" } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
    await sleep(15);
  }
}

// --- WebSocket framing -----------------------------------------------------
{
  const frames = [];
  const parser = new FrameParser((frame) => frames.push(frame));
  const small = encodeFrame({ opcode: 1, payload: "hi", mask: true });
  const medium = encodeFrame({ opcode: 1, payload: "x".repeat(300), mask: false });
  const large = encodeFrame({ opcode: 2, payload: Buffer.alloc(70_000, 7), mask: true });
  const all = Buffer.concat([small, medium, large]);
  // Feed in awkward chunks to exercise buffering.
  for (let i = 0; i < all.length; i += 1000) parser.feed(all.subarray(i, i + 1000));
  assert.equal(frames.length, 3, "three frames decoded");
  assert.equal(frames[0].payload.toString(), "hi");
  assert.equal(frames[1].payload.length, 300);
  assert.equal(frames[2].payload.length, 70_000);
  assert.ok(frames[2].payload.every((byte) => byte === 7), "masked large payload round-trips");
}

// --- Token parsing ---------------------------------------------------------
{
  const people = parseTokens("igor:tok-a, noah:tok-b,bare-token");
  assert.equal(people.get("tok-a").name, "igor");
  assert.equal(people.get("tok-b").id, "noah");
  assert.ok(people.get("bare-token").id.startsWith("person-"));
}

// --- Pure merge ------------------------------------------------------------
{
  const local = { channels: [{ id: "c1", name: "general", updatedAt: "2026-01-01T00:00:00.000Z" }], threads: [], messages: [{ id: "m1", channelId: "c1", body: "old", updatedAt: "2026-01-01T00:00:01.000Z" }] };
  const { state, changed } = mergeChannelsState(local, {
    channels: [{ id: "c1", name: "general-renamed", updatedAt: "2026-01-01T00:00:05.000Z" }],
    messages: [
      { id: "m1", channelId: "c1", body: "older", updatedAt: "2026-01-01T00:00:00.500Z" },
      { id: "m2", channelId: "c1", body: "new", updatedAt: "2026-01-01T00:00:02.000Z" },
      { id: "m3", channelId: "missing", body: "dropped", updatedAt: "2026-01-01T00:00:02.000Z" },
    ],
  });
  assert.equal(state.channels[0].name, "general-renamed");
  assert.equal(state.messages.find((m) => m.id === "m1").body, "old", "older remote edit loses");
  assert.equal(state.messages.length, 2, "message for unknown channel is dropped");
  assert.deepEqual(changed.messages.map((m) => m.id), ["m2"]);
}

// --- Fake bridge context (channels.json in a temp state dir) --------------
async function fakeCtx(name) {
  const squadStateDir = await mkdtemp(join(tmpdir(), `squad-${name}-`));
  const file = join(squadStateDir, "channels.json");
  const events = new EventEmitter();
  const ctx = {
    squadStateDir,
    events,
    emitted: [],
    emit(eventName, payload) {
      const event = { name: eventName, at: new Date().toISOString(), ...payload };
      ctx.emitted.push(event);
      events.emit(eventName, event);
      return event;
    },
    getRuntime: () => ({ account: { name: name === "a" ? "Igor" : "Noah" } }),
    async readChannelsState() {
      try {
        const raw = JSON.parse(await readFile(file, "utf8"));
        return { version: 1, channels: raw.channels || [], threads: raw.threads || [], messages: raw.messages || [] };
      } catch {
        return { version: 1, channels: [], threads: [], messages: [] };
      }
    },
    async writeChannelsState(state) {
      // Mirror server.mjs: messages whose channel is unknown are dropped.
      const known = new Set((state.channels || []).map((c) => c.id));
      const next = { version: 1, channels: state.channels || [], threads: state.threads || [], messages: (state.messages || []).filter((m) => known.has(m.channelId)) };
      await mkdir(squadStateDir, { recursive: true });
      await writeFile(file, JSON.stringify(next, null, 2));
      return next;
    },
    async cleanup() {
      await rm(squadStateDir, { recursive: true, force: true });
    },
  };
  return ctx;
}

const dataDir = await mkdtemp(join(tmpdir(), "relay-data-"));
const relay = await startRelay({ port: 0, dataDir, tokens: "igor:tok-igor,noah:tok-noah" });
const ctxA = await fakeCtx("a");
const ctxB = await fakeCtx("b");
const syncA = createRelaySync(ctxA, { heartbeatMs: 200 });
const syncB = createRelaySync(ctxB, { heartbeatMs: 200 });

try {
  // Unauthorised REST and stream requests are refused.
  const denied = await fetch(`${relay.url}/v1/workspaces/team/channels`);
  assert.equal(denied.status, 401);
  const badWorkspace = await fetch(`${relay.url}/v1/workspaces/Bad%20Name/channels`, { headers: { Authorization: "Bearer tok-igor" } });
  assert.equal(badWorkspace.status, 400);

  syncA.connect({ url: relay.url, token: "tok-igor", workspace: "team" });
  syncB.connect({ url: relay.url, token: "tok-noah", workspace: "team" });
  await waitFor(() => syncA.status().connected && syncB.status().connected, { label: "both clients connected" });

  // Presence: both people are visible to each other.
  await waitFor(() => syncA.status().peers.length === 2 && syncB.status().peers.length === 2, { label: "presence for two people" });
  assert.deepEqual(syncA.status().peers.map((p) => p.name).sort(), ["igor", "noah"]);
  assert.equal(syncA.status().self.name, "igor");

  // A creates a channel and a message locally, then pushes (what the
  // integrator does after every channels.json write).
  const t0 = "2026-09-26T10:00:00.000Z";
  await ctxA.writeChannelsState({
    channels: [{ id: "c-general", name: "general", memberIds: ["iris"], createdAt: t0, updatedAt: t0 }],
    threads: [],
    messages: [{ id: "m-1", channelId: "c-general", role: "user", body: "hello from Igor", createdAt: t0, updatedAt: t0 }],
  });
  const started = Date.now();
  await syncA.push();
  const arrived = await waitFor(async () => (await ctxB.readChannelsState()).messages.find((m) => m.id === "m-1"), { timeoutMs: 1000, label: "message on B" });
  assert.ok(Date.now() - started < 1000, "message reached the other bridge within a second");
  assert.equal(arrived.body, "hello from Igor");
  assert.equal(arrived.origin.personName, "Igor", "origin is stamped by the sender");
  assert.equal(typeof arrived.origin.host, "string");
  const stateB = await ctxB.readChannelsState();
  assert.equal(stateB.channels[0].name, "general", "channel arrived with the message");
  const inbound = ctxB.emitted.find((e) => e.name === "relay.message");
  assert.ok(inbound, "relay.message emitted on B");
  assert.equal(inbound.messageId, "m-1");
  assert.equal(inbound.workspace, "team");
  assert.ok(ctxB.emitted.some((e) => e.name === "relay.channel"), "relay.channel emitted on B");
  assert.ok(!ctxA.emitted.some((e) => e.name === "relay.message" && e.messageId === "m-1"), "the sender does not re-emit its own message");

  // B replies (a member reply that runs on Noah's machine); A receives it.
  const t1 = "2026-09-26T10:00:05.000Z";
  const stateB2 = await ctxB.readChannelsState();
  stateB2.messages.push({ id: "m-2", channelId: "c-general", role: "agent", agentId: "iris", body: "hi Igor", createdAt: t1, updatedAt: t1 });
  await ctxB.writeChannelsState(stateB2);
  await syncB.push();
  const reply = await waitFor(async () => (await ctxA.readChannelsState()).messages.find((m) => m.id === "m-2"), { label: "reply on A" });
  assert.equal(reply.origin.personName, "Noah");

  // Conflict: both edit m-1; the later updatedAt wins everywhere.
  const older = "2026-09-26T10:01:00.000Z";
  const newer = "2026-09-26T10:01:01.000Z";
  const editA = await ctxA.readChannelsState();
  editA.messages = editA.messages.map((m) => (m.id === "m-1" ? { ...m, body: "edited by Igor", updatedAt: newer } : m));
  await ctxA.writeChannelsState(editA);
  const editB = await ctxB.readChannelsState();
  editB.messages = editB.messages.map((m) => (m.id === "m-1" ? { ...m, body: "edited by Noah", updatedAt: older } : m));
  await ctxB.writeChannelsState(editB);
  await Promise.all([syncB.push(), syncA.push()]);
  await waitFor(async () => (await ctxB.readChannelsState()).messages.find((m) => m.id === "m-1")?.body === "edited by Igor", { label: "LWW on B" });
  assert.equal((await ctxA.readChannelsState()).messages.find((m) => m.id === "m-1").body, "edited by Igor", "A keeps the newer edit");
  const stored = await (await fetch(`${relay.url}/v1/workspaces/team/channels/c-general/messages`, { headers: { Authorization: "Bearer tok-igor" } })).json();
  assert.equal(stored.data.messages.find((m) => m.id === "m-1").body, "edited by Igor", "relay keeps the newer edit");

  // A full-snapshot write that forgot a remote message is reconciled on push.
  const snapshot = await ctxB.readChannelsState();
  snapshot.messages = snapshot.messages.filter((m) => m.id !== "m-1");
  await ctxB.writeChannelsState(snapshot);
  await syncB.push();
  assert.ok((await ctxB.readChannelsState()).messages.some((m) => m.id === "m-1"), "relay-known message restored after a stale snapshot");

  // Pull with a cursor: a late joiner gets everything since its cursor.
  const ctxC = await fakeCtx("c");
  const syncC = createRelaySync(ctxC, { heartbeatMs: 200 });
  syncC.connect({ url: relay.url, token: "tok-noah", workspace: "team" });
  await waitFor(async () => (await ctxC.readChannelsState()).messages.length === 2, { label: "late joiner catch-up" });
  syncC.close();
  await ctxC.cleanup();

  // Loading placeholders are not pushed.
  const t2 = "2026-09-26T10:02:00.000Z";
  const withLoading = await ctxA.readChannelsState();
  withLoading.messages.push({ id: "m-loading", channelId: "c-general", role: "agent", agentId: "iris", status: "loading", body: "", createdAt: t2, updatedAt: t2 });
  await ctxA.writeChannelsState(withLoading);
  const pushed = await syncA.push();
  assert.equal(pushed.messages, 0, "loading placeholders stay local");

  assert.equal(relay.presence("team").length, 2, "relay-side presence lists both people");
} finally {
  syncA.close();
  syncB.close();
}

// Reconnect: stop the relay, restart it on the same port, expect the client back.
{
  const port = relay.port;
  const ctxR = await fakeCtx("r");
  const syncR = createRelaySync(ctxR, { heartbeatMs: 200 });
  syncR.connect({ url: relay.url, token: "tok-igor", workspace: "team" });
  await waitFor(() => syncR.status().connected, { label: "reconnect client connected" });
  await relay.close();
  await waitFor(() => !syncR.status().connected, { label: "client noticed the drop" });
  assert.ok(syncR.status().reconnectAttempt >= 1, "a reconnect is scheduled");
  const relay2 = await startRelay({ port, dataDir, tokens: "igor:tok-igor,noah:tok-noah" });
  await waitFor(() => syncR.status().connected, { timeoutMs: 4000, label: "client reconnected" });
  assert.equal(syncR.status().reconnectAttempt, 0);
  assert.equal((await ctxR.readChannelsState()).messages.length, 2, "state survived the relay restart (JSON store)");
  syncR.close();
  await relay2.close();
  await ctxR.cleanup();
}

// Offline: no relay configured, everything is a calm no-op.
{
  const ctxO = await fakeCtx("o");
  const syncO = createRelaySync(ctxO);
  syncO.configure({ url: "", token: "", workspace: "", enabled: false });
  assert.deepEqual(await syncO.push(), { channels: 0, messages: 0 });
  assert.deepEqual(await syncO.pull(), { channels: [], messages: [] });
  const status = syncO.status();
  assert.equal(status.configured, false);
  assert.equal(status.connected, false);
  assert.deepEqual(status.peers, []);
  await ctxO.writeChannelsState({ channels: [{ id: "c", name: "local only", updatedAt: "2026-01-01T00:00:00.000Z" }], threads: [], messages: [] });
  assert.equal((await ctxO.readChannelsState()).channels[0].name, "local only", "local channels work without a relay");
  assert.throws(() => syncO.connect({ url: "http://x", token: "", workspace: "t" }), /needs url, token and workspace/);
  syncO.close();
  await ctxO.cleanup();
}

// Pure workspace model.
{
  const relayConfig = { url: "https://relay.example.com", workspace: "team", enabled: true };
  const list = buildWorkspaceList({ relayConfig, relayStatus: { connected: true, peers: [{ id: "igor", name: "Igor" }, { id: "noah", name: "Noah" }] }, hostName: "Igors-MacBook.local" });
  assert.equal(list.length, 2);
  assert.equal(list[0].id, "local");
  assert.equal(list[0].detail, "Only on Igors-MacBook");
  assert.equal(list[1].id, "relay:team@relay.example.com");
  assert.equal(list[1].detail, "2 people here");
  assert.equal(buildWorkspaceList({ relayConfig: { ...relayConfig, enabled: false }, relayStatus: {} })[1].detail, "Relay off");
  assert.equal(buildWorkspaceList({ relayConfig, relayStatus: { connected: false, lastError: "ECONNREFUSED" } })[1].detail, "Reconnecting…");
  assert.equal(buildWorkspaceList({ relayConfig: {} }).length, 1);

  let state = { selectedId: "local" };
  state = selectWorkspace(state, list, list[1].id);
  assert.equal(currentWorkspace(list, state.selectedId).kind, "relay");
  assert.equal(selectWorkspace(state, list, "nope"), state, "unknown ids are ignored");
  const disabledList = buildWorkspaceList({ relayConfig: { ...relayConfig, enabled: false }, relayStatus: {} });
  assert.equal(currentWorkspace(disabledList, state.selectedId).kind, "local", "a disabled relay falls back to local");

  const messages = [
    { id: "1", agentId: "iris", role: "agent", updatedAt: "2026-01-01T00:00:01.000Z", origin: { personName: "Noah Smith", host: "Noahs-MacBook" } },
    { id: "2", agentId: "iris", role: "agent", updatedAt: "2026-01-01T00:00:00.000Z", origin: { personName: "Igor", host: "Igors-MacBook" } },
    { id: "3", agentId: "kai", role: "agent", updatedAt: "2026-01-01T00:00:00.000Z", origin: { personName: "Igor", host: "Igors-MacBook" } },
  ];
  const self = { name: "Igor", host: "Igors-MacBook.local" };
  const iris = memberOwnership("iris", messages, self);
  assert.equal(iris.isLocal, false);
  assert.equal(ownershipLabel(iris), "Runs on Noah’s Mac");
  assert.equal(ownershipLabel(memberOwnership("kai", messages, self)), "Runs here");
  assert.equal(ownershipLabel(memberOwnership("new", messages, self)), "Runs here");
  assert.equal(ownershipLabel({ ownerName: "Ana", host: "build-box", isLocal: false }), "Runs on Ana’s build-box");

  assert.equal(peopleSentence([{ id: "igor", name: "Igor" }], { id: "igor" }), "");
  assert.equal(peopleSentence([{ id: "igor", name: "Igor" }, { id: "noah", name: "Noah" }], { id: "igor" }), "Noah is here");
  assert.equal(peopleSentence([{ id: "a", name: "Ana" }, { id: "b", name: "Bo" }, { id: "c", name: "Cy" }, { id: "d", name: "Di" }], { id: "x" }), "Ana, Bo and 2 others are here");

  assert.equal(relayStatusSentence({}, { enabled: false }), "Relay off. Channels stay on this machine.");
  assert.equal(relayStatusSentence({ configured: false }, { enabled: true }), "Add a relay URL, a token and a workspace to connect.");
  assert.equal(relayStatusSentence({ configured: true, connected: false, lastError: "unauthorized" }, { enabled: true, url: "https://relay.example.com" }), "Reconnecting to relay.example.com (unauthorized)…");
  const now = Date.parse("2026-09-26T10:00:30.000Z");
  assert.equal(
    relayStatusSentence({ configured: true, connected: true, self: { name: "Igor" }, peers: [{ id: "a" }, { id: "b" }], lastSync: "2026-09-26T10:00:25.000Z" }, { enabled: true, url: "https://relay.example.com/" }, {}, now),
    "Connected to relay.example.com as Igor: 2 people online, synced just now."
  );
}

await ctxA.cleanup();
await ctxB.cleanup();
await rm(dataDir, { recursive: true, force: true });
console.log("relay checks passed: framer, auth, LWW merge, two-bridge sync under 1 s, conflicts, presence, reconnect, offline, workspace model.");
