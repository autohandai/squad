#!/usr/bin/env node
// Lane L5 usage-and-system (ADR-0105): the usage ledger, the System summary
// and the automatic update-check switch.
//
// Part 1 is pure (server/usage/ledger.mjs, server/system/*.mjs,
// src/lib/system-settings.js, desktopUpdateStatus with a stub fetch).
// Part 2 starts the real bridge in an isolated state dir seeded with run
// records and telemetry across two members, two models and three days, plus
// channels.json, web-status.json and member MEMORY files, and asserts what
// /api/analytics, /api/system/* and /api/updates serve, including the
// analytics-daemon path through a stand-in /metrics server.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { dedupeUsageRecords, modelLabel, usageDayKey, usageLedger } from "../server/usage/ledger.mjs";
import { countMemoryBullets, countMemoryEntries, systemSummary } from "../server/system/summary.mjs";
import { autoCheckUpdatesEnabled, normalizeSystemSettings, readSystemSettings, writeSystemSettings } from "../server/system/settings.mjs";
import { revealActionLabel, revealCommand } from "../server/system/reveal.mjs";
import { desktopUpdateStatus } from "../server/desktop-updates.mjs";
import { formatUsageDuration, shouldAutoCheckUpdates, systemCountRows, usageLedgerEmpty, usageTables } from "../src/lib/system-settings.js";
import { startBridge } from "./lib/reliability-browser.mjs";

const failures = [];
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`ok ${label}`);
  } catch (error) {
    failures.push({ label, error: error.message });
    console.error(`FAIL ${label}: ${error.message}`);
  }
};

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
// Timestamps pinned to UTC calendar days so "three days" stays three days
// whatever the hour this check runs at.
const todayUtc = (() => {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
})();
const at = (daysAgo, hour = 10) => new Date(todayUtc - daysAgo * DAY + hour * 60 * 60 * 1000).toISOString();

// Two members, two models, three days. Ava's run-1 exists both as a run
// record and as its telemetry twin; run-2 only as a run record.
const MEMBERS = [
  { id: "asq_ava", name: "Ava", role: "Frontend Developer", status: "online" },
  { id: "asq_ben", name: "Ben", role: "Reviewer", status: "online" },
];
const usageEvent = (metadata, timestamp) => ({ event: "usage.recorded", timestamp, clientType: "squad", surface: "squad-web", version: "0.1.6", metadata });
const EVENTS = [
  usageEvent({ harness: "claude", agentId: "asq_ava", provider: "anthropic", model: "claude-sonnet-4-5", status: "completed", durationMs: 4000, tokens: 300, inputTokens: 100, outputTokens: 200, steps: 3, runId: "run-1" }, at(0)),
  usageEvent({ harness: "claude", agentId: "asq_ava", provider: "anthropic", model: "claude-sonnet-4-5", status: "completed", durationMs: 6000, tokens: 500, inputTokens: 200, outputTokens: 300, steps: 5 }, at(1)),
  usageEvent({ harness: "codex", agentId: "asq_ben", provider: "openai", model: "gpt-5", status: "completed", durationMs: 2000, tokens: 150, inputTokens: 50, outputTokens: 100 }, at(1, 15)),
  usageEvent({ harness: "codex", agentId: "asq_ben", provider: "openai", model: "gpt-5", status: "completed", durationMs: 8000, tokens: 1000, inputTokens: 400, outputTokens: 600, steps: 7 }, at(2)),
  usageEvent({ harness: "claude", agentId: "asq_ghost", provider: "anthropic", model: "claude-sonnet-4-5", status: "completed", durationMs: 1000, tokens: 10, inputTokens: 4, outputTokens: 6 }, at(2, 16)),
  // Older than the 30-day window: never in the ledger.
  usageEvent({ harness: "claude", agentId: "asq_ava", provider: "anthropic", model: "claude-sonnet-4-5", status: "completed", durationMs: 99000, tokens: 99999, inputTokens: 1, outputTokens: 99998 }, at(45)),
  // Not a usage signal.
  { event: "feature_flags.checked", timestamp: at(0), clientType: "squad", surface: "squad-launcher", metadata: {} },
];
const RUNS = [
  { id: "run-1", agentId: "asq_ava", status: "completed", transport: "sdk", effectiveModel: { provider: "anthropic", model: "claude-sonnet-4-5" }, startedAt: at(0, 9), finishedAt: at(0), tokens: 300, inputTokens: 100, outputTokens: 200 },
  { id: "run-2", agentId: "asq_ben", status: "completed", transport: "sdk", effectiveModel: { provider: "openai", model: "gpt-5" }, startedAt: at(0, 9), finishedAt: at(0, 10), tokens: 40, inputTokens: 10, outputTokens: 30, steps: 2 },
];

