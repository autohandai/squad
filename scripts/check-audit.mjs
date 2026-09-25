#!/usr/bin/env node
// Deterministic checks for the audit trail (ADR-0018): append/read/paginate
// in a temp state dir, corrupt-line tolerance, one record per documented
// bridge event carrying the run id, the client-action validator, the HTTP
// routes against a stub ctx, and the pure browser helpers. Exit 0 = pass.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import {
  ACTIVITY_KINDS,
  ATTR,
  appendRecord,
  buildRecord,
  decodeRecord,
  exportPath,
  flushAppends,
  readAllRecords,
  readRecords,
  safeMemberId,
} from "../server/audit/trail.mjs";
import { KIND_BY_EVENT, actorOf, handle, init, recordFromClientAction, recordFromEvent } from "../server/routes/audit.route.mjs";
import {
  HISTORY_FILTERS,
  filterRecords,
  groupRecordsByDay,
  kindLabel,
  mergeRecords,
  nextCursor,
  normalizeRecord,
  recordLinks,
  recordSummary,
  relativeTime,
} from "../src/lib/member-history.js";
import { parseLogEnvelope } from "../server/otel-logs.mjs";

const stateDir = await mkdtemp(join(tmpdir(), "squad-audit-"));
const failures = [];
function step(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok   ${name}`))
    .catch((error) => {
      failures.push(name);
      console.error(`FAIL ${name}\n     ${error?.stack || error}`);
    });
}

const T0 = Date.parse("2026-09-25T10:00:00.000Z");
const iso = (offsetMs) => new Date(T0 + offsetMs).toISOString();

await step("paths are safe and per member", () => {
  assert.equal(safeMemberId("asq_kai"), "asq_kai");
  assert.equal(safeMemberId("../../etc/passwd"), "_.._etc_passwd".replace(/^\.+/, ""));
  assert.ok(!exportPath(stateDir, "../x").includes(".."), "traversal is neutralised");
  assert.equal(exportPath(stateDir, "asq_kai"), join(stateDir, "audit", "asq_kai.jsonl"));
  assert.throws(() => exportPath(stateDir, ""), /member id/);
});

await step("records reuse the OTLP LogRecord shape plus an id", () => {
  const record = buildRecord({ memberId: "asq_kai", kind: "run", eventName: "run.finished", summary: "Run finished: Fix tests", refs: { runId: "run_1", workspace: "/tmp/w" }, timestamp: iso(0) });
  assert.match(record.id, /^\d+-[0-9a-f]{8}$/);
  assert.match(record.timeUnixNano, /^\d{16,}$/);
  assert.equal(record.severityNumber, 9);
  assert.equal(record.severityText, "INFO");
  assert.deepEqual(record.body, { stringValue: "Run finished: Fix tests" });
  const attributes = Object.fromEntries(record.attributes.map((entry) => [entry.key, entry.value.stringValue]));
  assert.equal(attributes[ATTR.memberId], "asq_kai");
  assert.equal(attributes[ATTR.eventName], "run.finished");
  assert.equal(attributes[ATTR.kind], "run");
  assert.equal(attributes["autohand.run.id"], "run_1");
  assert.equal(attributes["autohand.workspace"], "/tmp/w");
  assert.match(record.traceId, /^[0-9a-f]{32}$/, "run id seeds the trace id");
  // The same line parses with the shared OTLP reader once wrapped in an envelope.
  const parsed = parseLogEnvelope({ resourceLogs: [{ resource: { attributes: [] }, scopeLogs: [{ scope: { name: "audit" }, logRecords: [record] }] }] });
  assert.equal(parsed[0].attributes["autohand.member.id"], "asq_kai");
  assert.equal(parsed[0].timestamp, iso(0));
  const decoded = decodeRecord(record);
  assert.equal(decoded.at, iso(0));
  assert.deepEqual(decoded.refs, { runId: "run_1", workspace: "/tmp/w" });
  assert.throws(() => buildRecord({ kind: "run" }), /memberId/);
});

await step("append is append-only, per member, and reads newest first", async () => {
  for (let index = 0; index < 7; index += 1) {
    await appendRecord(stateDir, { memberId: "asq_kai", kind: index % 2 ? "message" : "run", eventName: index % 2 ? "chat.finished" : "run.finished", summary: `event ${index}`, refs: { runId: `run_${index}` }, timestamp: iso(index * 60_000) });
  }
  await appendRecord(stateDir, { memberId: "asq_noah", kind: "shell", eventName: "shell.ran", summary: "Ran ls", timestamp: iso(0) });
  await flushAppends();
  const raw = await readFile(exportPath(stateDir, "asq_kai"), "utf8");
  assert.equal(raw.trim().split("\n").length, 7, "one line per record");
  assert.ok(raw.endsWith("\n"));
  const noah = await readFile(exportPath(stateDir, "asq_noah"), "utf8");
  assert.equal(noah.trim().split("\n").length, 1, "members do not share a file");
  const { records } = await readRecords(stateDir, "asq_kai");
  assert.equal(records.length, 7);
  assert.equal(records[0].summary, "event 6");
  assert.equal(records[6].summary, "event 0");
  assert.equal(records[0].refs.runId, "run_6");
});

await step("pagination by id cursor, by time cursor, and by kind", async () => {
  const first = await readRecords(stateDir, "asq_kai", { limit: 3 });
  assert.equal(first.records.length, 3);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextBefore, first.records[2].id);
  const second = await readRecords(stateDir, "asq_kai", { limit: 3, before: first.nextBefore });
  assert.deepEqual(second.records.map((record) => record.summary), ["event 3", "event 2", "event 1"]);
  assert.equal(second.hasMore, true);
  const third = await readRecords(stateDir, "asq_kai", { limit: 3, before: second.nextBefore });
  assert.deepEqual(third.records.map((record) => record.summary), ["event 0"]);
  assert.equal(third.hasMore, false);
  assert.equal(third.nextBefore, "");
  const byTime = await readRecords(stateDir, "asq_kai", { before: iso(2 * 60_000 + 1), limit: 10 });
  assert.deepEqual(byTime.records.map((record) => record.summary), ["event 2", "event 1", "event 0"]);
  const byMs = await readRecords(stateDir, "asq_kai", { before: String(T0 + 60_000 + 1), limit: 10 });
  assert.deepEqual(byMs.records.map((record) => record.summary), ["event 1", "event 0"]);
  const onlyRuns = await readRecords(stateDir, "asq_kai", { kind: "run", limit: 2 });
  assert.deepEqual(onlyRuns.records.map((record) => record.summary), ["event 6", "event 4"]);
  assert.equal(onlyRuns.hasMore, true);
  const restRuns = await readRecords(stateDir, "asq_kai", { kind: "run", limit: 5, before: onlyRuns.nextBefore });
  assert.deepEqual(restRuns.records.map((record) => record.summary), ["event 2", "event 0"]);
  assert.equal(restRuns.hasMore, false);
  const capped = await readRecords(stateDir, "asq_kai", { limit: -3 });
  assert.equal(capped.records.length, 1, "limit floors at 1");
  const defaulted = await readRecords(stateDir, "asq_kai", { limit: 0 });
  assert.equal(defaulted.records.length, 7, "limit 0 means the default page");
  const missing = await readRecords(stateDir, "asq_nobody");
  assert.deepEqual(missing, { records: [], hasMore: false, nextBefore: "", total: 0, dropped: 0 });
});

await step("a corrupt line is skipped, not fatal", async () => {
  await appendFile(exportPath(stateDir, "asq_kai"), '{"broken": true\nnot json at all\n{"id":"x","attributes":"nope"}\n', "utf8");
  const { records, dropped } = await readAllRecords(stateDir, "asq_kai");
  assert.equal(records.length, 7);
  assert.equal(dropped, 3);
  await appendRecord(stateDir, { memberId: "asq_kai", kind: "edit", eventName: "file.edited", summary: "Edited a.js", refs: { path: "a.js" }, timestamp: iso(8 * 60_000) });
  const page = await readRecords(stateDir, "asq_kai", { limit: 1 });
  assert.equal(page.records[0].summary, "Edited a.js", "appends still land after a corrupt line");
});

await step("every documented bridge event maps to exactly one attributed record", () => {
  const runs = new Map([["run_9", { agentId: "asq_kai" }]]);
  const memberFor = (runId) => runs.get(runId)?.agentId || "";
  const events = [
    { name: "run.finished", runId: "run_1", memberId: "asq_kai", status: "completed", title: "Fix flaky test", workspace: "/w", at: iso(0) },
    { name: "chat.finished", memberId: "asq_kai", status: "completed", channelId: "channel_1", preview: "Done.", runId: "run_2", at: iso(1) },
    { name: "member.stopped", memberId: "asq_kai", closedSessions: 1, stoppedRuns: 2, runId: "run_3", at: iso(2) },
    { name: "shell.ran", memberId: "asq_kai", command: "npm test", exitCode: 1, workspace: "/w", runId: "run_4", at: iso(3) },
    { name: "handoff.pending", taskId: "task_1", fromMemberId: "asq_kai", toMemberId: "asq_noah", title: "Review PR", runId: "run_5", at: iso(4) },
    { name: "approval.pending", workflowId: "wf_1", runId: "run_9", channelId: "channel_1", stepId: "deploy", at: iso(5) },
    { name: "mention.received", channelId: "channel_1", memberId: "asq_kai", messageId: "m_1", preview: "@kai look", runId: "run_7", at: iso(6) },
  ];
  const expectedKinds = ["run", "message", "run", "shell", "handoff", "approval", "message"];
  const produced = [];
  for (const [index, event] of events.entries()) {
    const record = recordFromEvent(event, { memberFor });
    assert.ok(record, `${event.name} produces a record`);
    produced.push(record);
    const decoded = decodeRecord(record);
    assert.equal(decoded.memberId, "asq_kai", `${event.name} is attributed to the acting member`);
    assert.equal(decoded.kind, expectedKinds[index], `${event.name} kind`);
    assert.equal(decoded.eventName, event.name);
    assert.equal(decoded.refs.runId, event.runId, `${event.name} carries the run id`);
    assert.equal(decoded.at, event.at, `${event.name} keeps the event time`);
    assert.ok(decoded.summary.length > 0);
  }
  assert.equal(produced.length, events.length, "exactly one record per event");
  assert.equal(new Set(produced.map((record) => record.id)).size, events.length, "ids are unique");
  assert.equal(decodeRecord(produced[3]).severityNumber, 9, "non-zero exit is not a failure status");
  assert.equal(decodeRecord(produced[4]).refs.memberId, "asq_noah", "handoff keeps the receiving member as a ref");
  assert.equal(decodeRecord(produced[4]).refs.taskId, "task_1");
  assert.equal(decodeRecord(produced[5]).refs.workflowId, "wf_1");
  assert.equal(decodeRecord(produced[5]).status, "pending");
  assert.equal(decodeRecord(produced[6]).refs.messageId, "m_1");
  assert.equal(decodeRecord(recordFromEvent({ name: "run.finished", runId: "run_1", memberId: "asq_kai", status: "failed", at: iso(0) })).severityNumber, 13);
  assert.equal(recordFromEvent({ name: "chat.finished", memberId: "", status: "failed", preview: "boom", at: iso(0) }), null, "no member, no record");
  assert.equal(recordFromEvent({ name: "approval.pending", workflowId: "wf", runId: "run_unknown", at: iso(0) }, { memberFor }), null, "unknown run, no record");
  assert.equal(recordFromEvent({ name: "bridge.started", memberId: "asq_kai" }), null, "unmapped events are ignored");
  assert.equal(recordFromEvent(null), null);
  assert.equal(actorOf({ name: "handoff.pending", fromMemberId: "asq_x" }), "asq_x");
  for (const kind of Object.values(KIND_BY_EVENT)) assert.ok(ACTIVITY_KINDS.includes(kind), `${kind} is a known kind`);
});

await step("client actions are validated before they are appended", () => {
  const record = recordFromClientAction("asq_kai", { kind: "message", summary: "Posted in #general: hello", refs: { channelId: "channel_1", messageId: "m_2", bogus: { nested: true }, "bad key": "x" }, eventName: "channel.message.posted" });
  const decoded = decodeRecord(record);
  assert.equal(decoded.kind, "message");
  assert.equal(decoded.source, "web");
  assert.equal(decoded.eventName, "channel.message.posted");
  assert.deepEqual(decoded.refs, { channelId: "channel_1", messageId: "m_2", bogus: "[object Object]" });
  assert.equal(decodeRecord(recordFromClientAction("asq_kai", { kind: "edit", summary: "Edited x" })).eventName, "web.edit");
  assert.throws(() => recordFromClientAction("asq_kai", { kind: "dance", summary: "x" }), /kind must be one of/);
  assert.throws(() => recordFromClientAction("asq_kai", { kind: "run" }), /summary is required/);
  assert.throws(() => recordFromClientAction("asq_kai", { kind: "run", summary: "x", eventName: "Nope" }), /eventName/);
  assert.throws(() => recordFromClientAction("", { kind: "run", summary: "x" }), /member id/);
});

// --- HTTP routes against a stub ctx ---------------------------------------

function stubCtx() {
  const events = new EventEmitter();
  const runs = new Map([["run_live", { agentId: "asq_kai" }]]);
  return {
    squadStateDir: stateDir,
    events,
    runs,
    SEVERITY: { WARN: 13 },
    logEvent() {},
    json(res, status, payload) {
      res.statusCode = status;
      res.payload = payload;
    },
    async readBody(req) {
      return req.body || {};
    },
    emit(name, payload) {
      const event = { name, at: iso(0), ...payload };
      events.emit(name, event);
      events.emit("*", event);
      return event;
    },
  };
}

function request(method, pathname, body) {
  return { req: { method, body }, res: { statusCode: 0, payload: null }, url: new URL(`http://127.0.0.1${pathname}`) };
}

