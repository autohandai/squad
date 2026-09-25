#!/usr/bin/env node
// Checks for member presence and stop (ADR-0016): derivePresence rules,
// the browser-side state mapping, and the stop route driven with a fake
// bridge context (no server, no browser).

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { derivePresence, liveRunsForMember, PRESENCE_STATES } from "../server/members/presence.mjs";
import { handle, stopMember } from "../server/routes/members.route.mjs";
import { PRESENCE_ORDER, presenceDescription, presenceFor, presenceMeta, presenceOrder } from "../src/lib/presence-states.js";

const now = Date.parse("2026-09-26T10:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

// --- derivePresence -------------------------------------------------------

{
  const presence = derivePresence({
    sessions: [
      { agentId: "kai", busy: true, idleMs: 0 },
      { agentId: "iris", busy: false, idleMs: 240_000 },
      { agentId: "noah", busy: false, idleMs: 5_000 },
    ],
    runs: new Map([
      ["r1", { id: "r1", agentId: "noah", status: "running", startedAt: iso(now - 60_000) }],
      ["r2", { id: "r2", agentId: "noah", status: "queued", startedAt: iso(now - 30_000) }],
      ["r3", { id: "r3", agentId: "eva", status: "completed", startedAt: iso(now - 600_000) }],
      ["r4", { id: "r4", agentId: "mia", status: "launching" }],
    ]),
    members: [
      { id: "kai", status: "online" },
      { id: "iris", status: "online" },
      { id: "noah", status: "online" },
      { id: "eva", status: "online", lastActivityAt: iso(now - 3_600_000) },
      { id: "ada", status: "offline" },
      { id: "leo", status: "archived" },
    ],
    now,
  });

  assert.equal(presence.kai.state, "working", "busy session → working");
  assert.equal(presence.kai.activeRuns, 0);
  assert.equal(presence.noah.state, "working", "live run → working even with an idle session");
  assert.equal(presence.noah.activeRuns, 2, "counts queued and running");
  assert.equal(presence.noah.since, iso(now - 60_000), "since = earliest live run start");
  assert.equal(presence.mia.state, "working", "launching run with no snapshot row still gets an entry");
  assert.equal(presence.mia.since, iso(now), "no startedAt falls back to now");
  assert.equal(presence.iris.state, "idle", "warm idle session → idle");
  assert.equal(presence.iris.sessionIdleMs, 240_000);
  assert.equal(presence.iris.since, iso(now - 240_000), "idle since last use");
  assert.equal(presence.eva.state, "online", "completed run and no session → online");
  assert.equal(presence.eva.since, iso(now - 3_600_000), "online since = last activity from the snapshot");
  assert.equal(presence.eva.activeRuns, 0);
  assert.equal(presence.ada.state, "offline");
  assert.equal(presence.leo.state, "offline", "archived counts as offline");
  assert.equal(Object.keys(presence).length, 7);
  for (const entry of Object.values(presence)) assert.ok(PRESENCE_STATES.includes(entry.state), entry.state);
}

{
  // The stored flag wins over a lingering idle session, but not over work.
  const presence = derivePresence({
    sessions: [
      { agentId: "ada", busy: false, idleMs: 1000 },
      { agentId: "leo", busy: true, idleMs: 0 },
    ],
    members: [
      { id: "ada", status: "offline" },
      { id: "leo", status: "offline" },
    ],
    now,
  });
  assert.equal(presence.ada.state, "offline", "offline member with an idle session stays offline");
  assert.equal(presence.leo.state, "working", "a busy session is the truth even for an offline-marked member");
}

{
  const presence = derivePresence({
    sessions: { active: 1, busy: 1, sessions: [{ agentId: "kai", busy: true, idleMs: 0 }] },
    runs: [{ id: "r", agentId: "kai", status: "running" }],
    members: [{ id: "kai", status: "online" }, { id: "iris", status: "online" }],
    bridgeReachable: false,
    now,
  });
  assert.equal(presence.kai.state, "unknown", "bridge unreachable → unknown, whatever the pool says");
  assert.equal(presence.iris.state, "unknown");
  assert.equal(presence.kai.activeRuns, 1, "counts are still reported");
}

assert.deepEqual(derivePresence(), {}, "no input → empty map");
assert.deepEqual(derivePresence({ sessions: [{ busy: true }], runs: [{ status: "running" }] }), {}, "rows without ids are ignored");

{
  const runs = [
    { id: "a", agentId: "kai", status: "running" },
    { id: "b", agentId: "kai", status: "completed" },
    { id: "c", agentId: "iris", status: "queued" },
  ];
  assert.deepEqual(liveRunsForMember(runs, "kai").map((run) => run.id), ["a"]);
  assert.deepEqual(liveRunsForMember(new Map(runs.map((run) => [run.id, run])), " iris ").map((run) => run.id), ["c"]);
}

// --- presence-states (browser side, pure) ---------------------------------

assert.deepEqual(PRESENCE_ORDER, ["working", "online", "idle", "offline", "unknown"]);
assert.ok(presenceOrder("working") < presenceOrder("online") && presenceOrder("online") < presenceOrder("idle"));
assert.equal(presenceOrder("nonsense"), PRESENCE_ORDER.indexOf("unknown"), "unknown state sorts last");

{
  const working = presenceMeta("working");
  assert.equal(working.label, "Working");
  assert.equal(working.pulse, true, "only working pulses");
  assert.match(working.dotClassName, /bg-primary/);
  for (const state of ["online", "idle", "offline", "unknown"]) assert.equal(presenceMeta(state).pulse, false, `${state} does not pulse`);
  assert.match(presenceMeta("offline").dotClassName, /muted-foreground/, "offline is grey");
  assert.match(presenceMeta("unknown").dotClassName, /border-dotted/, "unknown is a dotted ring");
  assert.equal(presenceMeta("unknown").ring, true);
  assert.equal(presenceMeta("idle", { presenceIdle: "Away" }).label, "Away", "labels come from copy");
  assert.equal(presenceMeta("WORKING").state, "working", "state is case-insensitive");
}

{
  const map = { kai: { state: "idle", since: null, activeRuns: 0, sessionIdleMs: 120_000 }, noah: { state: "working", activeRuns: 2 } };
  assert.equal(presenceFor("kai", map).state, "idle");
  assert.equal(presenceFor("kai", map, { bridgeReachable: false }).state, "unknown", "bridge down → unknown even when the map has a value");
  assert.equal(presenceFor("iris", map).state, "online", "not in the map yet → stored status (online)");
  assert.equal(presenceFor("iris", map, { memberStatus: "archived" }).state, "offline", "not in the map, archived → offline");
  assert.equal(presenceFor("iris", null).state, "online", "no map at all still answers");
  assert.equal(presenceFor("noah", map).activeRuns, 2);
  assert.equal(presenceDescription(map.noah), "Working · 2 runs");
  assert.equal(presenceDescription(map.kai), "Idle for 2 min");
  assert.equal(presenceDescription({ state: "online" }), "Online");
  assert.match(presenceDescription({ state: "unknown" }), /not reachable/);
}

// --- route: GET presence and POST stop with a fake bridge context ---------

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 0; // no process group; falls back to child.kill
  child.exitCode = null;
  child.signalCode = null;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    child.signalCode = signal;
    child.emit("close");
    return true;
  };
  return child;
}