// Expected sums after dedupe (run-1's record is dropped in favour of its
// telemetry twin; run-2 counts; the 45-day-old event is outside the window).
const EXPECTED = {
  byMember: {
    asq_ava: { label: "Ava", runs: 2, inputTokens: 300, outputTokens: 500, totalTokens: 800, steps: 8, durationMs: 10000 },
    asq_ben: { label: "Ben", runs: 3, inputTokens: 460, outputTokens: 730, totalTokens: 1190, steps: 9, durationMs: 10000 + 60 * 60 * 1000 },
    asq_ghost: { label: "asq_ghost", runs: 1, inputTokens: 4, outputTokens: 6, totalTokens: 10, steps: null, durationMs: 1000 },
  },
  byModel: {
    "anthropic/claude-sonnet-4-5": { runs: 3, totalTokens: 810 },
    "openai/gpt-5": { runs: 3, totalTokens: 1190 },
  },
};

// --- Part 1: pure ----------------------------------------------------------

await check("ledger: sums by member, model and day; dedupe; window; names from web-status", async () => {
  const records = [
    ...EVENTS.filter((event) => event.event === "usage.recorded").map((event) => ({ ...event.metadata, at: event.timestamp, source: "usage.recorded", steps: "steps" in event.metadata ? event.metadata.steps : null })),
    ...RUNS.map((run) => ({ runId: run.id, agentId: run.agentId, provider: run.effectiveModel.provider, model: run.effectiveModel.model, tokens: run.tokens, inputTokens: run.inputTokens, outputTokens: run.outputTokens, durationMs: new Date(run.finishedAt) - new Date(run.startedAt), steps: run.steps ?? null, at: run.finishedAt, source: "run" })),
  ];
  assert.equal(dedupeUsageRecords(records).length, records.length - 1, "run-1's run record is dropped");
  const ledger = usageLedger({ records, members: MEMBERS, now });
  assert.equal(ledger.ledgerWindowDays, 30);
  assert.equal(ledger.ledgerRecords, 6);
  for (const [key, expected] of Object.entries(EXPECTED.byMember)) {
    const row = ledger.byMember.find((item) => item.key === key);
    assert.ok(row, `byMember row ${key}`);
    for (const [field, value] of Object.entries(expected)) assert.equal(row[field], value, `${key}.${field}`);
  }
  for (const [key, expected] of Object.entries(EXPECTED.byModel)) {
    const row = ledger.byModel.find((item) => item.key === key);
    assert.ok(row, `byModel row ${key}`);
    assert.equal(row.runs, expected.runs, `${key}.runs`);
    assert.equal(row.totalTokens, expected.totalTokens, `${key}.totalTokens`);
  }
  assert.equal(ledger.byDay.length, 3, "three days");
  assert.deepEqual(ledger.byDay.map((row) => row.key), [usageDayKey(at(0)), usageDayKey(at(1)), usageDayKey(at(2))].sort().reverse());
  assert.equal(ledger.byDay.reduce((sum, row) => sum + row.totalTokens, 0), 2000, "day totals add up to the window total");
  assert.equal(ledger.byMember.reduce((sum, row) => sum + row.totalTokens, 0), 2000);
  assert.equal(ledger.byModel.reduce((sum, row) => sum + row.totalTokens, 0), 2000);
  assert.ok(!ledger.byMember.some((row) => row.totalTokens === 99999), "45-day-old record excluded");
  assert.equal(modelLabel({ provider: "anthropic", model: "" }), "anthropic default");
  assert.equal(modelLabel({}), "Unknown model");
  const sorted = ledger.byMember.map((row) => row.totalTokens);
  assert.deepEqual(sorted, [...sorted].sort((a, b) => b - a), "members sorted by total tokens");
});

