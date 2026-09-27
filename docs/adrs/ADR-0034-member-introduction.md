# ADR-0034: A new member opens by saying what it will do

Date: 2026-09-28
Status: Accepted

## Context

A member created from a description arrived with one seeded message:

> Nova is online. Pick a workspace and chat normally. This squad member keeps
> its isolated config for local work.

That is a status line about the app, not a colleague. Someone who has just
described a chief of staff in a sentence should hear back what that chief of
staff is going to do.

The same report surfaced a second fault. The draft route asks a model and
gives up after 20 seconds. When it times out, the deterministic fallback runs,
and its role hints had no entry matching "chief of staff", so the member
became "Nova, Squad Member" with the skills "research" and "implementation".
The same sentence produced an excellent member or a useless one depending on
how busy the model was.

## Decision

**The introduction is composed, not asked for.** `src/lib/member-introduction.js`
builds it from the member's own configuration: what it is, where it works,
what it is set up for, and when it will stop and ask. Asking a model for it
would add seconds to member creation and let the member promise something it
is not configured to do. Composing it means every sentence can be checked
against the profile next to it.

It skips a purpose that merely restates the role, because the fallback draft
uses the person's own words as the purpose and those words usually open with
the title. A purpose the model wrote reads as its own sentence and is kept.

**The role is rescued from the description.** `roleFromDescription` takes the
noun phrase at the front of a description, stopping at a comma or a relative
pronoun, so "Chief of staff, controls everyone…" gives "Chief of Staff" and
"a data engineer who owns our warehouse" gives "Data Engineer". It returns
nothing for "Someone who reviews Terraform", where the role is described
rather than stated, so the caller falls back instead of inventing a title.

The fallback draft now prefers that over its keyword hints. Adding "chief of
staff" to the hint list would have fixed one sentence; reading the title the
person actually wrote fixes the class.

## Consequences

- Opening a new member's chat shows it introducing itself in a sentence or
  two, and the "Try asking" prompts below are already built from the same
  configuration (ADR-0032), so the two agree.
- The introduction is only as good as the member. A member with no skills and
  no brain card says what it is and where it works, and stops. That is honest
  and still better than a status line.
- It is written once, at creation. It does not update if the member later
  changes, which is correct: it is a first message, not a profile. What
  changed since is the briefing's job (ADR-0028).
- A model timing out still produces a lesser member, with generic skills and
  a generic name. The role is now right, which is the part that shows
  everywhere. Making the rest robust means either a longer wait or a second
  attempt, and both trade against a create flow that should feel immediate.
