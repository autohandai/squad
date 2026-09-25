#!/usr/bin/env node
// Checks for cross-surface search (server/search/index.mjs,
// server/routes/search.route.mjs, src/lib/search-results.js): builds a
// ~50k-record index in a temp dir, asserts a query answers within budget and
// links to the right routes, that upserts and rebuilds are idempotent, that
// the LIKE fallback works when FTS5 is forced off, and that the route
// plug-in indexes bridge runs and channel messages.
//
//   node scripts/check-search.mjs            # FTS5 index + forced fallback
//   node scripts/check-search.mjs --no-fts   # fallback only (no FTS5 assertions)
//   SEARCH_CHECK_RECORDS=5000 node scripts/check-search.mjs

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSearchIndex, queryTerms, markSnippet, normalizeSearchDoc, SEARCH_TYPES } from "../server/search/index.mjs";
import * as searchRoute from "../server/routes/search.route.mjs";
import {
  RECENT_SEARCHES_KEY,
  RECENT_SEARCHES_LIMIT,
  availableTypes,
  flattenGroups,
  groupResults,
  mergeResults,
  moveSelection,
  parseTypes,
  pushRecentSearch,
  readRecentSearches,
  removeRecentSearch,
  snippetSegments,
  typeCounts,
  typeLabel,
} from "../src/lib/search-results.js";

const NO_FTS = process.argv.includes("--no-fts");
const RECORDS = Math.max(1000, Number(process.env.SEARCH_CHECK_RECORDS || 50_000));
const FTS_BUDGET_MS = 100;
const LIKE_BUDGET_MS = 400;

const WORDS = (
  "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu " +
  "deploy release branch commit review merge build lint format migrate schema index cache queue worker cron webhook token session cookie header footer sidebar dialog toast " +
  "typescript react vite tauri sqlite rust cargo bun node fetch stream socket process signal exit retry backoff timeout latency budget metric trace span log event " +
  "channel member handoff canvas workflow approval mention presence avatar profile settings appearance language runtime harness model provider workspace folder project"
).split(/\s+/);

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function routeFor(type, i) {
  switch (type) {
    case "message":
      return i % 2 ? `/channels/channel-${i % 40}?message=msg-${i}` : `/conversations/new?member=member-${i % 12}&message=msg-${i}`;
    case "channel":
      return `/channels/channel-${i}`;
    case "member":
      return `/conversations/new?member=member-${i}`;
    case "run":
      return `/mission-control?run=run-${i}`;
    case "task":
      return `/squad-members/member-${i % 12}/task?task=task-${i}`;
    case "handoff":
      return `/inbox?handoff=handoff-${i}`;
    case "canvas":
      return `/canvases/canvas-${i}`;
    case "workflow":
      return `/mission-control?workflow=wf-${i}`;
    default:
      return "/";
  }
}

function makeDocs(count) {
  const random = lcg(20260926);
  const docs = [];
  const base = Date.UTC(2026, 0, 1);
  for (let i = 0; i < count; i += 1) {
    const type = SEARCH_TYPES[i % SEARCH_TYPES.length];
    const words = [];
    const length = 6 + Math.floor(random() * 18);
    for (let w = 0; w < length; w += 1) words.push(WORDS[Math.floor(random() * WORDS.length)]);
    docs.push({
      id: `${type}:${i}`,
      type,
      title: `${type} ${i} ${words[0]} ${words[1]}`,
      body: words.join(" "),
      memberId: `member-${i % 12}`,
      channelId: type === "message" && i % 2 ? `channel-${i % 40}` : "",
      route: routeFor(type, i),
      at: new Date(base + i * 60_000).toISOString(),
    });
  }
  return docs;
}