function fakeCtx(stateDir) {
  const events = [];
  const resets = [];
  const runs = new Map();
  const child = fakeChild();
  const sdk = { interrupted: false, closed: false, async interrupt() { this.interrupted = true; }, async close() { this.closed = true; } };
  runs.set("r1", { id: "r1", agentId: "kai", title: "Fix CI", workspace: "/w", status: "running", startedAt: iso(now), finishedAt: null, logs: [], process: child, abortController: new AbortController() });
  runs.set("r2", { id: "r2", agentId: "kai", title: "Docs", status: "queued", startedAt: iso(now), finishedAt: null, logs: [], sdk });
  runs.set("r3", { id: "r3", agentId: "kai", title: "Old", status: "completed", finishedAt: iso(now), logs: [] });
  runs.set("r4", { id: "r4", agentId: "iris", title: "Other", status: "running", finishedAt: null, logs: [], abortController: new AbortController() });
  return {
    ctx: {
      squadStateDir: stateDir,
      readOptionalJsonFile: async (path) => {
        try {
          const { readFile } = await import("node:fs/promises");
          return JSON.parse(await readFile(path, "utf8"));
        } catch {
          return null;
        }
      },
      runs,
      sdkSessions: {
        stats: () => ({ active: 2, busy: 1, sessions: [{ agentId: "kai", busy: true, idleMs: 0 }, { agentId: "iris", busy: false, idleMs: 9000 }] }),
        reset: async (agentId, reason) => {
          resets.push({ agentId, reason });
          return agentId === "kai" ? 1 : 0;
        },
      },
      emit: (name, payload) => events.push({ name, ...payload }),
      logEvent: () => {},
      SEVERITY: { INFO: 9 },
      json: (res, status, payload) => {
        res.status = status;
        res.payload = payload;
      },
    },
    events,
    resets,
    runs,
    child,
    sdk,
  };
}

