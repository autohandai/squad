#!/usr/bin/env node
// The chief of staff reviews a member against what it actually did and
// proposes a small number of concrete improvements. Every proposal must be
// defensible from the record: no proposal without evidence.
//
// See docs/adrs/ADR-0029-chief-of-staff.md.

import assert from "node:assert/strict";

import {
  MIN_FAILURES_TO_REFINE,
  MIN_FAILURES_TO_REMEMBER,
  MIN_RUNS_TO_LEARN,
  STALE_MEMORY_DAYS,
  applyProposal,
  proposalSummary,
  reviewMember,
} from "../src/lib/chief-of-staff.js";

const now = new Date("2026-09-27T12:00:00.000Z");
const ago = (days) => new Date(now.getTime() - days * 86_400_000).toISOString();
const record = (over) => ({ id: `r${Math.random()}`, kind: "run", summary: "", at: ago(1), refs: {}, ...over });
const member = (over) => ({ id: "m1", name: "Noah", skills: [], memory: [], ...over });

// --- a quiet member gets left alone ---------------------------------------

{
  const review = reviewMember({ agent: member(), records: [], now });
  assert.deepEqual(review.proposals, [], "nothing happened, so nothing to propose");
  assert.equal(review.hasWork, false);
}

{
  // One failure is bad luck. It is not a lesson yet.
  const records = [record({ kind: "run", status: "failed", summary: "Run failed: the build needs Node 24" })];
  const review = reviewMember({ agent: member(), records, now });
  assert.equal(review.proposals.length, 0, "a single failure is not a pattern");
}

// --- a repeated failure becomes something to remember ----------------------

{
  const failure = "Run failed: the build needs Node 24";
  const records = Array.from({ length: MIN_FAILURES_TO_REMEMBER }, () => record({ kind: "run", status: "failed", summary: failure }));
  const review = reviewMember({ agent: member(), records, now });
  const proposal = review.proposals.find((item) => item.kind === "memory.add");
  assert.ok(proposal, "a repeated failure is worth remembering");
  assert.match(proposal.text, /Node 24/, "the lesson quotes the failure");
  assert.equal(proposal.evidence.count, MIN_FAILURES_TO_REMEMBER, "the proposal carries its evidence");
  assert.equal(review.hasWork, true);
}

{
  // Already remembered: do not propose it again.
  const failure = "Run failed: the build needs Node 24";
  const records = Array.from({ length: MIN_FAILURES_TO_REMEMBER + 2 }, () => record({ kind: "run", status: "failed", summary: failure }));
  const agent = member({ memory: [{ id: "k1", text: "The build needs Node 24, not 26" }] });
  const review = reviewMember({ agent, records, now });
  assert.equal(review.proposals.filter((item) => item.kind === "memory.add").length, 0, "a lesson already learned is not proposed twice");
}

// --- a routine it repeats becomes a skill ---------------------------------

{
  const records = Array.from({ length: MIN_RUNS_TO_LEARN }, () => record({ kind: "shell", summary: "Ran bun run build", refs: { command: "bun run build" } }));
  const review = reviewMember({ agent: member(), records, now });
  const proposal = review.proposals.find((item) => item.kind === "skill.add");
  assert.ok(proposal, "something done often enough is a skill worth naming");
  assert.match(proposal.text, /bun run build/, "the skill names the routine");
  assert.equal(proposal.evidence.count, MIN_RUNS_TO_LEARN);
}

{
  const records = Array.from({ length: MIN_RUNS_TO_LEARN }, () => record({ kind: "shell", summary: "Ran bun run build", refs: { command: "bun run build" } }));
  const agent = member({ skills: [{ id: "s1", name: "Run bun run build" }] });
  const review = reviewMember({ agent, records, now });
  assert.equal(review.proposals.filter((item) => item.kind === "skill.add").length, 0, "a skill it already has is not proposed");
}

{
  const records = Array.from({ length: MIN_RUNS_TO_LEARN - 1 }, () => record({ kind: "shell", summary: "Ran ls", refs: { command: "ls" } }));
  const review = reviewMember({ agent: member(), records, now });
  assert.equal(review.proposals.filter((item) => item.kind === "skill.add").length, 0, "below the threshold is a habit, not a skill");
}

// --- memories go stale and want checking ----------------------------------

{
  const agent = member({ memory: [{ id: "k1", text: "Deploys go through the staging box", at: ago(STALE_MEMORY_DAYS + 5) }] });
  const review = reviewMember({ agent, records: [], now });
  const proposal = review.proposals.find((item) => item.kind === "memory.confirm");
  assert.ok(proposal, "an old memory is worth re-checking");
  assert.match(proposal.text, /staging box/);
  assert.equal(proposal.memoryId, "k1", "the proposal points at the memory it doubts");
}