const PLANTED = [
  { id: "message:planted", type: "message", title: "#general", body: "Eva: the smoke suite passed on main after the retry fix landed", channelId: "channel-1", memberId: "eva", route: "/channels/channel-1?message=planted", at: "2026-06-01T10:00:00Z" },
  { id: "run:planted", type: "run", title: "Run the smoke suite", body: "bun test --filter smoke\nstatus completed\n42 passed", runId: "run-planted", memberId: "eva", route: "/mission-control?run=run-planted", at: "2026-06-01T10:05:00Z" },
  { id: "handoff:planted", type: "handoff", title: "Handoff to Iris: review the smoke suite results", body: "Eva handed the smoke suite evidence to Iris for review", memberId: "iris", route: "/inbox?handoff=handoff-planted", at: "2026-06-01T10:10:00Z" },
];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function timeQuery(index, q, options, rounds = 7) {
  index.query(q, options); // warm the prepared statement and page cache
  const samples = [];
  for (let i = 0; i < rounds; i += 1) {
    const started = performance.now();
    index.query(q, options);
    samples.push(performance.now() - started);
  }
  return median(samples);
}

function exercise(index, label, docs, budgetMs) {
  const rebuilt = index.rebuild(docs);
  assert.equal(rebuilt.indexed, docs.length, `${label}: rebuild indexed every doc`);
  assert.equal(index.stats().total, docs.length, `${label}: stats total after rebuild`);

  const tookMs = timeQuery(index, "smoke suite", { limit: 40 });
  console.log(`${label}: "smoke suite" over ${docs.length} records in ${tookMs.toFixed(2)} ms (budget ${budgetMs} ms)`);
  assert.ok(tookMs < budgetMs, `${label}: query took ${tookMs.toFixed(2)} ms, budget ${budgetMs} ms`);

  const results = index.query("smoke suite", { limit: 40 });
  const byId = new Map(results.map((item) => [item.id, item]));
  for (const planted of PLANTED) {
    const hit = byId.get(planted.id);
    assert.ok(hit, `${label}: planted ${planted.id} found`);
    assert.equal(hit.route, planted.route, `${label}: ${planted.id} links to its surface`);
    assert.equal(hit.type, planted.type);
    assert.match(hit.snippet, /<mark>smoke<\/mark>/i, `${label}: snippet marks the hit (${hit.snippet})`);
  }
  assert.ok(results.every((item) => item.route && item.id && item.type && typeof item.score === "number"), `${label}: result shape`);
  assert.ok(results.length <= 40, `${label}: limit honoured`);

  const runsOnly = index.query("smoke suite", { types: "run" });
  assert.ok(runsOnly.length >= 1 && runsOnly.every((item) => item.type === "run"), `${label}: type filter`);
  assert.ok(runsOnly.some((item) => item.id === "run:planted"), `${label}: filtered run found`);
  const two = index.query("smoke", { types: ["run", "handoff"], limit: 5 });
  assert.ok(two.length <= 5 && two.every((item) => item.type === "run" || item.type === "handoff"), `${label}: multi-type filter`);

  const prefix = index.query("smok");
  assert.ok(prefix.some((item) => item.id === "message:planted"), `${label}: prefix match`);
  assert.deepEqual(index.query("   "), [], `${label}: blank query`);
  assert.deepEqual(index.query('"smoke" (suite*'), index.query("smoke suite"), `${label}: FTS punctuation is stripped, not executed`);
  // Operators are ordinary words: "smoke NOT suite" requires all three, so it
  // can never widen "smoke suite" the way an executed NOT / OR would.
  const smokeIds = new Set(index.query("smoke", { limit: 200 }).map((item) => item.id));
  for (const raw of ["smoke OR suite", "smoke NOT suite", "smoke AND suite"]) {
    const hits = index.query(raw);
    assert.ok(hits.every((item) => smokeIds.has(item.id)), `${label}: "${raw}" stays within the "smoke" hits`);
    assert.ok(hits.length <= 3, `${label}: "${raw}" is not executed as an operator`);
  }
  assert.deepEqual(index.query("smoke zzzqqqxxx"), [], `${label}: every term is required`);

  // Incremental upserts are idempotent.
  const before = index.stats().total;
  const again = index.upsert(PLANTED[0]);
  assert.equal(again.changed, 0, `${label}: unchanged upsert writes nothing`);
  assert.equal(index.stats().total, before, `${label}: unchanged upsert keeps the count`);
  const edited = index.upsert({ ...PLANTED[0], body: "the smoke suite is green and the banana build is fixed" });
  assert.equal(edited.changed, 1, `${label}: edited upsert writes once`);
  assert.equal(index.stats().total, before, `${label}: edited upsert keeps the count`);
  assert.ok(index.query("banana").some((item) => item.id === "message:planted"), `${label}: edited body is searchable`);
  index.upsert(PLANTED[0]);
  assert.equal(index.query("banana").length, 0, `${label}: old text is gone after re-upsert`);
  assert.equal(index.upsert({ id: "bad", type: "unknown", title: "x" }).skipped, 1, `${label}: unknown type skipped`);

  // Remove.
  assert.equal(index.remove("handoff:planted").removed, 1);
  assert.equal(index.get("handoff:planted"), null);
  assert.equal(index.stats().total, before - 1);
  index.upsert(PLANTED[2]);
  assert.equal(index.stats().total, before);

  // Rebuild is idempotent.
  const firstIds = index.query("smoke suite", { limit: 20 }).map((item) => item.id);
  index.rebuild(docs);
  index.rebuild(docs);
  assert.equal(index.stats().total, docs.length, `${label}: rebuild twice keeps one copy of each doc`);
  assert.deepEqual(index.query("smoke suite", { limit: 20 }).map((item) => item.id), firstIds, `${label}: rebuild twice gives the same results`);
  assert.ok(index.stats().rebuiltAt, `${label}: rebuiltAt recorded`);
  assert.deepEqual(Object.keys(index.stats().byType).sort(), [...SEARCH_TYPES].sort(), `${label}: every type counted`);
}

