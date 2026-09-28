# ADR-0041: A call that says nothing about a member cannot erase its permissions

Date: 2026-09-28
Status: Accepted

## Context

A user:

> When I try to change a tool an agent is allowed to use, by moving from
> "blocked" to "ask", it seems to hold and then something overrides the moment
> it tries to use it and it gets set back to "blocked" again. I want the
> "skill" tool to be at least "ask".

Two independent faults, both silent.

**The warm call erased the policy.** `/api/chat/warm` posts only an agent id
and a workspace. `ensureAgentRuntime` fell back to an empty agent when none
was given, `permissionSettingsFromAgent({})` returns empty allow, ask and
block lists, and those were written over the member's generated `config.json`.
Warming fires once per member every time a chat opens, which is exactly "the
moment it tries to use it". Reproduced by driving the real bridge: provision a
member whose owner set `skill` to ask, read the config and find the prompt
rule, post one agent-less warm, read again and find every list empty.

That also explains the user's hand edits going missing.
`~/.autohand/squad/web-state/agents/<id>/config.json` is generated from the
app's member record, so editing it is editing an output.

**The skill tools were blocked at every level.** The autonomy ladder starts by
blocking every known tool and then grants back what each level allows. It
never granted the skills and memory group, so `skill`, `find_agent_skills` and
`install_agent_skill` were blocked at all four levels. No member could use a
skill it had. The whole feature was off, which is worth putting next to
ADR-0039: skills were also unreachable on disk.

## Decision

**Absence of information preserves.** `ensureAgentRuntime` writes the
permission block only when the caller actually described the member. The fix
is on the bridge rather than only at the call site, because the hazard is the
shape of the operation: any caller that knows nothing about permissions could
erase them, and there will be more callers.

**Warming describes the member too.** Beyond the erasure, an agent-less warm
built different launch options from the real message, so the pooled session
was keyed differently and warming a member's chat warmed nothing. Both are
fixed by sending the same payload the message sends.

**The ladder grants the skill tools.** Using a skill the member is already
configured with, and looking up which skills exist, are reads of its own
profile rather than actions on the world, so they are allowed at every level.
The rest of the group arrives at the mode its own author declared, which for
installing a skill, writing memory and starting a teammate is "ask". The
person is prompted rather than refused.

## Consequences

- `scripts/check-permissions.mjs` starts a real bridge, provisions a member
  with an allow, an ask and a block, warms it without an agent, and asserts
  the permission block is byte-identical afterwards. Remove the guard and it
  fails with the sentence the guard exists for.
- The ladder grant is checked by reading `src/App.jsx`, because the policy
  lives in a file Node cannot import. That is a weaker test and a rename will
  trip it. It is there because the failure it guards was invisible: nothing
  errored, members simply could not use skills.
- A third report was investigated and is not a defect. Permission edits are
  written per workspace, and the Permissions page has a workspace selector and
  names the selected workspace in its header, so the scoping is deliberate and
  visible.
- The permission policy should move to `src/lib/` so the ladder can be tested
  properly rather than grepped. Not done here: it is about three hundred lines
  of mechanical movement, and doing it in the same change as a security fix
  would bury the fix.
