# ADR-0266: Communications replaces Messaging, right after Home

Status: accepted, 2026-11-20

## Context

"Messaging and email configuration should be a category in itself called
Communications … please make only one view, delete this messaging thing. or
keep it and move to be Home, Communications, Permissions … change the order of
permissions to be right after."

A member's sidebar listed Messaging (one row, "Direct conversation ·
enabled") eleventh, and Permissions last. Since ADR-0265 the email address
appeared on the Permissions page and in the Execution panel's quick
settings, so it was in two places.

## Decision

- **The member section `im` is now Communications.** Its route and id are
  unchanged, so links keep working. It holds the direct conversation (with
  Open chat) and, for accounts allowed agent email, the address with the
  name before the @ editable.
- **Email lives only there.** The Permissions page keeps Manage the team.
  The Execution panel's quick settings keep Manage the team, Connectors and
  Computer Use.
- **Order:** Home, Communications, Permissions, then Projects, Automations,
  Tasks, Library, Memory, History, Model, Harness, Skills, Connectors.
- **Translations:** the label is translated in the nine locales, which
  previously said "IM".

## What was run

`check-member-controls-browser` asserts:
- the sidebar's first four entries are Home, Communications, Permissions,
  Projects;
- Messaging is gone;
- the Communications page shows Direct conversation and, for an account
  outside autohand.ai, no Email row.

`check:jsx` and `bun run build` pass.

## Consequences

- People who learnt "Messaging" find the same page under a new name, higher
  up.
- Email settings beyond the address are not in this change. Those are the
  urgency rules, automatic replies and one-time address change asked for on
  the same day; see the next ADR.
