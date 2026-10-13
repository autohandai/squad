#!/usr/bin/env node
// Checks for member routines (ADR-0110).
//
// Part one: next-occurrence arithmetic in server/routines/schedule.mjs across
// every kind, including Last day, the 31st in a 30-day month, a DST change in
// Europe/London and America/New_York, and interval alignment.
//
// Part two: a real bridge in an isolated state dir with a controlled member
// adapter and the scheduler clock pinned to 09:00:50 UTC. A routine fires at
// 09:01 on the bridge, a second occurrence is skipped while the first is
// still active, the run limit stops a stuck run, a routine for a member the
// bridge does not know waits as an app dispatch, a schedule proposal from a
// member reply becomes a pending confirmation that only Confirm turns into a
// routine, and routines and their history survive a restart.

import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { startBridge, until } from "./lib/reliability-browser.mjs";
import {
  describeSchedule,
  formatOccurrence,
  nextOccurrence,
  nextOccurrences,
  normalizeSchedule,
  parseCron,
  validateSchedule,
  wallToUtc,
} from "../server/routines/schedule.mjs";
import { normalizeRoutine, upsertRun, activeRun, lastRun } from "../server/routines/store.mjs";

const failures = [];
let checks = 0;
async function check(label, run) {
  try {
    await run();
    checks += 1;
    console.log(`PASS ${label}`);
  } catch (error) {
    failures.push({ label, error: error.message });
    console.error(`FAIL ${label}: ${error.message}`);
  }
}

const isoList = (schedule, after, count = 3) => nextOccurrences(normalizeSchedule(schedule), new Date(after), count).map((date) => date.toISOString());

// ---------------------------------------------------------------------------
// Part one: schedule arithmetic

