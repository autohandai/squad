#!/usr/bin/env node
// What to ask a member, built from that member's own role and skills. The
// chat used to offer the same three frontend prompts to everyone, so a data
// engineer was invited to check a component for responsive issues.
//
// See docs/adrs/ADR-0032-member-suggestions.md.

import assert from "node:assert/strict";

import { SUGGESTION_LIMIT, readableSkill, suggestionsFor } from "../src/lib/member-suggestions.js";

const dataEngineer = {
  name: "Delta",
  role: "Data Engineer",
  skills: [{ name: "sql-query-optimisation" }, { name: "pipeline-observability" }, { name: "schema-migrations" }],
  workspace: "/Users/x/warehouse",
};
const frontend = {
  name: "Pica",
  role: "Frontend Developer",
  skills: [{ name: "react-component-architecture" }, { name: "tailwind-ui-patterns" }],
  workspace: "/Users/x/web",
};

// --- the suggestions belong to the member ---------------------------------

{
  const asks = suggestionsFor(dataEngineer);
  assert.equal(asks.length, SUGGESTION_LIMIT, "always the same number of prompts");
  const joined = asks.join(" ").toLowerCase();
  assert.match(joined, /data engineer/, "the role appears");
  assert.match(joined, /sql query optimisation/, "the member's top skill appears, readable");
  assert.doesNotMatch(joined, /responsive|accessibility|component/, "no frontend prompts for a data engineer");
}

{
  const asks = suggestionsFor(frontend);
  const joined = asks.join(" ").toLowerCase();
  assert.match(joined, /frontend developer/);
  assert.match(joined, /react component architecture/);
  assert.doesNotMatch(joined, /sql|pipeline/, "no data prompts for a frontend developer");
}

{
  // Two different members never get the same list.
  const a = suggestionsFor(dataEngineer).join("|");
  const b = suggestionsFor(frontend).join("|");
  assert.notEqual(a, b, "suggestions differ by member");
}

// --- the workspace is named when there is one -----------------------------

{
  const asks = suggestionsFor(dataEngineer);
  assert.match(asks.join(" "), /warehouse/, "the project folder is named, not a placeholder");
}

{
  const asks = suggestionsFor({ ...dataEngineer, workspace: "" });
  assert.doesNotMatch(asks.join(" "), /undefined|\{|\}/, "no placeholder leaks when there is no workspace");
  assert.equal(asks.length, SUGGESTION_LIMIT);
}

// --- a member with nothing configured still gets something usable ---------

for (const bare of [{}, { role: "" }, { name: "X" }, null, undefined, "nonsense", 42]) {
  const asks = suggestionsFor(bare);
  assert.equal(asks.length, SUGGESTION_LIMIT, `three prompts for ${JSON.stringify(bare)}`);
  for (const ask of asks) {
    assert.equal(typeof ask, "string");
    assert.ok(ask.trim().length > 10, "a prompt is a sentence");
    assert.doesNotMatch(ask, /undefined|null|\[object|\{\w+\}/, `no leaked internals in: ${ask}`);
  }
}

{
  // No skills: the role alone still carries the prompts.
  const asks = suggestionsFor({ role: "Security Reviewer", skills: [] });
  assert.match(asks.join(" ").toLowerCase(), /security reviewer/);
}

// --- skill slugs read as English ------------------------------------------

assert.equal(readableSkill("react-component-architecture"), "react component architecture");
assert.equal(readableSkill("sql_query_optimisation"), "sql query optimisation");
assert.equal(readableSkill({ name: "schema-migrations" }), "schema migrations");
assert.equal(readableSkill(""), "");
assert.equal(readableSkill(null), "");
assert.equal(readableSkill({ id: "cost-review" }), "cost review", "an id works when there is no name");

console.log("check-member-suggestions: ok");

// --- what the member can do now leads (ADR-0265) ----------------------------
{
  const chief = { name: "Chief of Staff", role: "Chief of Staff", workspace: "/x/squad-test" };
  const bare = suggestionsFor(chief, { day: 0 });
  assert.match(bare[0], /Propose a team|connect/i, "a Chief of Staff with nothing around it offers to build the team or connect tools");
  const busy = suggestionsFor(chief, { day: 0, connectors: [{ name: "Gmail" }], squad: ["Chief of Staff", "Tatiana", "Eva"],
    recentWork: [{ title: "Ship the pricing page", status: "failed", memberName: "Tatiana" }, { title: "Weekly metrics", status: "completed", memberName: "Eva" }] });
  assert.match(busy[0], /Ship the pricing page.*didn’t finish for Tatiana/, "failed work leads");
  assert.ok(busy.some((ask) => /Weekly metrics/.test(ask)), "recent work is followed up");
  assert.equal(new Set(busy).size, busy.length, "no repeats");
  const withMail = suggestionsFor({ role: "Assistant" }, { day: 0, connectors: [{ name: "Gmail" }] });
  assert.match(withMail[0], /unread email/, "a connector turns into something to ask for");
  const monday = suggestionsFor(chief, { day: 1, connectors: [{ name: "Gmail" }, { name: "GitHub" }], squad: ["Tatiana", "Eva"] });
  const tuesday = suggestionsFor(chief, { day: 2, connectors: [{ name: "Gmail" }, { name: "GitHub" }], squad: ["Tatiana", "Eva"] });
  assert.notDeepEqual(monday, tuesday, "the list changes from day to day");
  assert.ok(monday.join(" ").includes("Tatiana and Eva"), "names read as a sentence");
  console.log("check-member-suggestions: context ok");
}
