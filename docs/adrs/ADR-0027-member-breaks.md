# ADR-0027: A member can take a break, and declines while on one

Date: 2026-09-27
Status: Accepted

## Context

Every member row in the sidebar was a single click with no way to act on the
member without first opening it. The member directory already had an overflow
menu, so the two surfaces disagreed about what you could do with a member and
where.

Separately, the app has carried a `paused` member status since early on, shown
as a dot colour and a filter in the directory. Nothing read it. Pausing a
member changed how it looked and nothing about what it did: message it and it
worked, mention it in a channel and it replied. The status was decoration.

The request was for a break that means something: ask the member to pause any
work and decline until it is back.

## Decision

**One menu, on the row, in the order the row implies.** The sidebar member row
gains an overflow menu: Chat, Details, Take a break, Delete. Chat is first
because that is what clicking the row already does, and a menu that disagrees
with its own row teaches people not to trust it. Delete sits behind a
confirmation naming the member.

**A break is a decision, and only a decision declines.** `paused` now means
"on a break": a state the person chose. Availability lives in one pure module,
`src/lib/member-availability.js`, which answers `{ canWork, reason, notice,
reply }` for a member. Both dispatch paths, direct chat and channel reply, ask
it before doing anything else and post the member's own decline instead of
starting work.

Offline is deliberately not a break. Offline is a fact about reachability that
the bridge discovers, not an instruction from the person, and the bridge is
better placed to decide what to do about it. Returning a `reason` rather than a
boolean means a second reason later needs no change at any call site.

**Taking a break stops work first.** The break handler awaits `stopMember`
before flipping the status, so nothing is still running when a member is shown
as resting. This reuses the stop path from ADR-0016 rather than adding a
second way to halt work.

## Consequences

- A member on a break answers in its own voice rather than going silent, so
  the person can tell a break from a hang. The reply is a normal message with
  `declined: "break"` on it, so anything that reads the stream can tell the
  difference without parsing text.
- The rule is enforced in the web app, not the bridge. A caller that reaches
  the bridge directly, such as another machine over the remote proxy
  (ADR-0025), is unaffected. That is acceptable while a break is a local
  preference about a local member; moving it into `web-status.json` would make
  it a bridge-level fact and is the obvious next step if breaks ever need to
  hold across machines.
- `scripts/check-member-availability.mjs` covers the rules, including that the
  guard is total across every status value, so a new status cannot silently
  start declining work.
- The directory's own menu still says "Pause member". It sets the same status,
  so the two agree in behaviour; aligning the wording is a follow-up.