await check("weekdays Mon-Fri at 09:00 in New York skips the weekend", () => {
  assert.deepEqual(isoList({ kind: "weekdays", days: [1, 2, 3, 4, 5], time: "09:00", timeZone: "America/New_York" }, "2026-10-30T20:00:00Z"), ["2026-11-02T14:00:00.000Z", "2026-11-03T14:00:00.000Z", "2026-11-04T14:00:00.000Z"]);
});
await check("weekdays at 09:00 crosses the New York fall-back without drifting", () => {
  // 30 Oct is EDT (UTC-4), 2 Nov is EST (UTC-5): 09:00 wall clock stays 09:00.
  assert.deepEqual(isoList({ kind: "weekdays", days: [1, 2, 3, 4, 5], time: "09:00", timeZone: "America/New_York" }, "2026-10-29T20:00:00Z", 2), ["2026-10-30T13:00:00.000Z", "2026-11-02T14:00:00.000Z"]);
});
await check("New York spring-forward gap: 02:30 on 8 Mar 2026 moves forward to 03:30 EDT", () => {
  assert.deepEqual(isoList({ kind: "once", date: "2026-03-08", time: "02:30", timeZone: "America/New_York" }, "2026-03-07T00:00:00Z", 1), ["2026-03-08T07:30:00.000Z"]);
  assert.equal(formatOccurrence(new Date("2026-03-08T07:30:00Z"), "America/New_York"), "Sun 8 Mar 2026, 03:30");
});
await check("New York fall-back: 01:30 on 1 Nov 2026 runs once, at its first (EDT) occurrence", () => {
  assert.deepEqual(isoList({ kind: "weekdays", days: [0, 1, 2, 3, 4, 5, 6], time: "01:30", timeZone: "America/New_York" }, "2026-10-31T12:00:00Z", 2), ["2026-11-01T05:30:00.000Z", "2026-11-02T06:30:00.000Z"]);
});
await check("Europe/London spring-forward gap: 01:30 on 29 Mar 2026 becomes 02:30 BST", () => {
  assert.deepEqual(isoList({ kind: "weekdays", days: [0, 1, 2, 3, 4, 5, 6], time: "01:30", timeZone: "Europe/London" }, "2026-03-28T12:00:00Z", 2), ["2026-03-29T01:30:00.000Z", "2026-03-30T00:30:00.000Z"]);
  assert.equal(formatOccurrence(new Date("2026-03-29T01:30:00Z"), "Europe/London"), "Sun 29 Mar 2026, 02:30");
});
await check("Europe/London fall-back: 01:30 on 25 Oct 2026 runs once, at the BST occurrence", () => {
  assert.deepEqual(isoList({ kind: "weekdays", days: [0, 1, 2, 3, 4, 5, 6], time: "01:30", timeZone: "Europe/London" }, "2026-10-24T12:00:00Z", 2), ["2026-10-25T00:30:00.000Z", "2026-10-26T01:30:00.000Z"]);
});
await check("cron every day at 09:00 London keeps 09:00 wall clock across the October change", () => {
  assert.deepEqual(isoList({ kind: "cron", cron: "0 9 * * *", timeZone: "Europe/London" }, "2026-10-24T12:00:00Z", 2), ["2026-10-25T09:00:00.000Z", "2026-10-26T09:00:00.000Z"]);
});
await check("monthly on the 31st skips 30-day months", () => {
  assert.deepEqual(isoList({ kind: "monthly", day: 31, time: "09:00", timeZone: "Europe/London" }, "2026-10-13T08:00:00Z"), ["2026-10-31T09:00:00.000Z", "2026-12-31T09:00:00.000Z", "2027-01-31T09:00:00.000Z"]);
});
await check("monthly on the last day handles every month, including February", () => {
  assert.deepEqual(isoList({ kind: "monthly", day: "last", time: "09:00", timeZone: "Asia/Kolkata" }, "2026-01-30T08:00:00Z"), ["2026-01-31T03:30:00.000Z", "2026-02-28T03:30:00.000Z", "2026-03-31T03:30:00.000Z"]);
});
await check("yearly on 29 February only runs in leap years", () => {
  assert.deepEqual(isoList({ kind: "yearly", month: 2, day: 29, time: "09:00", timeZone: "UTC" }, "2026-10-13T08:00:00Z", 2), ["2028-02-29T09:00:00.000Z", "2032-02-29T09:00:00.000Z"]);
});
await check("yearly on 1 January at 09:00 in Kolkata", () => {
  assert.deepEqual(isoList({ kind: "yearly", month: 1, day: 1, time: "09:00", timeZone: "Asia/Kolkata" }, "2026-10-13T08:00:00Z", 2), ["2027-01-01T03:30:00.000Z", "2028-01-01T03:30:00.000Z"]);
});
await check("every 15 minutes aligns to the chosen start, not to the clock", () => {
  assert.deepEqual(isoList({ kind: "interval", everyMinutes: 15, startDate: "2026-10-13", startTime: "09:00", timeZone: "Europe/London" }, "2026-10-13T08:07:00Z"), ["2026-10-13T08:15:00.000Z", "2026-10-13T08:30:00.000Z", "2026-10-13T08:45:00.000Z"]);
  assert.deepEqual(isoList({ kind: "interval", everyMinutes: 90, startDate: "2026-10-13", startTime: "09:10", timeZone: "UTC" }, "2026-10-13T00:00:00Z", 2), ["2026-10-13T09:10:00.000Z", "2026-10-13T10:40:00.000Z"]);
});
await check("interval counts elapsed minutes through the New York fall-back", () => {
  assert.deepEqual(isoList({ kind: "interval", everyMinutes: 60, startDate: "2026-11-01", startTime: "00:30", timeZone: "America/New_York" }, "2026-11-01T04:30:00Z", 3), ["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z", "2026-11-01T07:30:00.000Z"]);
});
await check("interval clamps to 5..1440 minutes", () => {
  assert.equal(normalizeSchedule({ kind: "interval", everyMinutes: 1 }).everyMinutes, 5);
  assert.equal(normalizeSchedule({ kind: "interval", everyMinutes: 99999 }).everyMinutes, 1440);
});
await check("once in the past has no next occurrence", () => {
  assert.equal(nextOccurrence(normalizeSchedule({ kind: "once", date: "2026-10-01", time: "09:00", timeZone: "UTC" }), new Date("2026-10-13T00:00:00Z")), null);
});
await check("custom cron: L, names, lists and weekday ranges", () => {
  assert.deepEqual(isoList({ kind: "cron", cron: "0 9 L * *", timeZone: "Europe/London" }, "2026-10-13T08:07:00Z", 2), ["2026-10-31T09:00:00.000Z", "2026-11-30T09:00:00.000Z"]);
  assert.deepEqual(isoList({ kind: "cron", cron: "0 9,17 * * MON-FRI", timeZone: "Asia/Kolkata" }, "2026-10-16T12:00:00Z"), ["2026-10-19T03:30:00.000Z", "2026-10-19T11:30:00.000Z", "2026-10-20T03:30:00.000Z"]);
  assert.deepEqual(isoList({ kind: "cron", cron: "0 9 1 jan *", timeZone: "UTC" }, "2026-10-13T00:00:00Z", 1), ["2027-01-01T09:00:00.000Z"]);
  assert.ok(parseCron("@daily"));
  assert.equal(parseCron("* * * *"), null);
  assert.equal(parseCron("61 * * * *"), null);
});
await check("validation names the missing field", () => {
  assert.deepEqual(validateSchedule(normalizeSchedule({ kind: "cron", cron: "bad" })), ["cron"]);
  assert.deepEqual(validateSchedule(normalizeSchedule({ kind: "yearly", month: 2, day: 30 })), ["day"]);
  assert.deepEqual(validateSchedule(normalizeSchedule({ kind: "once" })), ["date"]);
  assert.deepEqual(validateSchedule(normalizeSchedule({ kind: "weekdays", days: [] })), ["days"]);
  assert.deepEqual(validateSchedule({ kind: "weekdays", days: [1], time: "09:00", timeZone: "Mars/Olympus" }), ["timeZone"]);
  assert.equal(normalizeSchedule({ kind: "weekdays", timeZone: "Nowhere/Nope" }, { defaultTimeZone: "Pacific/Auckland" }).timeZone, "Pacific/Auckland");
});
await check("wallToUtc is exact outside transitions", () => {
  assert.equal(wallToUtc("Pacific/Auckland", { year: 2026, month: 10, day: 13, hour: 9, minute: 0 }).toISOString(), "2026-10-12T20:00:00.000Z");
  assert.equal(wallToUtc("UTC", { year: 2026, month: 10, day: 13, hour: 9, minute: 0 }).toISOString(), "2026-10-13T09:00:00.000Z");
});
await check("the rule in words", () => {
  assert.equal(describeSchedule(normalizeSchedule({ kind: "weekdays" })), "Weekdays (Mon–Fri) at 09:00");
  assert.equal(describeSchedule(normalizeSchedule({ kind: "weekdays", days: [0, 1, 2, 3, 4, 5, 6], time: "7:05" })), "Every day at 07:05");
  assert.equal(describeSchedule(normalizeSchedule({ kind: "monthly", day: "last" })), "Monthly on the last day at 09:00");
  assert.equal(describeSchedule(normalizeSchedule({ kind: "monthly", day: 22 })), "Monthly on the 22nd at 09:00");
  assert.equal(describeSchedule(normalizeSchedule({ kind: "yearly", month: 1, day: 1 })), "Yearly on 1 Jan at 09:00");
  assert.equal(describeSchedule(normalizeSchedule({ kind: "interval", everyMinutes: 120, startDate: "2026-10-13", startTime: "09:00" })), "Every 2 hours from 13 Oct 2026 09:00");
  assert.equal(describeSchedule(normalizeSchedule({ kind: "once", date: "2026-10-14", time: "18:30" })), "Once on 14 Oct 2026 at 18:30");
});
await check("routine records keep at most forty runs and expose active and last run", () => {
  let routine = normalizeRoutine({ memberId: "m", title: "t", instructions: "i", schedule: { kind: "weekdays" } });
  for (let index = 0; index < 45; index += 1) routine = upsertRun(routine, { id: `r${index}`, routineId: routine.id, status: "completed", trigger: "schedule" });
  assert.equal(routine.runs.length, 40);
  routine = upsertRun(routine, { id: "live", routineId: routine.id, status: "running", trigger: "schedule" });
  assert.equal(activeRun(routine).id, "live");
  assert.equal(lastRun(routine).id, "r44");
});