await check("summary: memory bullets, index entries, channel counts", async () => {
  assert.equal(countMemoryBullets("# Memory\n\nDurable context:\n\n- one\n- two\n* three\n1. four\n\nSkill source: x\n"), 4);
  assert.equal(countMemoryBullets(""), 0);
  const summary = systemSummary({
    webStatus: { members: MEMBERS },
    channelsState: { channels: [{ id: "c1" }, { id: "c2" }], threads: [{ id: "t1" }], messages: [{ id: "m1" }, { id: "m2" }] },
    memory: { memoryEntries: 7, memoryDocuments: 2, members: 2 },
    squadStateDir: "/tmp/squad",
    appStateDir: "/tmp/app",
  });
  assert.deepEqual([summary.members, summary.channels, summary.threads, summary.messages, summary.memoryEntries], [2, 2, 1, 2, 7]);
  assert.equal(summary.dataFolder, "/tmp/squad");
  const nested = systemSummary({ channelsState: { channels: [{ id: "c1", threads: [{}, {}], messages: [{}] }] } });
  assert.deepEqual([nested.threads, nested.messages], [2, 1], "older nested shape still counts");
  assert.deepEqual(systemCountRows(summary).map((row) => row.value), [2, 2, 1, 2, 7]);
});

await check("settings: normalize, persist, unknown keys kept, autoCheck gate", async () => {
  assert.equal(normalizeSystemSettings(null).autoCheckUpdates, true);
  assert.equal(normalizeSystemSettings({ autoCheckUpdates: "no" }).autoCheckUpdates, true);
  assert.equal(autoCheckUpdatesEnabled({ autoCheckUpdates: false }), false);
  const dir = join(process.cwd(), ".tmp-usage-system-settings");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(join(dir, "settings.json"), JSON.stringify({ future: 1, autoCheckUpdates: true }));
    const stored = await writeSystemSettings(dir, { autoCheckUpdates: false, autoCheckUpdatesX: "ignored" });
    assert.equal(stored.autoCheckUpdates, false);
    assert.equal(stored.future, 1, "unknown keys preserved");
    assert.equal((await readSystemSettings(dir)).autoCheckUpdates, false);
    assert.equal(JSON.parse(await readFile(join(dir, "settings.json"), "utf8")).autoCheckUpdates, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await check("reveal: fixed opener per platform, absolute paths only", async () => {
  assert.deepEqual(revealCommand("/Users/x/.autohand/squad", "darwin"), { executable: "open", args: ["/Users/x/.autohand/squad"] });
  assert.equal(revealCommand("C:\\Users\\x", "win32").executable, "explorer.exe");
  assert.equal(revealCommand("/home/x", "linux").executable, "xdg-open");
  assert.throws(() => revealCommand("relative/path", "darwin"));
  assert.equal(revealActionLabel("darwin"), "Show in Finder");
});

await check("desktopUpdateStatus: unattended check skipped when the switch is off, manual always runs", async () => {
  let checks = 0;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith("/health")) return { ok: true, json: async () => ({}) };
    if (String(url).endsWith("/updates/check") && options.method === "POST") {
      checks += 1;
      return { ok: true, json: async () => ({ success: true, checkedAt: "unix-ms:1", updateAvailable: false, latestAllowedVersion: "0.1.6", source: "github:autohandai/squad" }) };
    }
    throw new Error(`unexpected ${url}`);
  };
  const readJsonImpl = async (path) => (path.endsWith("daemon.json") ? { url: "http://127.0.0.1:19822/" } : null);
  const off = await desktopUpdateStatus({ squadStateDir: "/tmp", appVersion: "0.1.6", refresh: false, autoCheck: false, readJsonImpl, fetchImpl });
  assert.equal(checks, 0, "no repository check while off");
  assert.equal(off.status, "never-checked");
  assert.equal(off.autoCheck, false);
  assert.equal(off.skipped, true);
  const manual = await desktopUpdateStatus({ squadStateDir: "/tmp", appVersion: "0.1.6", refresh: true, autoCheck: false, readJsonImpl, fetchImpl });
  assert.equal(checks, 1, "manual check ran");
  assert.equal(manual.status, "up-to-date");
  assert.equal(manual.skipped, false);
  const on = await desktopUpdateStatus({ squadStateDir: "/tmp", appVersion: "0.1.6", refresh: false, autoCheck: true, readJsonImpl, fetchImpl });
  assert.equal(checks, 2, "unattended check runs while on");
  assert.equal(on.autoCheck, true);
  assert.equal(shouldAutoCheckUpdates(off), false);
  assert.equal(shouldAutoCheckUpdates(on), true);
  assert.equal(shouldAutoCheckUpdates(null), true);
});

await check("browser helpers: durations, tables, empty state", async () => {
  assert.equal(formatUsageDuration(0), "—");
  assert.equal(formatUsageDuration(12_000), "12 sec");
  assert.equal(formatUsageDuration(95_000), "1 min 35 sec");
  assert.equal(formatUsageDuration(95 * 60_000), "1 hour 35 min");
  assert.deepEqual(usageTables({}).map((table) => table.id), ["byMember", "byModel", "byDay"]);
  assert.equal(usageLedgerEmpty({}), true);
  assert.equal(usageLedgerEmpty({ byDay: [{ key: "2026-10-13" }] }), false);
});

// --- Part 2: the real bridge -------------------------------------------------

function jsonServer(routes) {
  const hits = {};
  const server = createServer((req, res) => {
    const key = `${req.method} ${req.url}`;
    hits[key] = (hits[key] || 0) + 1;
    const handler = routes[key];
    if (!handler) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(handler()));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, hits }));
  });
}