await step("init subscribes to '*' and appends one record per event", async () => {
  const ctx = stubCtx();
  await init(ctx);
  await init(ctx);
  assert.equal(ctx.events.listenerCount("*"), 1, "init is idempotent");
  const before = (await readRecords(stateDir, "asq_live")).total;
  ctx.emit("run.finished", { runId: "run_live", memberId: "asq_live", status: "completed", title: "T" });
  ctx.emit("approval.pending", { workflowId: "wf_2", runId: "run_live", channelId: "c", stepId: "s" });
  ctx.emit("chat.finished", { memberId: "", status: "failed", preview: "x" });
  ctx.emit("bridge.something", { memberId: "asq_live" });
  await flushAppends();
  const after = await readRecords(stateDir, "asq_live");
  assert.equal(after.total - before, 1, "one record for the member event, none for the ignored ones");
  const kai = await readRecords(stateDir, "asq_kai", { kind: "approval", limit: 1 });
  assert.equal(kai.records[0].refs.workflowId, "wf_2", "approval resolved its member from ctx.runs");
});

await step("GET /api/members/:id/activity pages the trail", async () => {
  const ctx = stubCtx();
  const { req, res, url } = request("GET", "/api/members/asq_kai/activity?limit=2");
  assert.equal(await handle(req, res, url, ctx), true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.data.memberId, "asq_kai");
  assert.equal(res.payload.data.records.length, 2);
  assert.equal(res.payload.data.hasMore, true);
  const next = request("GET", `/api/members/asq_kai/activity?limit=50&before=${encodeURIComponent(res.payload.data.nextBefore)}`);
  await handle(next.req, next.res, next.url, ctx);
  assert.equal(next.res.payload.data.records.length + 2, res.payload.data.total, "cursor continues without gaps");
  const other = request("GET", "/api/other");
  assert.equal(await handle(other.req, other.res, other.url, ctx), false, "unrelated paths are left alone");
  const bad = request("DELETE", "/api/members/asq_kai/activity");
  await handle(bad.req, bad.res, bad.url, ctx);
  assert.equal(bad.res.statusCode, 405);
});

