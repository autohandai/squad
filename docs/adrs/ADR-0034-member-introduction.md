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

## Correction, 2026-09-28: the member speaks as itself

Fixing the designer's cold start (ADR-0036) made the model path run for the
first time, and it immediately showed this decision was half done. The brain
card is an instruction sheet addressed to the member, so a model fills every
field in the second person. Composing the introduction out of those fields
verbatim produced:

> I'm Marcus, your Chief of Staff on autohandSWE. **You** coordinate all squad
> work by decomposing requests into tasks and assigning them to the right
> members. … **You** escalate to the lead when a task is blocked…

The member introduced itself and then told the user what the user does. It had
shipped unnoticed because the fallback writes its purpose in the person's own
words and its escalation rule as an instruction, and the fallback was
answering every time.

`inMemberVoice` converts a sentence written to the member into the member's
own speech: the second-person pronouns, contractions and possessives, with
"you are" and "you were" handled before the bare pronoun. Every "you" in the
card means the member, so flipping all of them is right, including a second
one in the same sentence: "requires authority you do not hold" becomes
"requires authority I do not hold". Text with no second person in it comes
back untouched, so a card written in the third person or as an instruction is
left exactly as it was.

The draft prompt now also pins the description to the third person. That field
labels the member in the directory, the profile header and the channel picker,
and the neighbouring "addressed to the member as 'you'" rule was pulling the
model into writing "You own squad-wide coordination" there too.

One thing is knowingly left: a model can still return a second-person
description despite the prompt. The field is editable on the screen where it
appears, and converting it would mean conjugating a verb rather than swapping
a pronoun.

### Second correction: a brain card is configuration, not speech

The imperative escalation rule was first recorded here as acceptable, on the
grounds that it only happened when no model answered. Watching the model path
once it actually ran showed that wrong twice over. It is the common shape, and
there is a second one beside it:

> I'm Marcus, your Chief of Staff on autohand. **To be the single control
> point for all squad work**, owning intake, assignment and tracking. … **Stop
> and ask the lead** when priorities conflict.

A purpose is written as an infinitive phrase, so quoting it drops a fragment
between two sentences. An escalation rule is written as an order, so quoting
it has the member telling the person what to do. `asMemberSpeech` turns the
first into "I'm here to be the single control point…" and the second into "I
stop and ask the lead when…".

The verbs that open an escalation rule are listed rather than guessed, because
prefixing "I" to a sentence that does not begin with a bare verb produces
something worse than the original. A sentence in neither shape is returned
untouched, so a card written in the third person still reads as it was.
