# ADR-0048: A lesson learnt once is not learnt again every hour

Date: 2026-09-29
Status: Accepted

## Context

A user watched a member post the same message through a night, once an hour:

> I had a look at how I have been working and made a few changes:
> - Remember: workspace is required; choose a local project folder or git repo

The self-improvement pass (ADR-0029) is meant to propose a lesson once, apply
it to the member's memory, and then never propose it again, because the rule
that generates it skips anything already remembered.

Driven directly in Node, that logic is correct: round one proposes the lesson,
rounds two and three propose nothing.

The fault was in saving. `normalizeAgentCopy` in the app normalised a member's
memory with `memory.map((item) => String(item || ""))`. `applyProposal` writes
an entry as `{ id, text, at, source }`. Stringifying an object gives
`"[object Object]"`, so every entry was destroyed the moment the member was
saved. Next review the memory held only wreckage, the lesson was not known,
and it was proposed again. Forever.

Two things I built, each correct alone, disagreeing about a shape at the
boundary between them. Nothing errored.

## Decision

**The memory's shape is owned where it is written.**
`normalizeMemoryEntries` lives in `src/lib/chief-of-staff.js`, beside
`applyProposal`, and the app calls it instead of stringifying. It accepts an
entry object, accepts a bare string as legacy, folds duplicates that differ
only by case or spacing, and drops `"[object Object]"` because nothing can be
recovered from it.

**The check drives the loop, not the parts.** `check-chief-of-staff.mjs` now
runs three review rounds with the app's own save in between, and asserts the
lesson is proposed once and then not at all. Restore the stringifying save and
it fails with `[1, 1, 1]` against `[1, 0, 0]`.

## Consequences

- A member remembers what it learns, which is what the feature claimed to do
  and did not.
- Existing members carrying `"[object Object]"` entries lose them on next
  save. They were never readable.
- The same class of fault can exist wherever a normaliser coerces a field it
  does not own. The lesson is narrower than "validate your data": a normaliser
  that flattens a structured field is a normaliser that deletes it, and the
  deletion is silent.
- Not changed: the hourly cadence, and that the member announces changes in
  its own conversation. Those were right. It was the memory that leaked.