await step("POST /api/members/:id/activity appends a client action", async () => {
  const ctx = stubCtx();
  const { req, res, url } = request("POST", "/api/members/asq_kai/activity", { kind: "message", summary: "Posted in #general: hi", refs: { channelId: "channel_1", messageId: "m_3" } });
  await handle(req, res, url, ctx);
  assert.equal(res.statusCode, 200);
  assert.ok(res.payload.data.id);
  const page = await readRecords(stateDir, "asq_kai", { limit: 1 });
  assert.equal(page.records[0].id, res.payload.data.id);
  assert.equal(page.records[0].source, "web");
  const invalid = request("POST", "/api/members/asq_kai/activity", { kind: "nope" });
  await handle(invalid.req, invalid.res, invalid.url, ctx);
  assert.equal(invalid.res.statusCode, 400);
  assert.match(invalid.res.payload.error, /kind/);
});

await step("GET /api/members/:id/activity/export streams the file byte for byte", async () => {
  const ctx = stubCtx();
  const res = new PassThrough();
  const headers = {};
  res.writeHead = (status, values) => {
    res.statusCode = status;
    Object.assign(headers, values);
  };
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => res.on("end", resolve));
  const url = new URL("http://127.0.0.1/api/members/asq_kai/activity/export");
  assert.equal(await handle({ method: "GET" }, res, url, ctx), true);
  await done;
  const body = Buffer.concat(chunks).toString("utf8");
  const file = await readFile(exportPath(stateDir, "asq_kai"), "utf8");
  assert.equal(body, file, "export matches the file");
  assert.equal(res.statusCode, 200);
  assert.match(headers["content-type"], /x-ndjson/);
  assert.match(headers["content-disposition"], /asq_kai-activity\.jsonl/);
  assert.equal(headers["content-length"], String(Buffer.byteLength(file)));

  const empty = new PassThrough();
  const emptyHeaders = {};
  empty.writeHead = (status, values) => Object.assign(emptyHeaders, values);
  const emptyDone = new Promise((resolve) => empty.on("end", resolve));
  empty.resume();
  await handle({ method: "GET" }, empty, new URL("http://127.0.0.1/api/members/asq_nobody/activity/export"), ctx);
  await emptyDone;
  assert.equal(emptyHeaders["content-length"], "0", "a member without history exports an empty file");
});

