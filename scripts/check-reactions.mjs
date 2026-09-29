#!/usr/bin/env node
// Checks for reaction emoji and reaction-started flows (src/lib/reactions.js,
// ADR-0053): the picker is well formed and unambiguous, search finds an emoji
// by name, and a reaction turns into a workflow the normal save path accepts.

import assert from "node:assert/strict";

import {
  ALL_REACTIONS,
  QUICK_REACTIONS,
  REACTION_ACTIONS,
  REACTION_GROUPS,
  flowsForReaction,
  reactionFlowDraft,
  reactionName,
  searchReactions,
  stepKindForAction,
} from "../src/lib/reactions.js";
import { validateWorkflow } from "../src/lib/workflows.js";

// The picker is data, and data that is wrong here is wrong on every message.
assert.ok(REACTION_GROUPS.length >= 8, `groups: ${REACTION_GROUPS.length}`);
assert.ok(ALL_REACTIONS.length >= 400, `the owner asked for lots: ${ALL_REACTIONS.length}`);
for (const group of REACTION_GROUPS) {
  assert.ok(group.id && group.label, `group without a name: ${JSON.stringify(group)}`);
  assert.ok(group.items.length, `${group.id} is empty`);
  for (const [emoji, name] of group.items) {
    assert.ok(emoji, `${group.id} has an entry with no emoji`);
    assert.ok(name && !name.includes(" "), `${group.id}/${emoji} needs a one-word name, got "${name}"`);
    assert.equal(name, name.toLowerCase(), `${group.id}/${emoji} name must be lowercase to be searchable`);
  }
}
// One emoji, one meaning: a duplicate makes reactionName depend on group order.
assert.equal(ALL_REACTIONS.length, new Set(ALL_REACTIONS).size, "an emoji appears in two groups");
// The hover row is part of the picker, so the two never disagree.
for (const emoji of QUICK_REACTIONS) assert.ok(ALL_REACTIONS.includes(emoji), `${emoji} is on the row but not in the picker`);

assert.equal(reactionName("🐛"), "bug");
assert.equal(reactionName("🦕"), "🦕", "an unknown emoji names itself");
assert.deepEqual(searchReactions("").length, REACTION_GROUPS.length, "an empty query hides nothing");
const bugs = searchReactions("bug").flatMap((group) => group.items.map(([emoji]) => emoji));
assert.deepEqual(bugs, ["🐛"], `search bug: ${bugs}`);
assert.ok(searchReactions("fire").flatMap((group) => group.items).length >= 2, "substring search finds firetruck too");
assert.deepEqual(
  searchReactions("🚀").flatMap((group) => group.items.map(([emoji]) => emoji)),
  ["🚀"],
  "an emoji finds itself"
);
assert.deepEqual(searchReactions("zzzz"), [], "no match is no groups, not empty groups");

// The lazy way: a reaction becomes a workflow the save path already accepts.
assert.deepEqual(REACTION_ACTIONS, ["prompt", "member", "url"]);
assert.equal(stepKindForAction("url"), "http");
assert.equal(stepKindForAction("member"), "member");
assert.equal(stepKindForAction("anything else"), "member");

const asked = reactionFlowDraft({ emoji: "👀", action: "member", memberId: "iris", prompt: "Review {{message}}" });
assert.deepEqual(asked.problems, [], JSON.stringify(asked.problems));
assert.equal(asked.draft.trigger.type, "reaction");
assert.equal(asked.draft.trigger.emoji, "👀");
assert.equal(asked.draft.name, "eyes asks a member", asked.draft.name);
assert.equal(asked.draft.steps[0].kind, "member");
assert.equal(asked.draft.steps[0].prompt, "Review {{message}}");
assert.deepEqual(validateWorkflow(asked.draft), [], "the draft passes the same validation the sheet uses");

const called = reactionFlowDraft({ emoji: "🚀", action: "url", url: "https://deploy.test/go", method: "PUT", name: "Ship it" });
assert.deepEqual(called.problems, []);
assert.equal(called.draft.name, "Ship it", "a given name wins over the default");
assert.equal(called.draft.steps[0].kind, "http");
assert.equal(called.draft.steps[0].method, "PUT");

// A half-filled draft says what is missing instead of saving something broken.
assert.deepEqual(reactionFlowDraft({ emoji: "🚀", action: "url", url: "" }).problems, ["step.url"]);
assert.deepEqual(reactionFlowDraft({ emoji: "🚀", action: "url", url: "file:///etc/passwd" }).problems, ["step.url"]);
assert.deepEqual(reactionFlowDraft({ emoji: "👀", action: "prompt", memberId: "", prompt: "" }).problems, ["step.memberId", "step.prompt"]);

// Which flows already listen for an emoji, so the picker can say so.
const flows = [
  { id: "a", trigger: { type: "reaction", emoji: "🚀" } },
  { id: "b", trigger: { type: "reaction", emoji: "👀" } },
  { id: "c", trigger: { type: "message", pattern: "deploy" } },
];
assert.deepEqual(flowsForReaction(flows, "🚀").map((flow) => flow.id), ["a"]);
assert.deepEqual(flowsForReaction(flows, "🎉"), []);
assert.deepEqual(flowsForReaction(flows, ""), [], "no emoji matches nothing, not everything");

console.log(`check-reactions: ok (${ALL_REACTIONS.length} emoji in ${REACTION_GROUPS.length} groups)`);
