#!/usr/bin/env node
// What a member has to report when you open its chat. Built from the audit
// trail (ADR-0018), never invented: every line is something that actually
// happened and can be traced back to a record.
//
// See docs/adrs/ADR-0028-member-briefing.md.

import assert from "node:assert/strict";

import { buildBriefing, briefingContext, hasNews } from "../src/lib/member-briefing.js";

const copy = {};
const since = "2026-09-01T00:00:00.000Z";
const record = (over) => ({ id: `r${Math.random()}`, kind: "run", summary: "", at: "2026-09-02T10:00:00.000Z", refs: {}, ...over });

// --- nothing to say --------------------------------------------------------

{
  const briefing = buildBriefing([], { since, copy });
  assert.equal(hasNews(briefing), false, "no records is no news");
  assert.deepEqual(briefing.lines, []);
  assert.equal(briefingContext(briefing), "", "nothing to tell the member either");
}

{
  // Records older than the last visit are not news.
  const stale = [record({ at: "2026-08-01T00:00:00.000Z", summary: "Ran the suite" })];
  assert.equal(hasNews(buildBriefing(stale, { since, copy })), false, "records before the cutoff are not news");
}

// --- work it did -----------------------------------------------------------

{
  const records = [
    record({ kind: "run", summary: "Fixed the flaky CI job" }),
    record({ kind: "run", summary: "Updated the release notes" }),
    record({ kind: "run", summary: "Run failed: the build needs Node 24", status: "failed" }),
  ];
  const briefing = buildBriefing(records, { since, copy });
  assert.equal(hasNews(briefing), true);
  const runs = briefing.lines.find((line) => line.kind === "run");
  assert.ok(runs, "runs are reported");
  assert.match(runs.text, /3/, "the count is the headline");
  assert.match(runs.text, /1 failed/, "failures are called out, not hidden");
}

// --- what it learned -------------------------------------------------------

{
  const records = [
    record({ kind: "skill", summary: "Added the skill Playwright screenshots" }),
    record({ kind: "memory", summary: "Learned: the build needs Node 24, not 26" }),
  ];
  const briefing = buildBriefing(records, { since, copy });
  const skill = briefing.lines.find((line) => line.kind === "skill");
  const memory = briefing.lines.find((line) => line.kind === "memory");
  assert.ok(skill, "a new skill is news");
  assert.match(skill.text, /Playwright screenshots/, "the skill is named");
  assert.ok(memory, "a new memory is news");
  assert.match(memory.text, /Node 24/, "the lesson is quoted, not summarised away");
}

// --- files and commands ----------------------------------------------------

{
  const records = [
    record({ kind: "edit", summary: "Edited src/App.jsx", refs: { path: "src/App.jsx" } }),
    record({ kind: "edit", summary: "Edited src/App.jsx", refs: { path: "src/App.jsx" } }),
    record({ kind: "edit", summary: "Edited server.mjs", refs: { path: "server.mjs" } }),
  ];
  const briefing = buildBriefing(records, { since, copy });
  const edits = briefing.lines.find((line) => line.kind === "edit");
  assert.match(edits.text, /2 files/, "the same file twice is one file");
}

// --- ordering and size -----------------------------------------------------

{
  const records = [
    record({ kind: "run", summary: "a" }),
    record({ kind: "skill", summary: "Added the skill X" }),
    record({ kind: "memory", summary: "Learned: y" }),
    record({ kind: "edit", summary: "Edited a.js", refs: { path: "a.js" } }),
    record({ kind: "shell", summary: "Ran bun test" }),
    record({ kind: "handoff", summary: "Handed off z" }),
  ];
  const briefing = buildBriefing(records, { since, copy });
  // What it learned leads: it is the part a person cannot see anywhere else.
  assert.equal(briefing.lines[0].kind, "skill", "skills lead the briefing");
  assert.equal(briefing.lines[1].kind, "memory", "then what it learned");
  assert.ok(briefing.lines.length <= 5, "a briefing is short enough to read at a glance");
}

// --- the member's own copy of the facts ------------------------------------

{
  const records = [record({ kind: "skill", summary: "Added the skill Playwright screenshots" })];
  const briefing = buildBriefing(records, { since, copy });
  const context = briefingContext(briefing);
  assert.match(context, /Playwright screenshots/, "the member is told the same facts");
  assert.match(context, /do not invent/i, "and told not to embellish them");
}

// --- hostile input ---------------------------------------------------------

for (const bad of [null, undefined, "not an array", 42, [null], [{}]]) {
  const briefing = buildBriefing(bad, { since, copy });
  assert.ok(Array.isArray(briefing.lines), `lines is always an array for ${JSON.stringify(bad)}`);
  assert.equal(typeof briefingContext(briefing), "string", "context is always a string");
}

console.log("check-member-briefing: ok");