const bridge = await startBridge({
  prepare: async (directory) => {
    const squad = join(directory, "squad");
    const app = join(directory, "app");
    await mkdir(join(squad, "runs"), { recursive: true });
    await writeFile(join(squad, "telemetry.jsonl"), EVENTS.map((event) => JSON.stringify(event)).join("\n") + "\n");
    for (const run of RUNS) await writeFile(join(squad, "runs", `${run.id}.json`), JSON.stringify(run));
    await writeFile(join(squad, "web-status.json"), JSON.stringify({ source: "web-console", updatedAt: new Date(now).toISOString(), members: MEMBERS }));
    await writeFile(
      join(squad, "channels.json"),
      JSON.stringify({
        version: 1,
        revision: 3,
        channels: [
          { id: "c-general", name: "general", memberIds: ["asq_ava", "asq_ben"], createdAt: at(3), updatedAt: at(3) },
          { id: "c-release", name: "release", memberIds: ["asq_ben"], createdAt: at(3), updatedAt: at(3) },
        ],
        threads: [
          { id: "t1", channelId: "c-general", title: "one", createdAt: at(2) },
          { id: "t2", channelId: "c-general", title: "two", createdAt: at(2) },
          { id: "t3", channelId: "c-release", title: "three", createdAt: at(1) },
          { id: "t-orphan", channelId: "c-missing", title: "dropped", createdAt: at(1) },
        ],
        messages: [1, 2, 3, 4, 5].map((n) => ({ id: `m${n}`, channelId: n < 4 ? "c-general" : "c-release", role: "user", body: `hello ${n}`, createdAt: at(1) })),
      })
    );
    for (const [id, bullets, indexEntries] of [["asq_ava", 3, 0], ["asq_ben", 2, 2]]) {
      await mkdir(join(app, "agents", id, "profile"), { recursive: true });
      await mkdir(join(app, "agents", id, "memory"), { recursive: true });
      await writeFile(join(app, "agents", id, "profile", "MEMORY.md"), `# Memory\n\nDurable context for this squad member:\n\n${Array.from({ length: bullets }, (_, i) => `- note ${i + 1}`).join("\n")}\n\nSkill source: https://skilled.autohand.ai\n`);
      await writeFile(join(app, "agents", id, "memory", "index.json"), JSON.stringify({ version: 1, entries: Array.from({ length: indexEntries }, (_, i) => ({ id: `e${i}` })) }));
    }
    await mkdir(join(app, "agents", "observers", "x", "profile"), { recursive: true });
    await writeFile(join(app, "agents", "observers", "x", "profile", "MEMORY.md"), "- must not count\n");
    return {};
  },
});

