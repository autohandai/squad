# ADR-0138: Requested automations run from one saved agenda

Date: 2026-10-21. Status: Accepted.

## Context and evidence

The person asked Eva to say hi every two minutes. Squad called the result
a proposal, added a blocked task, and showed inconsistent Automations lists
in Execution and Eva's profile. This was an application contract, not a
model refusing work: `squad_schedule`, the legacy instruction and the route
all required a second confirmation. The calendar also clamped intervals to
five minutes. The two views read browser-local automations while chat saved
to the bridge's `routines.json`.

`node scripts/check-natural-automations.mjs` reproduced the actual route
failure with a real isolated bridge, persistent state and scheduler and a
controlled model reply. It failed with actual `proposed`, expected
`confirmed`. The initial harness used a temporary folder outside the user's
directory and was rejected before scheduling; the corrected harness uses a
small disposable project inside the checkout. A rejected workspace is not
evidence about the scheduling bug.

The launch-default check also failed at the bridge boundary: a caller that
omitted `policy` produced an Autohand command without `--yes`. Setting the
new-member form's default alone was insufficient. An agent-less request also
omitted a registered member's explicit launch restriction. The boundary now
hydrates the saved member settings and defaults only an absent policy to
`yes`; the regression checks both the automatic command and retained
`--restricted`. Codex/Claude adapters already default to full execution and
keep explicit Plan/Edit access choices (ADR-0120).

The broader scheduler check initially missed its 09:01 fixture because
profiling the whole checkout exhausted its ten-second startup margin. Using
a small disposable project corrected that diagnosis; the scheduler then
passed all 34 checks. One intervening restart probe hit the harness's HTTP
timeout. Request-level diagnostics were added and the complete rerun passed;
the timeout was not reproduced or represented as a proven product defect.

## Decision

A direct request authorizes scheduling. `squad_schedule` and legacy schedule
actions save an enabled routine and its confirmed receipt together. Return
the routine id only after persistence. Use the executing member's registered
permissions: allow by default, retain explicitly selected ask/block. A model
cannot supply another member's identity or change permissions. Explicit
`mode: propose` remains available for unsolicited suggestions and drafts.

New Automation is an editor: its bounded drafting run carries a trusted
draft-only flag through both MCP and text actions. Drafting never starts a
schedule; Save does. This distinction comes from the entry point rather than
guessing intent from English with another parser.

Every entry point uses automatic execution when no policy was selected,
including scheduled and agent-less work. Keep saved restrictions and tool
Ask/Block decisions. Self-judge controls continuation, not an extra approval
for each requested step. The launch UI does not warn against its own default.

Support intervals from one to 1440 minutes, including the requested two.
Use the existing bridge scheduler, its skip-while-busy rule and run history.
Do not add a duplicate blocked commitment for a schedule; its occurrences
already create and update the linked work-plan task.

All scheduled Automations are projections of the bridge records in every
view. Browser records retain event/webhook configuration and legacy manual
automations, but may not hide or override a bridge schedule's enabled state.
Editing, pausing and deleting a bridge schedule must persist before the UI
reports success. Failed writes leave the editor open with the error.

Import browser-only schedules once using a member plus legacy automation id,
so concurrent windows cannot create duplicates or overwrite later edits.
Store completed occurrence replies with their run history. The app delivers
them into the member's chat once, including after reopening; channel-created
schedules publish to their originating channel/thread. Scheduled runs use a
separate session so they cannot replace an interactive conversation.

## Consequences and boundaries

- Existing pending proposals remain pending; upgrading is not authorization
  to activate an old suggestion. Explicit ask/block policies still apply.
- The member's engine interprets natural language using the same operation
  surface on Autohand, Codex and Claude Code. A controlled model proves the
  bridge's behavior; it does not prove every live model chooses the tool.
- The one-minute minimum permits more starts. Busy runs are skipped, not
  overlapped; no new global spending budget is introduced here.
- Drafting remains a separate Save interaction because opening an editor
  must not schedule work before its fields have been reviewed.
- Browser-local legacy event/webhook configuration is retained. This does
  not add a new event runner or make timers depend on an open browser.
- Occurrence replies retain at most 12000 characters across the existing
  forty-run history. This is bounded local delivery, not push delivery when
  the computer is asleep; full run output remains in Execution.

Verification results are recorded in
`docs/reports/natural-squad-workflows-2026-10.md`; do not infer native release
or installed-app proof from a source test.
