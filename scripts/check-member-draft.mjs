#!/usr/bin/env node
// Creating a squad member from a sentence. The shaping rules live in one pure
// module so the same draft comes out whether a model filled it in or the
// deterministic fallback did, and so a model can never hand back a member the
// app would choke on.
//
// See docs/adrs/ADR-0031-member-draft-skill.md.

import assert from "node:assert/strict";

import {
  DRAFT_FIELDS,
  draftFromDescription,
  draftInstruction,
  mergeModelDraft,
  normalizeDraft,
} from "../src/lib/member-draft.js";

// --- the deterministic fallback -------------------------------------------

{
  const draft = draftFromDescription("Someone who reviews my Terraform and keeps the AWS bill down");
  assert.ok(draft.name, "a member always gets a name");
  assert.ok(draft.role, "and a role");
  assert.ok(draft.description.length > 0, "and a description");
  for (const field of DRAFT_FIELDS) assert.ok(field in draft, `the draft carries ${field}`);
  assert.ok(Array.isArray(draft.skills));
  assert.ok(draft.brainCard && typeof draft.brainCard === "object");
}

{
  // The description is the source of truth for the role, not a generic label.
  const draft = draftFromDescription("I need someone to write and maintain our Playwright end to end tests");
  assert.match(`${draft.role} ${draft.description}`.toLowerCase(), /test|qa|quality/, "the role reflects what was asked for");
}

{
  const empty = draftFromDescription("");
  assert.ok(empty.name, "even an empty description produces something usable");
  assert.ok(empty.role);
}

for (const bad of [null, undefined, 42, {}, []]) {
  const draft = draftFromDescription(bad);
  assert.equal(typeof draft.name, "string", `name is a string for ${JSON.stringify(bad)}`);
  assert.equal(typeof draft.role, "string");
}

// --- normalising ----------------------------------------------------------

{
  const draft = normalizeDraft({
    name: "  Ada  ",
    role: "Security Reviewer\n",
    description: "Reviews changes for security problems.",
    skills: ["threat modelling", "threat modelling", "", null, "SAST"],
    brainCard: { purpose: "Find security problems early." },
  });
  assert.equal(draft.name, "Ada", "whitespace is trimmed");
  assert.equal(draft.role, "Security Reviewer", "newlines do not survive a single-line field");
  assert.deepEqual(draft.skills, ["threat modelling", "SAST"], "skills are deduped and emptied out");
  assert.equal(draft.brainCard.purpose, "Find security problems early.");
  for (const field of DRAFT_FIELDS) assert.ok(field in draft, `normalising fills ${field}`);
}

{
  // A model that returns nonsense must not produce a broken member.
  const draft = normalizeDraft({ name: 42, role: [], description: {}, skills: "not a list", brainCard: "nope" });
  assert.equal(typeof draft.name, "string");
  assert.equal(typeof draft.role, "string");
  assert.deepEqual(draft.skills, []);
  assert.equal(typeof draft.brainCard, "object");
}

{
  // Names are for a sidebar row, not an essay.
  const draft = normalizeDraft({ name: "x".repeat(400), role: "y".repeat(400) });
  assert.ok(draft.name.length <= 60, "a name stays short");
  assert.ok(draft.role.length <= 80, "a role stays short");
}

// --- merging what a model returned ----------------------------------------

{
  const fallback = draftFromDescription("Someone to review Terraform");
  const merged = mergeModelDraft(fallback, { name: "Sky", skills: ["terraform", "aws"] });
  assert.equal(merged.name, "Sky", "the model's name wins when it gave one");
  assert.deepEqual(merged.skills, ["terraform", "aws"], "and its skills");
  assert.equal(merged.role, fallback.role, "fields it left out keep the fallback");
}

{
  const fallback = draftFromDescription("Someone to review Terraform");
  for (const bad of [null, undefined, "text", 7, []]) {
    const merged = mergeModelDraft(fallback, bad);
    assert.deepEqual(merged, fallback, `nothing usable means the fallback stands (${JSON.stringify(bad)})`);
  }
}

{
  // An empty string from the model is not an answer; keep the fallback.
  const fallback = draftFromDescription("Someone to review Terraform");
  const merged = mergeModelDraft(fallback, { name: "   ", role: "" });
  assert.equal(merged.name, fallback.name);
  assert.equal(merged.role, fallback.role);
}

// --- the instruction handed to the model ----------------------------------

{
  const instruction = draftInstruction("Someone who keeps our AWS bill down");
  assert.match(instruction, /AWS bill/, "the person's words are quoted to the model");
  assert.match(instruction, /JSON/i, "it asks for JSON");
  for (const field of ["name", "role", "description", "skills", "brainCard"]) {
    assert.match(instruction, new RegExp(field), `it names the ${field} field`);
  }
  assert.ok(instruction.length < 4000, "the instruction stays small");
}

console.log("check-member-draft: ok");