{
  const agent = member({ memory: [{ id: "k1", text: "Recent", at: ago(1) }] });
  const review = reviewMember({ agent, records: [], now });
  assert.equal(review.proposals.filter((item) => item.kind === "memory.confirm").length, 0, "a fresh memory is left alone");
}

// --- a review stays small enough to act on --------------------------------

{
  const records = [
    ...Array.from({ length: 6 }, (_, i) => record({ kind: "run", status: "failed", summary: `Run failed: cause ${i % 3}` })),
    ...Array.from({ length: 12 }, (_, i) => record({ kind: "shell", summary: `Ran cmd${i % 4}`, refs: { command: `cmd${i % 4}` } })),
  ];
  const agent = member({ memory: Array.from({ length: 9 }, (_, i) => ({ id: `k${i}`, text: `old ${i}`, at: ago(STALE_MEMORY_DAYS + 1) })) });
  const review = reviewMember({ agent, records, now });
  assert.ok(review.proposals.length <= 3, `a review proposes at most 3 things, got ${review.proposals.length}`);
}

// --- proposals describe themselves ----------------------------------------

{
  const records = Array.from({ length: MIN_FAILURES_TO_REMEMBER }, () => record({ kind: "run", status: "failed", summary: "Run failed: no token" }));
  const [proposal] = reviewMember({ agent: member(), records, now }).proposals;
  const summary = proposalSummary(proposal, {});
  assert.ok(summary.length > 0 && summary.length < 200, "a proposal reads as one short sentence");
  assert.doesNotMatch(summary, /undefined|\[object/, "no leaked internals");
}

// --- applying a proposal --------------------------------------------------

{
  const agent = member();
  const records = Array.from({ length: MIN_RUNS_TO_LEARN }, () => record({ kind: "shell", summary: "Ran bun test", refs: { command: "bun test" } }));
  const [proposal] = reviewMember({ agent, records, now }).proposals;
  const patch = applyProposal(agent, proposal, now);
  assert.ok(Array.isArray(patch.skills), "applying a skill proposal returns the new skill list");
  assert.equal(patch.skills.length, 1);
  assert.match(patch.skills[0].name, /bun test/);
  assert.equal(patch.skills[0].source, "chief-of-staff", "the origin is recorded so it can be told from a hand-written one");
}

{
  const agent = member();
  const records = Array.from({ length: MIN_FAILURES_TO_REMEMBER }, () => record({ kind: "run", status: "failed", summary: "Run failed: no token" }));
  const [proposal] = reviewMember({ agent, records, now }).proposals;
  const patch = applyProposal(agent, proposal, now);
  assert.ok(Array.isArray(patch.memory));
  assert.equal(patch.memory.length, 1);
  assert.equal(patch.memory[0].source, "chief-of-staff");
}

{
  // Confirming a memory refreshes it rather than duplicating it.
  const agent = member({ memory: [{ id: "k1", text: "Old truth", at: ago(STALE_MEMORY_DAYS + 1) }] });
  const [proposal] = reviewMember({ agent, records: [], now }).proposals;
  const patch = applyProposal(agent, proposal, now);
  assert.equal(patch.memory.length, 1, "confirming does not add a second copy");
  assert.equal(patch.memory[0].at, now.toISOString(), "confirming makes it fresh again");
}

{
  // An unknown proposal must not corrupt the member.
  assert.deepEqual(applyProposal(member(), { kind: "nonsense" }, now), {}, "an unknown proposal changes nothing");
  assert.deepEqual(applyProposal(member(), null, now), {}, "no proposal changes nothing");
}

// --- a skill the job turned out to need -----------------------------------

{
  // The member keeps failing on something it has no skill for. That is the
  // clearest possible signal of a gap in its tool belt.
  const records = [
    record({ kind: "run", status: "failed", summary: "Run failed: playwright is not installed" }),
    record({ kind: "run", status: "failed", summary: "Run failed: playwright: command not found" }),
  ];
  const review = reviewMember({ agent: member(), records, now });
  const gap = review.proposals.find((item) => item.kind === "skill.add" && /playwright/i.test(item.text));
  assert.ok(gap, "a topic that keeps breaking the work becomes a skill to learn");
  assert.equal(gap.evidence.of, "failures", "the evidence is the failures, not a guess");
  assert.ok(gap.evidence.count >= 2);
}

{
  // Already has it: nothing to learn.
  const records = [
    record({ kind: "run", status: "failed", summary: "Run failed: playwright is not installed" }),
    record({ kind: "run", status: "failed", summary: "Run failed: playwright: command not found" }),
  ];
  const agent = member({ skills: [{ name: "playwright-end-to-end" }] });
  const review = reviewMember({ agent, records, now });
  assert.equal(
    review.proposals.filter((item) => item.kind === "skill.add" && /playwright/i.test(item.text)).length,
    0,
    "a skill it already has is not proposed again"
  );
}

{
  // Common words are not skills.
  const records = [
    record({ kind: "run", status: "failed", summary: "Run failed: the file could not be found" }),
    record({ kind: "run", status: "failed", summary: "Run failed: the file could not be found" }),
  ];
  const review = reviewMember({ agent: member(), records, now });
  for (const proposal of review.proposals) {
    if (proposal.kind !== "skill.add") continue;
    assert.doesNotMatch(proposal.text, /\b(the|file|could|not|found|failed|run)\b/i, `"${proposal.text}" is not a skill`);
  }
}

// --- refining how it works ------------------------------------------------

{
  // Enough failures in one window is a sign the way it works needs changing,
  // not just that it needs to remember something.
  const records = Array.from({ length: MIN_FAILURES_TO_REFINE }, (_, i) =>
    record({ kind: "run", status: "failed", summary: `Run failed: cause ${i}` })
  );
  const review = reviewMember({ agent: member(), records, now });
  const refine = review.proposals.find((item) => item.kind === "brainCard.update");
  assert.ok(refine, "a run of failures is worth changing how it works");
  assert.ok(refine.field, "the proposal names which part of the brain card it changes");
  assert.ok(refine.text.length > 10, "and says what to change it to");
  assert.equal(refine.evidence.count, MIN_FAILURES_TO_REFINE);
}

{
  // A member already working that way is left alone.
  const records = Array.from({ length: MIN_FAILURES_TO_REFINE }, (_, i) =>
    record({ kind: "run", status: "failed", summary: `Run failed: cause ${i}` })
  );
  const agent = member({
    brainCard: { escalationRules: "Ask before retrying the same approach a third time." },
  });
  const review = reviewMember({ agent, records, now });
  assert.equal(
    review.proposals.filter((item) => item.kind === "brainCard.update").length,
    0,
    "a rule it already follows is not proposed again"
  );
}

{
  // A quiet member is not told to change how it works.
  const records = [record({ kind: "run", status: "failed", summary: "Run failed: one off" })];
  const review = reviewMember({ agent: member(), records, now });
  assert.equal(review.proposals.filter((item) => item.kind === "brainCard.update").length, 0);
}

{
  const records = Array.from({ length: MIN_FAILURES_TO_REFINE }, (_, i) =>
    record({ kind: "run", status: "failed", summary: `Run failed: cause ${i}` })
  );
  const agent = member({ brainCard: { purpose: "Keep the pipelines healthy.", escalationRules: "Stop on anything destructive." } });
  const refine = reviewMember({ agent, records, now }).proposals.find((item) => item.kind === "brainCard.update");
  const patch = applyProposal(agent, refine, now);
  assert.ok(patch.brainCard, "applying it returns a brain card");
  assert.ok(String(patch.brainCard[refine.field] || "").includes(refine.text), "the named field carries the new sentence");
  assert.match(patch.brainCard[refine.field], /Stop on anything destructive/, "the rule it already had is kept, not replaced");
  assert.equal(patch.brainCard.purpose, "Keep the pipelines healthy.", "the rest of the card survives");
}

// --- applying several proposals in a row ----------------------------------

{
  // Each patch has to be applied to the result of the last one. Applying both
  // against the original member silently loses the first, which is exactly
  // the bug this guards: the member announced two lessons and kept one.
  const agent = member();
  const records = [
    ...Array.from({ length: MIN_FAILURES_TO_REMEMBER }, () => record({ kind: "run", status: "failed", summary: "Run failed: no token" })),
    ...Array.from({ length: MIN_FAILURES_TO_REMEMBER }, () => record({ kind: "run", status: "failed", summary: "Run failed: needs Node 24" })),
  ];
  const { proposals } = reviewMember({ agent, records, now });
  const lessons = proposals.filter((item) => item.kind === "memory.add");
  assert.equal(lessons.length, 2, "two distinct repeated failures are two lessons");
  let working = agent;
  for (const proposal of proposals) working = { ...working, ...applyProposal(working, proposal, now) };
  assert.equal(working.memory.length, 2, "both lessons survive");
}

// --- hostile input --------------------------------------------------------

for (const bad of [null, undefined, "x", 42, {}, { agent: null }]) {
  const review = reviewMember(bad);
  assert.ok(Array.isArray(review.proposals), `proposals is always an array for ${JSON.stringify(bad)}`);
  assert.equal(typeof review.hasWork, "boolean");
}

console.log("check-chief-of-staff: ok");