const docs = [...makeDocs(RECORDS), ...PLANTED];
const roots = [];
async function scratch(name) {
  const dir = await mkdtemp(join(tmpdir(), `squad-search-${name}-`));
  roots.push(dir);
  return dir;
}

try {
  // Pure helpers.
  assert.deepEqual(queryTerms('  Smoke  "Suite" *x* '), ["smoke", "suite", "x"]);
  assert.equal(markSnippet("the smoke suite passed", ["suite"]), "the smoke <mark>suite</mark> passed");
  assert.equal(normalizeSearchDoc({ id: "a", type: "run" }), null, "empty doc is rejected");
  assert.equal(normalizeSearchDoc({ id: "a", type: "Run", title: "T", at: "bad" }).type, "run");

  // FTS5 index.
  if (!NO_FTS) {
    const dir = await scratch("fts");
    const index = openSearchIndex(dir);
    assert.equal(index.mode, "fts5", "node:sqlite ships FTS5 (run with --no-fts to check only the fallback)");
    exercise(index, "fts5", docs, FTS_BUDGET_MS);
    index.close();
    const reopened = openSearchIndex(dir);
    assert.equal(reopened.mode, "fts5");
    assert.equal(reopened.stats().total, docs.length, "index persists across open/close");
    assert.ok(reopened.query("smoke suite").some((item) => item.id === "run:planted"), "reopened index answers");
    reopened.close();
  }

  // Forced fallback.
  {
    const dir = await scratch("like");
    const index = openSearchIndex(dir, { fts: false });
    assert.equal(index.mode, "like", "fts: false forces the LIKE fallback");
    exercise(index, "like", docs, LIKE_BUDGET_MS);
    index.close();
    const auto = openSearchIndex(dir);
    if (auto.mode === "fts5") assert.equal(auto.stats().total, 0, "a mode change resets the index so a rebuild repopulates it");
    auto.close();
  }

  // Route plug-in against a fake bridge context.
  {
    const dir = await scratch("route");
    const runs = new Map();
    const startedAt = "2026-06-01T09:00:00.000Z";
    runs.set("run-1", { id: "run-1", agentId: "eva", title: "Run the smoke suite", command: "bun test smoke", status: "completed", startedAt, finishedAt: "2026-06-01T09:05:00.000Z", logs: [{ line: "42 passed" }] });
    let channels = {
      channels: [{ id: "c1", name: "general", visibility: "public" }],
      messages: [{ id: "m1", channelId: "c1", agentId: "eva", body: "smoke suite is green on main", createdAt: startedAt }],
    };
    const events = new EventEmitter();
    const log = [];
    const ctx = {
      squadStateDir: dir,
      runs,
      events,
      readChannelsState: async () => channels,
      json: (res, status, payload) => {
        res.status = status;
        res.payload = payload;
      },
      readBody: async (req) => req.body || {},
      logEvent: (severity, message, attributes) => log.push({ severity, message, attributes }),
      SEVERITY: { DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17 },
    };
    async function call(method, path, body) {
      const req = { method, body };
      const res = {};
      const handled = await searchRoute.handle(req, res, new URL(`http://127.0.0.1${path}`), ctx);
      return { handled, ...res };
    }

    await searchRoute.init(ctx);
    assert.ok(searchRoute.getSearchIndex(), "init opened the index");
    assert.ok(log.some((entry) => entry.message === "search index ready"), "init logs readiness");

    const search = await call("GET", "/api/search?q=smoke%20suite");
    assert.equal(search.status, 200);
    assert.equal(search.payload.success, true);
    const ids = new Map(search.payload.data.results.map((item) => [item.id, item]));
    assert.equal(ids.get("run:run-1")?.route, "/mission-control?run=run-1", "bridge run is indexed with its Mission Control route");
    assert.equal(ids.get("message:m1")?.route, "/channels/c1?message=m1", "channel message is indexed with its channel route");
    assert.equal(ids.get("message:m1")?.title, "#general");
    assert.equal(ids.get("channel:c1"), undefined, "channel without the words is not a hit");
    assert.ok(typeof search.payload.data.tookMs === "number");

    const channelHit = await call("GET", "/api/search?q=general&types=channel");
    assert.deepEqual(channelHit.payload.data.results.map((item) => item.id), ["channel:c1"]);

    const pushed = await call("POST", "/api/search/index", { docs: [{ id: "task:t1", type: "task", title: "Fix the smoke suite flake", body: "retry on timeout", route: "/squad-members/eva/task?task=t1", at: startedAt }] });
    assert.equal(pushed.payload.data.indexed, 1);
    assert.ok((await call("GET", "/api/search?q=flake")).payload.data.results.some((item) => item.id === "task:t1"), "pushed doc is searchable");
    assert.equal((await call("POST", "/api/search/index", {})).status, 400, "empty push is rejected");

    runs.set("run-2", { id: "run-2", agentId: "kai", title: "Deploy pie shop", command: "make deploy", status: "failed", startedAt, finishedAt: startedAt, logs: ["port 4173 busy"] });
    events.emit("run.finished", { runId: "run-2", memberId: "kai", status: "failed", at: startedAt });
    const busy = await call("GET", "/api/search?q=busy");
    assert.equal(busy.payload.data.results[0]?.id, "run:run-2", "run.finished indexes the run with its log tail");

    channels = { ...channels, messages: [...channels.messages, { id: "m2", channelId: "c1", agentId: "kai", body: "pie shop is served on 4174", createdAt: startedAt }] };
    events.emit("chat.finished", { memberId: "kai", status: "completed", channelId: "c1", at: startedAt });
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.ok((await call("GET", "/api/search?q=served")).payload.data.results.some((item) => item.id === "message:m2"), "chat.finished refreshes channel messages");

    const stats = await call("GET", "/api/search/stats");
    assert.equal(stats.payload.data.total, 6, `stats total (${JSON.stringify(stats.payload.data.byType)})`);

    const rebuilt = await call("POST", "/api/search/rebuild", { docs: [{ id: "member:eva", type: "member", title: "Eva", body: "QA engineer", route: "/conversations/new?member=eva" }] });
    assert.equal(rebuilt.payload.data.total, 6, "rebuild keeps bridge docs and the pushed docs, drops the stale task");
    assert.equal((await call("GET", "/api/search?q=flake")).payload.data.results.length, 0, "task not pushed on rebuild is gone");
    assert.equal((await call("POST", "/api/search/remove", { ids: ["member:eva"] })).payload.data.removed, 1);
    assert.equal((await call("GET", "/api/other")).handled, false, "other routes are not ours");
    searchRoute.getSearchIndex().close();
  }

  // Browser-side helpers.
  {
    const results = [
      { id: "run:1", type: "run", title: "a" },
      { id: "message:1", type: "message", title: "b" },
      { id: "message:2", type: "message", title: "c" },
      { id: "task:1", type: "task", title: "d" },
      { id: "x", type: "nope", title: "e" },
    ];
    assert.deepEqual(typeCounts(results), { run: 1, message: 2, task: 1 });
    assert.deepEqual(availableTypes(results), ["message", "run", "task"]);
    const groups = groupResults(results, { perType: 1 });
    assert.deepEqual(groups.map((group) => [group.type, group.count, group.items.length]), [["message", 2, 1], ["run", 1, 1], ["task", 1, 1]]);
    assert.deepEqual(groupResults(results, { activeType: "message" }).map((group) => group.items.length), [2]);
    assert.deepEqual(flattenGroups(groups).map((item) => item.id), ["message:1", "run:1", "task:1"]);
    assert.equal(moveSelection(0, 1, 3), 1);
    assert.equal(moveSelection(2, 1, 3), 0);
    assert.equal(moveSelection(0, -1, 3), 2);
    assert.equal(moveSelection(-1, 1, 3), 0);
    assert.equal(moveSelection(0, 1, 0), -1);
    assert.deepEqual(mergeResults([{ id: "channel:c1", type: "channel" }, { id: "run:1", type: "run" }], [{ id: "channel:c1", type: "channel", local: true }]).map((item) => `${item.id}${item.local ? "*" : ""}`), ["channel:c1*", "run:1"]);
    assert.deepEqual(snippetSegments("a <mark>b</mark> c"), [{ text: "a ", hit: false }, { text: "b", hit: true }, { text: " c", hit: false }]);
    assert.deepEqual(snippetSegments("plain"), [{ text: "plain", hit: false }]);
    assert.deepEqual(parseTypes("run, Task,bogus"), ["run", "task"]);
    assert.equal(typeLabel("workflow"), "Workflow runs");
    assert.equal(typeLabel("message", { messages: "Mensagens" }), "Mensagens");
    assert.equal(typeLabel("message", { searchTypeMessage: "Msgs", messages: "Mensagens" }), "Msgs");

    const store = new Map();
    const storage = { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
    assert.deepEqual(readRecentSearches(storage), []);
    for (let i = 0; i < RECENT_SEARCHES_LIMIT + 3; i += 1) pushRecentSearch(`query ${i}`, storage);
    const recent = readRecentSearches(storage);
    assert.equal(recent.length, RECENT_SEARCHES_LIMIT, "ring buffer is capped");
    assert.equal(recent[0], `query ${RECENT_SEARCHES_LIMIT + 2}`, "newest first");
    pushRecentSearch("QUERY 5", storage);
    assert.equal(readRecentSearches(storage)[0], "QUERY 5", "repeat moves to the front");
    assert.equal(readRecentSearches(storage).filter((item) => item.toLowerCase() === "query 5").length, 1, "case-insensitive dedupe");
    assert.deepEqual(pushRecentSearch("x", storage), readRecentSearches(storage), "one-character queries are not recorded");
    removeRecentSearch("query 5", storage);
    assert.ok(!readRecentSearches(storage).some((item) => item.toLowerCase() === "query 5"));
    assert.ok(store.has(RECENT_SEARCHES_KEY));
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    assert.deepEqual(readRecentSearches(broken), []);
    assert.deepEqual(pushRecentSearch("still fine", broken), ["still fine"], "storage errors are swallowed");
    assert.deepEqual(readRecentSearches(null), []);
  }

  console.log(`check:search ok (${RECORDS} generated records${NO_FTS ? ", fallback only" : ""})`);
} finally {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
}