let analyticsStub = null;
let daemonStub = null;
try {
  const squadDir = join(bridge.directory, "squad");

  await check("GET /api/analytics (bridge fallback) carries byMember, byModel, byDay and keeps the old fields", async () => {
    const response = await bridge.api("/api/analytics");
    assert.equal(response.status, 200);
    assert.equal(response.success, true);
    const { usage, work, services, telemetry } = response.data;
    assert.equal(response.data.source, "web-server-fallback");
    assert.ok(work && services && telemetry, "existing blocks still present");
    assert.equal(typeof usage.totalTokens, "number");
    assert.ok(Array.isArray(usage.topModels), "existing topModels kept");
    for (const [key, expected] of Object.entries(EXPECTED.byMember)) {
      const row = usage.byMember.find((item) => item.key === key);
      assert.ok(row, `byMember ${key}`);
      for (const [field, value] of Object.entries(expected)) assert.equal(row[field], value, `${key}.${field}`);
    }
    assert.equal(usage.byMember.find((row) => row.key === "asq_ghost").label, "asq_ghost", "unknown member shows its id");
    for (const [key, expected] of Object.entries(EXPECTED.byModel)) {
      const row = usage.byModel.find((item) => item.key === key);
      assert.ok(row, `byModel ${key}`);
      assert.equal(row.runs, expected.runs);
      assert.equal(row.totalTokens, expected.totalTokens);
    }
    assert.equal(usage.byDay.length, 3);
    assert.equal(usage.byDay.reduce((sum, row) => sum + row.totalTokens, 0), 2000);
    assert.equal(usage.byDay.reduce((sum, row) => sum + row.runs, 0), 6);
    assert.equal(usage.ledgerWindowDays, 30);
  });

  await check("GET /api/analytics (analytics-daemon path) gets the same breakdowns attached", async () => {
    analyticsStub = await jsonServer({
      "GET /metrics": () => ({ success: true, generatedAt: "unix-ms:1", source: "analytics-daemon", usage: { totalRecords: 1, totalTokens: 4242, topModels: [] }, work: {}, services: {} }),
    });
    await writeFile(join(squadDir, "analytics.json"), JSON.stringify({ pid: process.pid, host: "127.0.0.1", port: analyticsStub.port, url: `http://127.0.0.1:${analyticsStub.port}` }));
    const response = await bridge.api("/api/analytics");
    assert.equal(response.data.source, "analytics-daemon");
    assert.equal(response.data.usage.totalTokens, 4242, "daemon's own usage fields untouched");
    assert.equal(response.data.usage.byMember.find((row) => row.key === "asq_ava").totalTokens, 800);
    assert.equal(response.data.usage.byDay.length, 3);
    // Second call is served from the ledger cache (same telemetry stat); the
    // daemon stub is hit again because its snapshot is not cached.
    const again = await bridge.api("/api/analytics");
    assert.equal(again.data.usage.byMember.length, 3);
    assert.equal(analyticsStub.hits["GET /metrics"], 2);
    await rm(join(squadDir, "analytics.json"), { force: true });
    assert.equal((await bridge.api("/api/analytics")).data.source, "web-server-fallback");
  });

  await check("GET /api/system/summary counts seeded members, channels, threads, messages and memory", async () => {
    const response = await bridge.api("/api/system/summary");
    assert.equal(response.status, 200, JSON.stringify(response));
    const data = response.data;
    assert.equal(data.members, 2);
    assert.equal(data.channels, 2);
    assert.equal(data.threads, 3, "thread for a missing channel is not counted");
    assert.equal(data.messages, 5);
    assert.equal(data.memoryEntries, 3 + 2 + 2, "MEMORY.md bullets plus index entries; observers skipped");
    assert.equal(data.memoryDocuments, 2);
    assert.equal(data.dataFolder, squadDir);
    assert.equal(data.memberStateFolder, join(bridge.directory, "app"));
    assert.ok(data.revealLabel, "reveal label present");
  });

  await check("memory count reads what is really on disk", async () => {
    const counted = await countMemoryEntries(join(bridge.directory, "app", "agents"));
    assert.deepEqual(counted, { memoryEntries: 7, memoryDocuments: 2, members: 2 });
  });

  await check("auto-check switch round trip and the update checker honours it", async () => {
    daemonStub = await jsonServer({
      "GET /health": () => ({ ok: true }),
      "POST /updates/check": () => ({ success: true, checkedAt: "unix-ms:1790000000000", updateAvailable: false, latestAllowedVersion: "0.1.6", source: "github:autohandai/squad" }),
    });
    await writeFile(join(squadDir, "daemon.json"), JSON.stringify({ pid: process.pid, host: "127.0.0.1", port: daemonStub.port, url: `http://127.0.0.1:${daemonStub.port}/` }));

    const initial = await bridge.api("/api/system/settings");
    assert.equal(initial.data.autoCheckUpdates, true, "default on");

    const bad = await bridge.api("/api/system/settings", "PUT", { autoCheckUpdates: "nope" });
    assert.equal(bad.status, 400);

    const off = await bridge.api("/api/system/settings", "PUT", { autoCheckUpdates: false });
    assert.equal(off.status, 200);
    assert.equal(off.data.autoCheckUpdates, false);
    assert.equal((await bridge.api("/api/system/settings")).data.autoCheckUpdates, false);
    assert.equal(JSON.parse(await readFile(join(squadDir, "settings.json"), "utf8")).autoCheckUpdates, false, "persisted in settings.json");

    const unattended = await bridge.api("/api/updates");
    assert.equal(unattended.status, 200);
    assert.equal(unattended.data.autoCheck, false);
    assert.equal(unattended.data.skipped, true);
    assert.equal(unattended.data.status, "never-checked");
    assert.equal(daemonStub.hits["POST /updates/check"] || 0, 0, "no repository check while off");

    const manual = await bridge.api("/api/updates?refresh=1");
    assert.equal(manual.data.status, "up-to-date");
    assert.equal(manual.data.skipped, false);
    assert.equal(daemonStub.hits["POST /updates/check"], 1, "manual check always runs");

    const on = await bridge.api("/api/system/settings", "PUT", { autoCheckUpdates: true });
    assert.equal(on.data.autoCheckUpdates, true);
    const unattendedOn = await bridge.api("/api/updates");
    assert.equal(unattendedOn.data.autoCheck, true);
    assert.equal(daemonStub.hits["POST /updates/check"], 2, "unattended check runs again once on");
  });

  await check("route plug-in loaded and no bridge errors from this lane", async () => {
    assert.match(bridge.logs, /route plug-ins:.*system/);
    assert.doesNotMatch(bridge.logs, /system\.route\.mjs failed to load/);
  });
} finally {
  analyticsStub?.server.close();
  daemonStub?.server.close();
  await bridge.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\ncheck:usage-and-system passed");
