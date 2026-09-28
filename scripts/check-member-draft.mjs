#!/usr/bin/env node
// Creating a squad member from a sentence. The shaping rules live in one pure
// module so the same draft comes out whether a model filled it in or the
// deterministic fallback did, and so a model can never hand back a member the
// app would choke on.
//
// See docs/adrs/ADR-0031-member-draft-skill.md.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { brainCardFields } from "../src/data.js";
import {
  MEMBER_DESIGNER_ID,
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

// --- the designer is not a member -----------------------------------------
//
// The bridge gives the designer no MCP servers, because it answers one
// question with JSON and cannot use a tool. Starting the user's servers was
// costing more than the designer's own twenty-second budget, so every custom
// role came back from the deterministic fallback with generic skills. That
// only holds while the bridge and this module agree on the designer's id, and
// nothing else would notice if they drifted: the strip would silently stop
// applying and the timeouts would quietly come back.

{
  assert.equal(MEMBER_DESIGNER_ID, "squad-designer", "the designer id is a wire value; changing it moves an agent home");

  const bridge = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const declaration = bridge.match(/const utilityAgentIds = new Set\(\[([^\]]*)\]\)/);
  assert.ok(declaration, "server.mjs declares utilityAgentIds");
  const ids = declaration[1].split(",").map((entry) => entry.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  assert.ok(ids.includes(MEMBER_DESIGNER_ID), `server.mjs treats ${MEMBER_DESIGNER_ID} as a utility agent, so it inherits no MCP servers`);

  const route = readFileSync(new URL("../server/routes/member-draft.route.mjs", import.meta.url), "utf8");
  assert.match(route, /MEMBER_DESIGNER_ID/, "the route uses the shared id rather than its own literal");
}

// --- the page does not promise a deadline the bridge will not keep ---------
//
// The wait tells the person when it will stop ("If nothing comes back by
// thirty seconds, this page fills itself in from your description instead").
// That sentence is the most useful thing on screen during the wait, and it is
// a lie the moment the route's ceiling moves without it.

{
  const route = readFileSync(new URL("../server/routes/member-draft.route.mjs", import.meta.url), "utf8");
  const ceiling = route.match(/const DRAFT_TIMEOUT_MS = ([\d_]+);/);
  assert.ok(ceiling, "the route declares DRAFT_TIMEOUT_MS");
  const seconds = Number(ceiling[1].replace(/_/g, "")) / 1000;

  const words = { 10: "ten", 15: "fifteen", 20: "twenty", 25: "twenty-five", 30: "thirty", 45: "forty-five", 60: "sixty" };
  const spoken = words[seconds];
  assert.ok(spoken, `add "${seconds}" to this check's word list, then say it on the page`);

  const locales = readFileSync(new URL("../src/locales.js", import.meta.url), "utf8");
  const promise = locales.match(/designStillAsking: "([^"]+)"/);
  assert.ok(promise, "src/locales.js carries the waiting promise");
  assert.ok(
    promise[1].includes(`${spoken} seconds`),
    `the page says "${promise[1]}" while the bridge gives up after ${seconds}s`
  );
}

// --- the brain card matches the form it fills ------------------------------
//
// The draft module used to keep its own copy of the brain card's field names,
// and the copy had drifted. It asked the model for "successCriteria", which
// the create form has no field for and silently discarded, and never asked
// for definitionOfDone, reviewStyle or memoryPolicy, so three of a designed
// member's seven fields arrived as generic boilerplate however specific the
// description was. Nothing failed; the member was just worse.

{
  const ids = brainCardFields.map((field) => field.id);
  const draft = draftFromDescription("Chief of staff, delegates work across the squad");
  assert.deepEqual(Object.keys(draft.brainCard).sort(), [...ids].sort(), "the draft carries exactly the form's fields");
  for (const id of ids) {
    assert.ok(draft.brainCard[id].length > 10, `the fallback fills ${id} rather than leaving the form to guess`);
  }

  const instruction = draftInstruction("Reviews our Terraform before it ships");
  for (const field of brainCardFields) {
    assert.match(instruction, new RegExp(field.id), `the model is asked for ${field.id}`);
    assert.ok(instruction.includes(field.prompt), `${field.id} is asked for in the form's own words`);
  }
  assert.doesNotMatch(instruction, /successCriteria/, "no field the form cannot show");

  // A model answering the shape it was asked for keeps every field.
  const merged = mergeModelDraft(draft, { brainCard: Object.fromEntries(ids.map((id) => [id, `model ${id}`])) });
  for (const id of ids) assert.equal(merged.brainCard[id], `model ${id}`, `${id} survives the merge`);
}

console.log("check-member-draft: ok");
