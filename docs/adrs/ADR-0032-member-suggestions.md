# ADR-0032: What to ask a member comes from that member

Date: 2026-09-28
Status: Accepted

## Context

Opening any member's chat offered the same three prompts, hardcoded in the
component:

> Help me fix {bug ID} in {repository}, finish the code changes, and prepare a PR.
> Help me check this component for interaction, accessibility, and responsive issues.
> Help me improve this frontend page's visual hierarchy and loading performance.

So a data engineer was invited to check a component for responsive issues, and
a security reviewer was offered frontend work. Two of the three also carried
`{bug ID}` and `{repository}` placeholders that nothing ever filled in.

## Decision

**The prompts interpolate rather than enumerate.** Three shapes that make
sense for any role, filled from the member's own role, its top two skills and
its workspace folder:

- Look at *warehouse* and tell me the three things most worth fixing for *sql query optimisation*.
- As a *Data Engineer*, what would you take ownership of in *warehouse*? Start with what worries you most.
- Find the weakest part of *warehouse* for *pipeline observability*, then fix it and show me the change.

A per-role list of hand-written prompts was the obvious alternative and is
worse: it needs an entry for every role that exists now and every custom role
a person invents later, and the ones nobody maintains go stale silently. Three
shapes cover every member, including ones designed from a sentence.

**Skill slugs are made readable.** Members carry skills as slugs like
`react-component-architecture`; the prompt says "react component architecture".

**There is always a full set.** A member with no skills falls back to shapes
built from the role alone, and one with no role falls back to "squad member".
The count is fixed, so the layout never shifts, and no prompt can contain a
placeholder: the checks assert that nothing matching `{word}`, `undefined` or
`[object` survives.

## Consequences

- Two members never see the same prompts unless they have the same role,
  skills and workspace.
- The prompts name the workspace folder, so they read as being about the
  person's actual project rather than a generic repository.
- They are shapes, not expertise. They will not ask a database question a
  database expert would ask; they ask a good general question with the
  member's own vocabulary in it. Anything better needs a model, which means
  latency on a screen whose whole job is to be ready before you type.
