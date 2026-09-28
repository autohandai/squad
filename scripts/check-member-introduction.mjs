#!/usr/bin/env node
// A new member's first message: what it is going to do, in its own voice,
// composed from its actual configuration. Not asked of a model, so it cannot
// promise something the member is not set up to do, and it is there the
// instant the member exists.
//
// See docs/adrs/ADR-0034-member-introduction.md.

import assert from "node:assert/strict";

import { inMemberVoice, introductionFor, roleFromDescription } from "../src/lib/member-introduction.js";

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

// --- the member speaks as itself ------------------------------------------
//
// The brain card is written to the member as "you", and a model fills every
// field that way. Quoting it verbatim had a new member introduce itself and
// then tell the user what the user does: "I'm Marcus, your Chief of Staff.
// You coordinate all squad work." Only the model path produces that, and
// before the designer's cold start was fixed the model path almost never ran,
// so this shipped unnoticed.

{
  const modelWritten = {
    name: "Marcus",
    role: "Chief of Staff",
    description: "Owns squad-wide coordination, task delegation, and work allocation.",
    skills: ["task delegation", "progress tracking"],
    workspace: "/Users/x/autohandSWE",
    brainCard: {
      purpose: "You coordinate all squad work by decomposing requests into tasks and assigning them to the right members.",
      escalationRules: "You escalate when a task exceeds a member's scope or requires authority you do not hold.",
    },
  };
  const text = introductionFor(modelWritten);
  // "your Chief of Staff" and "tell me what you need" are the app's own
  // framing and address the user correctly. What must never appear is the
  // user cast as the one doing the member's job, which is any "you" followed
  // by a verb in a sentence lifted out of the card.
  assert.doesNotMatch(text, /\byou (?:coordinate|escalate|own|use|receive|succeed|intake|triage|oversee)\b/i, "the member never casts the user as the one doing its job");
  assert.match(text, /I coordinate all squad work/, "its purpose is said in its own voice");
  assert.match(text, /authority I do not hold/, "a second pronoun in the same sentence flips too");
}

{
  // Verb agreement, contractions, and possessives.
  assert.equal(inMemberVoice("You are responsible for the release."), "I am responsible for the release.");
  assert.equal(inMemberVoice("You're the owner of your own queue."), "I'm the owner of my own queue.");
  assert.equal(inMemberVoice("You escalate anything outside your scope to yourself."), "I escalate anything outside my scope to myself.");
  // A card written in the third person or as an instruction is left alone,
  // which is what the deterministic fallback produces.
  const imperative = "Stop and ask when the change is destructive.";
  assert.equal(inMemberVoice(imperative), imperative);
  assert.equal(inMemberVoice("Keeps the squad busy on the highest value work."), "Keeps the squad busy on the highest value work.");
  assert.equal(inMemberVoice(""), "");
  assert.equal(inMemberVoice(null), "");
}

console.log("check-member-introduction: ok");
