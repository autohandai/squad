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