// ---------------------------------------------------------------------------
// Part two: the real bridge

const CLOCK_START = "2026-10-13T09:00:50Z";

const bridge = await startBridge({
  prepare: async (directory) => {
    const entry = join(directory, "sdk.mjs");
    const calls = join(directory, "calls.jsonl");
    // A controlled member adapter: records every prompt; "HOLD:<name>" keeps
    // the run active until release-<name> exists; "REQUEST:<json>" echoes a
    // SQUAD_ACTION line so the reply carries a proposal.
    await writeFile(entry, `import { existsSync, appendFileSync } from 'node:fs';
export class AutohandSDK {
 async start() {} async interrupt() {} async close() {}
 async *streamPrompt({ message }) {
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ message, at: new Date().toISOString() }) + '\\n');
  const hold = message.match(/HOLD:([a-z-]+)/);
  yield { type: 'message_start' };
  if (hold) { const release = ${JSON.stringify(directory)} + '/release-' + hold[1]; while (!existsSync(release)) { await new Promise(resolve => setTimeout(resolve, 200)); yield { type: 'heartbeat' }; } }
  const request = message.match(/REQUEST:(.*)/);
  yield { type: 'message_end', content: request ? 'Happy to set that up.\\nSQUAD_ACTION: ' + request[1] : 'Routine work done.' };
 }
}`);
    return { AUTOHAND_AGENT_SDK_ENTRY: entry, AUTOHAND_AGENT_SDK_DIR: directory, AUTOHAND_SQUAD_SCHEDULER_CLOCK: CLOCK_START, AUTOHAND_SQUAD_SCHEDULER_TICK_MS: "400" };
  },
});

