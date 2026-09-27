# ADR-0028: A member opens with what changed, not with an introduction

Date: 2026-09-27
Status: Accepted

## Context

Opening a conversation with a member showed "Hi, I'm Noah." and its role
description. It said the same thing on the hundredth visit as on the first.
Meanwhile the member had been working: finishing runs, editing files, failing
and recovering. None of that was visible until you scrolled its history, and
the member itself opened as though nothing had happened.

The ask was for the opening to read like a colleague catching you up: what it
learned, what it added to its tool belt, what it changed in its memory.

## Decision

**The briefing is reported, not generated.** Asking the model to say what it
learned invites it to invent a plausible answer, and a member that
confidently claims a skill it does not have is worse than one that says
nothing. The audit trail from ADR-0018 already records what each member
actually did, so `src/lib/member-briefing.js` folds those records into a few
lines and the UI shows them. Every line traces to a record.

**What it gained leads.** The order is skills, then lessons, then runs, edits,
commands, handoffs. Runs and edits are visible elsewhere; a skill it picked up
or a lesson it wrote down is not, and it is the part that answers "are you
getting better at this". The briefing is capped at five lines, because a
catch-up nobody reads is not a catch-up.

**Skills and memory became audit kinds.** `ACTIVITY_KINDS` gains `skill` and
`memory`, and `updateAgent` records an entry when a member gains either. Only
additions are recorded: losing a skill is not news for a greeting, and the
removal is still in the trail.

**The member is handed the same facts.** `briefingContext` renders the
briefing as a block appended to the member's profile context, telling it to
open by describing what changed and to state only what is listed. So the
person and the member are looking at the same short list, and the member's own
words can be checked against it.

**A visit is an opening.** Opening the conversation stamps the visit in
`localStorage` under `autohandSquad.v1.memberVisits`, so the next briefing
starts there. Per browser, deliberately: this is "since *you* were last here",
not a fact about the member.

## Consequences

- A member with nothing to report shows no briefing at all, and the welcome is
  what it was. Silence is the correct output for a quiet week.
- The briefing depends on the audit trail being fed. A kind nobody records
  never appears, which is the honest failure mode: it under-reports rather
  than invents.
- The member's opening words are steered but not forced. It may still phrase
  things its own way, which is the point; the facts beside it are the check.
- `scripts/check-member-briefing.mjs` covers the folding rules, the ordering,
  the cap, and hostile input, and asserts the context block tells the member
  not to embellish.
- Not done: the briefing counts runs and edits but does not link to them.
  Making each line open the matching history filter is the obvious follow-up.
