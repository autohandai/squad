# ADR-0036: The member designer is not a member

Date: 2026-09-28
Status: Accepted

## Context

The owner reported twice that custom roles were no good: a member designed
from a sentence came back named Nova, with the skills "research" and
"implementation", whatever the sentence said. ADR-0034 fixed the job title by
reading it out of the description. The rest stayed generic, and the reason was
not the prompt or the model.

Measured against a real bridge, with the same description each time:

| run | time | result |
| --- | --- | --- |
| cold, as shipped | 20.2s | timed out, deterministic fallback |
| second call, session warm | 9.0s | the model's answer, eight real skills |

The route gives up at twenty seconds, which is right: nobody watches a spinner
longer than it takes to fill the form in by hand. The problem is that a cold
start alone spent the whole budget, so in practice the model never answered.
The fallback did its job perfectly and the fallback is generic, so the feature
looked like a bad prompt when it was a clock.

The cold start goes on the designer's MCP servers. Each agent's config is
copied whole from the user's own, so the designer inherited two: a GitHub
server that runs a Docker image, and a Figma server on a local port that is
only listening when the Figma app is open. The designer answers one question
with JSON. It cannot call a tool, and was waiting on both of them anyway.

## Decision

**The bridge has a notion of a utility agent, and gives it no MCP servers.**
`utilityAgentIds` in `server.mjs` holds one entry today, the member designer.
A utility agent is one the app runs for itself: it answers a question with
text, never holds a conversation, never runs a tool. Emptying `mcp.servers`
in its config takes nothing away from it.

This deliberately does not touch members. A member inheriting the user's MCP
servers is a real cost on every cold start and is a separate question, because
a member might genuinely want the GitHub server. The designer cannot.

**The create screen warms the designer when it opens.** `POST /api/chat/warm`
already existed for member chats (ADR-0030): it acquires a pool session and
releases it without prompting, so it costs no tokens. The screen asks for one
on mount, and the CLI boots while the person is still writing the sentence,
which is time that was being spent anyway.

Measured after both changes, cold bridge each time:

| run | time | result |
| --- | --- | --- |
| cold, no MCP servers | 15.9s | the model's answer, eight real skills |
| warmed on open, 12s of typing | 10.8s | the model's answer, real skills |

**One name for the designer, checked.** `MEMBER_DESIGNER_ID` lives in
`src/lib/member-draft.js`, which the route and the screen already share.
`scripts/check-member-draft.mjs` asserts that `server.mjs` lists that same id
as a utility agent. Without the check nothing would notice the two drifting:
the strip would silently stop applying, the timeouts would come back, and the
symptom would again look like a bad prompt.

## Consequences

- A custom role now comes back from the model rather than the fallback, with
  skills drawn from the description. That is the whole of the owner's report.
- The twenty-second budget is unchanged, and now has real headroom instead of
  being blown before the model was asked. The fallback stays as the answer to
  a model that is genuinely absent or slow, which is what it is for.
- The margin is a measurement on one machine, not a guarantee. A slower start
  still falls back, and still produces an editable member with the right job
  title.
- Warming on open starts a CLI for somebody who may close the screen without
  designing anything. The pool's idle TTL closes it, and the same trade was
  already accepted for opening a member's chat.
- The designer keeps the user's provider, account and harness, because it
  still goes through the app's own chat route. Only the servers it cannot use
  are gone.

## The brain card the app actually has

Making the model path run showed a second reason designed members were
generic, one no test or error would have surfaced.

`src/lib/member-draft.js` kept its own list of brain-card field names, with a
comment saying it mirrored `src/data.js`. It had drifted. It asked the model
for `successCriteria`, which the create form has no field for and silently
dropped, and never asked for `definitionOfDone`, `reviewStyle` or
`memoryPolicy`. Those three come from a generic role template when nothing
fills them, so three of a designed member's seven brain-card fields were
boilerplate however specific the description was. Nothing failed. The member
was just worse.

The list is now derived from `brainCardFields` itself, which is plain data
with no imports and loads in Node as happily as in the browser, and the
prompt asks for each field in the form's own words. `check-member-draft.mjs`
asserts the draft carries exactly the form's fields, that each one is named
in the instruction, and that the fallback fills all of them.

That costs time. Seven fields instead of five took a warm answer from about
9s to 12-15s, which put a working model back over the twenty-second ceiling
and handed back the generic member this was all meant to fix. The ceiling is
now thirty seconds. It is there for a model that is wedged, not one that is
working, and the warm start is what keeps the common case near twelve.

The page states that number in the sentence it shows while waiting, which is
the most useful thing on screen during a wait, and a lie the moment the two
drift. `check-member-draft.mjs` reads the route's constant, spells it, and
asserts the copy says the same word.

The promise line itself moved from twelve seconds to eighteen, so it appears
when someone starts to worry rather than flashing as a normal answer lands.

## The designer forgets between drafts

Measured after everything above, three drafts of the same sentence on one
session: 28s, then 20s, then 25s, and the last two came back as prose instead
of the JSON they were asked for, so both fell back to the deterministic draft.

The session pool keeps the CLI's own transcript. That is the point of it for a
member chat, where the follow-up depends on what was said before, and it is
exactly wrong here. Every draft is an independent one-shot request. By the
third the model was continuing a conversation rather than answering a
question, which costs tokens on the way in and reliability on the way out.

The route now closes the designer's session once the answer has been sent and
warms a fresh one behind it, so the next design finds a warm process with an
empty conversation. It costs the person nothing: the CLI boots while they read
the answer they already have. Only the app's own designer is recycled, since a
caller naming their own member would lose that member's chat context.

Four consecutive drafts after the change all came back from the model, against
one of three before. Directly confirmed: design a member, then ask the same
agent what name it suggested in its previous message, and it answers "NONE".

What did not change is the variance. Those four took 15s, 15s, 22s and 29s.
The ceiling is thirty seconds because a real answer can genuinely take most of
that, not because the common case does.
