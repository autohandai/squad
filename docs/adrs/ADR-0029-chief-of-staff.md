# ADR-0029: Members review their own work and say so

Date: 2026-09-27
Status: Accepted

## Context

Members only ever acted when prompted. They did not notice that the same
build failure had bitten them four times, did not pick up that they ran the
same command every day, and never started a conversation. Improving a member
meant the person noticing the pattern and typing an instruction.

The ask was a chief of staff: something that keeps members improving on their
own, revalidating their memory and skills, adding a skill they turn out to
need, and telling the person about it without being asked.

## Decision

**Three rules, each with evidence.** `src/lib/chief-of-staff.js` reviews a
member against its own audit trail and proposes at most three things:

| Rule | Trigger | Proposal |
| --- | --- | --- |
| A failure that keeps happening | the same failure twice | remember it |
| A routine it repeats | the same command three times | name it as a skill |
| A memory nobody has touched | older than thirty days | confirm it is still true |

Every proposal carries the evidence that produced it. Nothing is proposed on
a hunch, and a member with a quiet week gets left alone. The alternative,
asking a model to reflect on its own performance, produces fluent
self-assessment with nothing behind it; a member that decides it has become
"better at architecture" has learned nothing and now believes something
false.

**It runs in the app, not the bridge.** Skills and memory live in the browser
and reach the bridge only through `web-status.json` (see CONTRACT.md). A
bridge-side reviewer would need a write path back into browser state that
does not exist. Running the loop in the app keeps one owner for member data.
The cost is that reviews only happen while the app is open, which is
acceptable: their output is a conversation, and nobody reads a conversation
while the app is closed.

**Acting is the default, and every action is announced.** Both switches
default on, because a manager that only ever asks permission is another
inbox. The safety is not a confirmation dialog but the record: each change is
written to the audit trail, appears in the member's next briefing (ADR-0028),
and is tagged `source: "chief-of-staff"` so a member's own additions can be
told from the person's. Turning off "Let them act on it" keeps the reviews
and makes them proposals instead.

**A review is how a member starts a conversation.** The member posts the
result into its own direct message thread, marked `selfReview: true`. That is
the whole of "proactive": no new channel, no notification kind, no banner.
The sidebar's unread dot already means "this member said something".

**Never during a break.** A member on a break (ADR-0027) is skipped. A break
means not working, and reviewing yourself is working.

## Consequences

- The first review runs 45 seconds after launch and then every six hours, so
  it never competes with first paint and never becomes chatty.
- Proposals must be applied in sequence, each to the result of the last.
  Applying them all against the original member drops every change but one;
  this was a real bug, caught end to end, and the check now documents the
  correct usage.
- Quality depends entirely on the audit trail. A member whose work is not
  recorded gets no proposals, which is the honest failure: it under-proposes
  rather than inventing.
- The rules are deliberately shallow. They find repetition, not insight.
  Anything cleverer needs a model in the loop and therefore a way to check
  what it claims, which is a larger decision than this one.
- `scripts/check-chief-of-staff.mjs` covers each rule, both directions of
  each threshold, the cap, sequential application, and hostile input.