const stateDir = await mkdtemp(join(tmpdir(), "members-presence-"));
try {
  await writeFile(
    join(stateDir, "web-status.json"),
    JSON.stringify({ members: [{ id: "kai", status: "online" }, { id: "iris", status: "online" }, { id: "ada", status: "offline" }] })
  );
  const fake = fakeCtx(stateDir);

  const res = {};
  assert.equal(await handle({ method: "GET" }, res, new URL("http://x/api/members/presence"), fake.ctx), true);
  assert.equal(res.status, 200);
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.data.presence.kai.state, "working");
  assert.equal(res.payload.data.presence.kai.activeRuns, 2);
  assert.equal(res.payload.data.presence.iris.state, "working", "iris has a live run r4");
  assert.equal(res.payload.data.presence.ada.state, "offline", "snapshot members without sessions are listed");
  assert.deepEqual(res.payload.data.sessions, { active: 2, busy: 1 });

  assert.equal(await handle({ method: "GET" }, {}, new URL("http://x/api/members/kai"), fake.ctx), false, "unrelated paths are not ours");
  assert.equal(await handle({ method: "GET" }, {}, new URL("http://x/api/members/kai/stop"), fake.ctx), false, "stop is POST only");

  const stopRes = {};
  const started = Date.now();
  assert.equal(await handle({ method: "POST" }, stopRes, new URL("http://x/api/members/kai/stop"), fake.ctx), true);
  assert.ok(Date.now() - started < 2000, "stop answers within two seconds");
  assert.equal(stopRes.status, 200);
  assert.deepEqual(stopRes.payload.data, { memberId: "kai", closedSessions: 1, stoppedRuns: 2, runIds: ["r1", "r2"] });
  assert.deepEqual(fake.resets, [{ agentId: "kai", reason: "stopped by user" }]);
  assert.equal(fake.runs.get("r1").status, "stopped");
  assert.ok(fake.runs.get("r1").finishedAt, "finishedAt set");
  assert.ok(fake.runs.get("r1").abortController.signal.aborted, "abort controller aborted");
  assert.deepEqual(fake.child.signals, ["SIGTERM"], "child received SIGTERM");
  assert.equal(fake.runs.get("r1").logs.at(-1).line, "stopped by user");
  assert.equal(fake.runs.get("r2").status, "stopped");
  assert.equal(fake.sdk.interrupted, true, "SDK run interrupted");
  assert.equal(fake.sdk.closed, true, "SDK run closed");
  assert.equal(fake.runs.get("r2").sdk, null);
  assert.equal(fake.runs.get("r3").status, "completed", "finished runs untouched");
  assert.equal(fake.runs.get("r4").status, "running", "other members' runs untouched");
  assert.equal(fake.runs.get("r4").abortController.signal.aborted, false);
  assert.deepEqual(
    fake.events.map((event) => [event.name, event.memberId]),
    [["run.finished", "kai"], ["run.finished", "kai"], ["member.stopped", "kai"]]
  );
  assert.deepEqual(fake.events.at(-1), { name: "member.stopped", memberId: "kai", closedSessions: 1, stoppedRuns: 2 });
  assert.equal(fake.events[0].status, "stopped");

  // After stop the next presence read no longer counts kai as working
  // (the fake pool still reports the session; a real pool has closed it).
  const after = {};
  fake.ctx.sdkSessions.stats = () => ({ active: 0, busy: 0, sessions: [] });
  await handle({ method: "GET" }, after, new URL("http://x/api/members/presence"), fake.ctx);
  assert.equal(after.payload.data.presence.kai.state, "online", "stopped member with no session → online");

  // Stopping a member nothing is running for is a no-op that still answers.
  const idle = await stopMember(fake.ctx, "ada");
  assert.deepEqual(idle, { memberId: "ada", closedSessions: 0, stoppedRuns: 0, runIds: [] });

  // A pool that hangs does not hold the response past the budget.
  fake.ctx.sdkSessions.reset = () => new Promise(() => {});
  const slowStart = Date.now();
  const slow = await stopMember(fake.ctx, "iris");
  assert.ok(Date.now() - slowStart < 2000, "hung pool still answers within two seconds");
  assert.equal(slow.closedSessions, 0);
  assert.equal(slow.stoppedRuns, 1, "iris's run r4 stopped");

  // No pool at all (bridge without the SDK) still stops runs.
  const bare = fakeCtx(stateDir);
  bare.ctx.sdkSessions = null;
  const bareRes = {};
  await handle({ method: "POST" }, bareRes, new URL("http://x/api/members/kai/stop"), bare.ctx);
  assert.equal(bareRes.payload.data.stoppedRuns, 2);
  assert.equal(bareRes.payload.data.closedSessions, 0);

  const empty = {};
  await handle({ method: "POST" }, empty, new URL("http://x/api/members/%20/stop"), bare.ctx);
  assert.equal(empty.status, 400, "blank id is rejected");
} finally {
  await rm(stateDir, { recursive: true, force: true });
}

console.log("members presence checks passed");