const workspace = process.cwd();
const member = (id) => ({ id, name: id, role: "Engineer", skills: [], projects: [{ path: workspace }], workspace, permissions: { builtInPolicies: { squad_create_channel: "ask" } }, harness: { id: "autohand" } });
const calls = async () => (await readFile(join(bridge.directory, "calls.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
const release = (name) => writeFile(join(bridge.directory, `release-${name}`), "go");
const hold = (name) => rm(join(bridge.directory, `release-${name}`), { force: true });
const routinesFor = async (memberId) => (await bridge.api(`/api/routines?memberId=${memberId}`)).data.routines;
const routineById = async (id) => (await bridge.api(`/api/routines/${id}`)).data;
const finishedRun = (id) => until(async () => { const r = await bridge.api(`/api/runs/${id}`); return ["completed", "failed", "stopped"].includes(r.data?.status) ? r.data : false; }, `run ${id}`);

try {
  // The bridge learns a member from any chat or run; warm up two members so
  // their routines can run with the app closed.
  for (const id of ["routine-a", "routine-b"]) {
    const warm = await bridge.api("/api/runs", "POST", { agentId: id, agent: member(id), workspace, mode: "prompt", requestId: `warm-${id}`, prompt: `warm up ${id}` });
    assert.equal(warm.success, true, JSON.stringify(warm));
    await finishedRun(warm.data.id);
  }

  let routineA;
  let routineB;
  let routineC;
  await check("create routines: every minute (cron), a one-minute run limit, and one for a member the bridge does not know", async () => {
    const a = await bridge.api("/api/routines", "POST", { memberId: "routine-a", title: "Every minute hold", instructions: "HOLD:alpha do the routine work", workspace, schedule: { kind: "cron", cron: "* * * * *", timeZone: "UTC" } });
    assert.equal(a.status, 201, JSON.stringify(a));
    routineA = a.data;
    assert.equal(routineA.nextAt, "2026-10-13T09:01:00.000Z");
    assert.equal(routineA.needsApp, false);
    assert.deepEqual(routineA.next, ["2026-10-13T09:01:00.000Z", "2026-10-13T09:02:00.000Z", "2026-10-13T09:03:00.000Z"]);
    const b = await bridge.api("/api/routines", "POST", { memberId: "routine-b", title: "Stuck with a limit", instructions: "HOLD:beta never finishes", workspace, maxRunMinutes: 1, schedule: { kind: "cron", cron: "* * * * *", timeZone: "UTC" } });
    assert.equal(b.status, 201, JSON.stringify(b));
    routineB = b.data;
    const c = await bridge.api("/api/routines", "POST", { memberId: "routine-c", title: "Needs the app", instructions: "app dispatched work", workspace, schedule: { kind: "cron", cron: "* * * * *", timeZone: "UTC" } });
    assert.equal(c.status, 201, JSON.stringify(c));
    routineC = c.data;
    assert.equal(routineC.needsApp, true, "a member the bridge has never seen needs Squad open");
    const bad = await bridge.api("/api/routines", "POST", { memberId: "routine-a", title: "Broken", instructions: "x", workspace, schedule: { kind: "cron", cron: "nope", timeZone: "UTC" } });
    assert.equal(bad.status, 400);
    assert.match(bad.error, /schedule\.cron/);
  });

  await check("preview computes the rule and the next three dates on the bridge", async () => {
    const preview = await bridge.api("/api/routines/preview", "POST", { schedule: { kind: "monthly", day: "last", time: "09:00", timeZone: "Asia/Kolkata" } });
    assert.equal(preview.success, true);
    assert.equal(preview.data.description, "Monthly on the last day at 09:00");
    assert.deepEqual(preview.data.next, ["2026-10-31T03:30:00.000Z", "2026-11-30T03:30:00.000Z", "2026-12-31T03:30:00.000Z"]);
    assert.equal(preview.data.nextLabels[0], "Sat 31 Oct 2026, 09:00");
    const interval = await bridge.api("/api/routines/preview", "POST", { schedule: { kind: "interval", everyMinutes: 5, timeZone: "UTC" } });
    assert.equal(interval.data.schedule.startDate, "2026-10-13", "an interval without a start anchors to the scheduler clock");
  });

  await check("the scheduler fires the routine at 09:01 through the member adapter", async () => {
    const fired = await until(async () => { const r = await routineById(routineA.id); return r.runs.some((run) => run.status === "running") ? r : false; }, "routine A fires", 30000);
    const run = fired.runs.find((item) => item.status === "running");
    assert.equal(run.scheduledFor, "2026-10-13T09:01:00.000Z");
    assert.equal(run.dispatch, "bridge");
    assert.ok(run.memberRunId, "the bridge run id is recorded");
    assert.equal(fired.nextAt, "2026-10-13T09:02:00.000Z");
    await until(async () => (await calls()).some((call) => call.message.includes("HOLD:alpha do the routine work")), "adapter received the routine instructions");
    const live = await bridge.api(`/api/runs/${run.memberRunId}`);
    assert.equal(live.data.status, "running");
  });

  await check("a member the bridge does not know gets an app dispatch instead", async () => {
    const pending = await until(async () => { const p = await bridge.api("/api/routines/pending"); return p.data.dispatches.find((d) => d.routineId === routineC.id) || false; }, "routine C queued for the app", 30000);
    assert.equal(pending.memberId, "routine-c");
    assert.equal(pending.prompt, "app dispatched work");
    const queued = (await routineById(routineC.id)).runs[0];
    assert.equal(queued.status, "queued");
    assert.equal(queued.dispatch, "app");
    const started = await bridge.api(`/api/routines/runs/${pending.runId}/started`, "POST", { memberRunId: "app-run-1" });
    assert.equal(started.success, true, JSON.stringify(started));
    assert.equal(started.data.runs[0].status, "running");
    const again = await bridge.api(`/api/routines/runs/${pending.runId}/started`, "POST", { memberRunId: "app-run-2" });
    assert.equal(again.status, 409, "a run cannot be started twice");
    const finished = await bridge.api(`/api/routines/runs/${pending.runId}/finished`, "POST", { status: "completed", preview: "done by the app" });
    assert.equal(finished.data.runs[0].status, "completed");
    assert.equal(finished.data.lastRun.preview, "done by the app");
    assert.equal((await bridge.api("/api/routines/pending")).data.dispatches.some((d) => d.runId === pending.runId), false);
  });

  await check("the 09:02 occurrence is skipped and recorded while the 09:01 run is still active", async () => {
    const skipped = await until(async () => { const r = await routineById(routineA.id); return r.runs.some((run) => run.status === "skipped") ? r : false; }, "routine A skips", 90000);
    const record = skipped.runs.find((run) => run.status === "skipped");
    assert.equal(record.scheduledFor, "2026-10-13T09:02:00.000Z");
    assert.match(record.reason, /previous run was still active/);
    assert.equal(skipped.runs.filter((run) => run.status === "running").length, 1, "no second member run was started");
    assert.equal(skipped.activeRun.scheduledFor, "2026-10-13T09:01:00.000Z");
  });

  await check("the run limit stops a stuck run after one minute", async () => {
    const stopped = await until(async () => { const r = await routineById(routineB.id); return r.runs.some((run) => run.status === "stopped") ? r : false; }, "routine B stopped", 90000);
    const record = stopped.runs.find((run) => run.status === "stopped");
    assert.match(record.reason, /1 minute run limit/);
    assert.equal(record.scheduledFor, "2026-10-13T09:01:00.000Z");
    const memberRun = await finishedRun(record.memberRunId);
    assert.equal(memberRun.status, "stopped", "the bridge run itself was stopped");
    assert.equal(stopped.activeRun, null);
  });

  await check("the held run finishes and the routine records completed", async () => {
    await release("alpha");
    const done = await until(async () => { const r = await routineById(routineA.id); return r.runs.some((run) => run.status === "completed") ? r : false; }, "routine A completes", 30000);
    const record = done.runs.find((run) => run.status === "completed");
    assert.ok(record.finishedAt);
    assert.equal(done.activeRun, null);
    assert.equal(done.lastRun.status, "completed");
  });

  await check("manual run uses the same dispatch and refuses while a run is active", async () => {
    await bridge.api(`/api/routines/${routineA.id}`, "PUT", { enabled: false });
    await hold("alpha");
    const manual = await bridge.api(`/api/routines/${routineA.id}/run`, "POST", {});
    assert.equal(manual.status, 202, JSON.stringify(manual));
    assert.equal(manual.data.run.trigger, "manual");
    assert.equal(manual.data.run.dispatch, "bridge");
    assert.equal(manual.data.dispatch, null);
    const twice = await bridge.api(`/api/routines/${routineA.id}/run`, "POST", {});
    assert.equal(twice.status, 409);
    await release("alpha");
    await until(async () => (await routineById(routineA.id)).activeRun === null, "manual run finishes");
  });

  let proposalId;
  let declinedId;
  await check("a schedule proposal in a member reply becomes a pending confirmation, not a routine", async () => {
    const before = (await routinesFor("routine-a")).length;
    const action = { type: "schedule", title: "Morning report", instructions: "Summarise overnight CI and open pull requests.", schedule: { kind: "weekdays", days: [1, 2, 3, 4, 5], time: "09:00" }, timezone: "Asia/Kolkata" };
    const run = await bridge.api("/api/runs", "POST", { agentId: "routine-a", agent: member("routine-a"), workspace, mode: "prompt", requestId: "propose-1", prompt: `REQUEST:${JSON.stringify(action)}` });
    assert.equal(run.success, true, JSON.stringify(run));
    const done = await finishedRun(run.data.id);
    assert.equal(done.status, "completed");
    assert.equal(done.channelActions?.[0]?.type, "schedule", JSON.stringify(done.channelActions));
    assert.equal(done.channelActions[0].status, "proposed");
    assert.ok(!done.reply.includes("SQUAD_ACTION:"), "the reply describes the receipt, not the action line");
    assert.match(done.reply, /Nothing is scheduled until you confirm/);
    proposalId = done.channelActions[0].id;
    const proposals = (await bridge.api("/api/routines/proposals?status=proposed")).data.proposals;
    const proposal = proposals.find((item) => item.id === proposalId);
    assert.ok(proposal, "the proposal is listed");
    assert.equal(proposal.memberId, "routine-a");
    assert.equal(proposal.description, "Weekdays (Mon–Fri) at 09:00");
    assert.equal(proposal.timeZone, "Asia/Kolkata");
    // Proposed at about 09:03 UTC on Tuesday 13 Oct: next weekday 09:00 Kolkata is Wednesday 03:30 UTC.
    assert.deepEqual(proposal.next, ["2026-10-14T03:30:00.000Z", "2026-10-15T03:30:00.000Z", "2026-10-16T03:30:00.000Z"]);
    assert.equal((await routinesFor("routine-a")).length, before, "nothing was scheduled");
    const repeat = await bridge.api("/api/runs", "POST", { agentId: "routine-a", agent: member("routine-a"), workspace, mode: "prompt", requestId: "propose-1", prompt: `REQUEST:${JSON.stringify(action)}` });
    const repeated = await finishedRun(repeat.data.id);
    assert.equal(repeated.channelActions[0].id, proposalId, "the same request id yields the same proposal");
    assert.equal((await bridge.api("/api/routines/proposals?status=proposed")).data.proposals.filter((item) => item.memberId === "routine-a").length, 1);
  });

  await check("a proposal without a timezone or with forged fields is refused with a visible reason", async () => {
    const noZone = await finishedRun((await bridge.api("/api/runs", "POST", { agentId: "routine-a", agent: member("routine-a"), workspace, mode: "prompt", requestId: "propose-nozone", prompt: `REQUEST:${JSON.stringify({ type: "schedule", title: "No zone", instructions: "x", schedule: { kind: "weekdays" } })}` })).data.id);
    assert.equal(noZone.channelActions[0].status, "failed");
    assert.match(noZone.channelActions[0].message, /timezone/);
    const forged = await finishedRun((await bridge.api("/api/runs", "POST", { agentId: "routine-a", agent: member("routine-a"), workspace, mode: "prompt", requestId: "propose-forged", prompt: `REQUEST:${JSON.stringify({ type: "schedule", title: "Forged", instructions: "x", schedule: { kind: "weekdays" }, timezone: "UTC", memberId: "someone-else" })}` })).data.id);
    assert.equal(forged.channelActions[0].status, "failed");
    assert.match(forged.channelActions[0].message, /only contain/);
    assert.equal((await bridge.api("/api/routines/proposals?status=proposed")).data.proposals.filter((item) => item.memberId === "routine-a").length, 1);
  });

  await check("Decline records the decision; Confirm creates the routine once", async () => {
    const second = await finishedRun((await bridge.api("/api/runs", "POST", { agentId: "routine-a", agent: member("routine-a"), workspace, mode: "prompt", requestId: "propose-2", prompt: `REQUEST:${JSON.stringify({ type: "schedule", title: "Declined one", instructions: "x", schedule: { kind: "monthly", day: 1, time: "08:00" }, timezone: "UTC" })}` })).data.id);
    declinedId = second.channelActions[0].id;
    const declined = await bridge.api(`/api/routines/proposals/${declinedId}/decline`, "POST", {});
    assert.equal(declined.data.proposal.status, "declined");
    assert.equal(declined.data.routine, null);
    assert.equal((await bridge.api(`/api/routines/proposals/${declinedId}/confirm`, "POST", {})).status, 409, "a declined proposal cannot be confirmed later");
    const before = (await routinesFor("routine-a")).length;
    const confirmed = await bridge.api(`/api/routines/proposals/${proposalId}/confirm`, "POST", {});
    assert.equal(confirmed.success, true, JSON.stringify(confirmed));
    assert.equal(confirmed.data.proposal.status, "confirmed");
    assert.equal(confirmed.data.routine.title, "Morning report");
    assert.equal(confirmed.data.routine.source, "chat");
    assert.equal(confirmed.data.routine.schedule.timeZone, "Asia/Kolkata");
    assert.equal(confirmed.data.routine.nextAt, "2026-10-14T03:30:00.000Z");
    assert.equal((await routinesFor("routine-a")).length, before + 1);
    const again = await bridge.api(`/api/routines/proposals/${proposalId}/confirm`, "POST", {});
    assert.equal(again.data.routine.id, confirmed.data.routine.id, "confirming twice does not create a second routine");
    assert.equal((await routinesFor("routine-a")).length, before + 1);
  });

  await check("routines, run history and decisions survive a restart", async () => {
    const beforeA = await routineById(routineA.id);
    await bridge.restart();
    const restored = await bridge.api(`/api/routines/${routineA.id}`);
    assert.equal(restored.success, true, JSON.stringify(restored));
    const afterA = restored.data;
    assert.deepEqual(afterA.runs.map((run) => [run.status, run.scheduledFor]), beforeA.runs.map((run) => [run.status, run.scheduledFor]));
    assert.equal(afterA.enabled, false);
    const afterB = await routineById(routineB.id);
    assert.equal(afterB.runs.some((run) => run.status === "stopped"), true);
    const proposals = (await bridge.api("/api/routines/proposals")).data.proposals;
    assert.equal(proposals.find((item) => item.id === proposalId)?.status, "confirmed");
    assert.equal(proposals.find((item) => item.id === declinedId)?.status, "declined");
    assert.equal((await routinesFor("routine-a")).some((routine) => routine.title === "Morning report"), true);
  });

  await check("a run that was running when the bridge stopped is marked interrupted, never replayed", async () => {
    // The pinned clock restarts with the bridge, so start the held member
    // (never released) by hand rather than waiting for the next minute.
    const manual = await bridge.api(`/api/routines/${routineB.id}/run`, "POST", {});
    assert.equal(manual.status, 202, JSON.stringify(manual));
    assert.equal(manual.data.run.status, "running");
    await until(async () => (await calls()).some((call) => call.message.includes("HOLD:beta") && call.at > manual.data.run.startedAt.slice(0, 4)), "held run reached the adapter");
    const callsBefore = (await calls()).length;
    await bridge.restart();
    const recovered = await routineById(routineB.id);
    const interrupted = recovered.runs.find((run) => run.id === manual.data.run.id);
    assert.equal(interrupted.status, "interrupted");
    assert.match(interrupted.reason, /restarted/);
    assert.equal(recovered.activeRun, null);
    assert.equal((await calls()).length, callsBefore, "nothing was replayed at boot");
  });

  await check("delete removes the routine and its history", async () => {
    assert.equal((await bridge.api(`/api/routines/${routineC.id}`, "DELETE")).success, true);
    assert.equal((await bridge.api(`/api/routines/${routineC.id}`)).status, 404);
  });
} finally {
  await bridge.close();
}

if (failures.length) {
  console.error(`\ncheck-routines: ${failures.length} failed of ${checks + failures.length}`);
  for (const failure of failures) console.error(`- ${failure.label}: ${failure.error}`);
  process.exit(1);
}
console.log(`\ncheck-routines: ok (${checks} checks). Schedule arithmetic across kinds and DST edges; real bridge with a controlled member adapter and a pinned scheduler clock: fired at 09:01, skipped at 09:02 while active, run limit stop, app dispatch for an unknown member, proposal confirm/decline, restart retention and interrupted-run recovery. Not provider execution.`);