// --- Browser helpers ---------------------------------------------------------

await step("member-history helpers group, filter, merge, and link", async () => {
  const { records } = await readRecords(stateDir, "asq_kai", { limit: 50 });
  const raw = (await readFile(exportPath(stateDir, "asq_kai"), "utf8")).trim().split("\n").map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  });
  const fromRaw = raw.map(normalizeRecord).filter(Boolean);
  const fromApi = records.map(normalizeRecord);
  assert.equal(fromRaw.length, fromApi.length, "raw export lines normalise like API records");
  assert.deepEqual(mergeRecords(fromRaw).map((record) => record.id), fromApi.map((record) => record.id), "same order either way");
  assert.equal(mergeRecords(fromApi, fromApi).length, fromApi.length, "merge dedupes by id");
  assert.equal(nextCursor(fromApi), fromApi[fromApi.length - 1].id);
  assert.deepEqual(HISTORY_FILTERS, ["all", ...ACTIVITY_KINDS]);
  assert.equal(filterRecords(fromApi, "all").length, fromApi.length);
  assert.ok(filterRecords(fromApi, "run").every((record) => record.kind === "run"));
  assert.equal(filterRecords(fromApi, "nonsense").length, fromApi.length, "unknown filter means all");
  // Grouping uses the viewer's local calendar day, so compare with local keys.
  const localDay = (at) => {
    const date = new Date(at);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const groups = groupRecordsByDay(fromApi, { now: T0 + 30 * 60_000 });
  assert.equal(groups.flatMap((group) => group.records).length, fromApi.length, "grouping loses nothing");
  assert.ok(groups.every((group) => group.records.every((record) => localDay(record.at) === group.day)), "each group is one calendar day");
  assert.deepEqual(groups.map((group) => group.day), [...groups.map((group) => group.day)].sort().reverse(), "days are newest first");
  const seeded = groups.find((group) => group.day === localDay(iso(0)));
  assert.equal(seeded.label, "Today", "the seeded day reads as Today relative to now");
  assert.equal(kindLabel("handoff"), "Handoffs");
  assert.equal(kindLabel("handoff", { historyKinds: { handoff: "Overleveringer" } }), "Overleveringer");
  assert.equal(relativeTime(iso(0), { now: T0 + 5 * 60_000 }), "5m ago");
  assert.equal(relativeTime(iso(0), { now: T0 + 10_000 }), "just now");
  const withRun = fromApi.find((record) => record.refs.runId);
  assert.deepEqual(recordLinks(withRun).map((link) => link.type).slice(0, 1), ["run"]);
  const mention = normalizeRecord(recordFromEvent({ name: "mention.received", channelId: "channel_1", memberId: "asq_kai", messageId: "m_1", preview: "hi", at: iso(0) }));
  assert.deepEqual(recordLinks(mention), [{ type: "channel", id: "channel_1", label: "Channel", messageId: "m_1" }]);
  assert.equal(recordSummary({ kind: "shell", eventName: "shell.ran" }), "Shell · shell.ran");
});

await rm(stateDir, { recursive: true, force: true });

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\naudit trail checks passed");
