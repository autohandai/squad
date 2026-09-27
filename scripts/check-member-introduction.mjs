#!/usr/bin/env node
// A new member's first message: what it is going to do, in its own voice,
// composed from its actual configuration. Not asked of a model, so it cannot
// promise something the member is not set up to do, and it is there the
// instant the member exists.
//
// See docs/adrs/ADR-0034-member-introduction.md.

import assert from "node:assert/strict";

import { introductionFor, roleFromDescription } from "../src/lib/member-introduction.js";

const chief = {
  name: "Avery",
  role: "Chief of Staff",
  description: "Keeps every member busy and routes idle capacity at new opportunities.",
  skills: [{ name: "delegation" }, { name: "capacity-planning" }, { name: "pull-request-review" }],
  workspace: "/Users/x/autohand",
  brainCard: {
    purpose: "Keep the squad busy on the highest value work.",
    escalationRules: "Ask before merging anything a human has not approved.",
  },
};

// --- what it says ----------------------------------------------------------

{
  const text = introductionFor(chief);
  assert.ok(text.length > 40, "it is a real message, not a label");
  // Mid-sentence the role reads as "your chief of staff", so match loosely.
  assert.match(text, /chief of staff/i, "it says what it is");
  assert.match(text, /autohand/, "it names where it works");
  assert.match(text, /delegation/, "it says what it brings");
  assert.match(text, /merging/, "it says when it will stop and ask");
  assert.doesNotMatch(text, /undefined|\[object|\{\w+\}/, "no leaked internals");
}

{
  // Every member gets something usable, however bare.
  for (const bare of [{}, { name: "X" }, { role: "QA" }, null, undefined, 42, "text"]) {
    const text = introductionFor(bare);
    assert.equal(typeof text, "string");
    assert.ok(text.trim().length > 20, `a usable message for ${JSON.stringify(bare)}`);
    assert.doesNotMatch(text, /undefined|\[object|\{\w+\}/, `no leaked internals for ${JSON.stringify(bare)}`);
  }
}

{
  // No skills and no brain card: it still says what it is and where.
  const text = introductionFor({ name: "Wren", role: "QA Engineer", workspace: "/a/b/checkout" });
  assert.match(text, /QA Engineer/, "an acronym keeps its case");
  assert.match(text, /checkout/);
}

{
  // Two members do not say the same thing.
  const a = introductionFor(chief);
  const b = introductionFor({ name: "Wren", role: "QA Engineer", skills: [{ name: "end-to-end tests" }] });
  assert.notEqual(a, b);
}

// --- rescuing a role from a description -----------------------------------

assert.equal(
  roleFromDescription("Chief of staff, controls everyone working on anything and delegates"),
  "Chief of Staff",
  "the leading phrase becomes the role, with connectors left lower case"
);
assert.equal(roleFromDescription("a data engineer who owns our warehouse"), "Data Engineer");
assert.equal(roleFromDescription("Someone who reviews Terraform"), "", "a description with no role in front gives nothing");
assert.equal(roleFromDescription(""), "");
assert.equal(roleFromDescription(null), "");
assert.ok(roleFromDescription("x".repeat(300)).length <= 80, "a role stays short");

console.log("check-member-introduction: ok");
