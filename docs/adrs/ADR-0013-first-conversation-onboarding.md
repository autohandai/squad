# ADR-0013: Onboarding ends in a first conversation

Date: 2026-09-24 · Status: accepted

## Context

The first-run page was a five-item readiness checklist (runtime, account,
provider, workspace, member) with status badges. Most items are already ready
on a fresh install, so the page mostly reported state and ended on the
directory. New users installed the app to talk to a coding teammate about a
folder; the checklist never got them there.

## Decision

- `/welcome` becomes three moments in one column: point at a folder, meet
  your first teammate, start talking. The current moment is the progress
  indicator; there is no percentage bar and no checklist.
- Readiness stays silent when green. A blocked prerequisite (not signed in,
  runtime unavailable, provider missing) renders as one sentence with one
  action above the current moment. Sign-in remains owned by the account gate
  and the runtime's device flow.
- The folder step uses the native picker and the recent workspaces the bridge
  lists, then asks the bridge for a folder profile (`POST
  /api/workspaces/profile`, ADR-0015) and shows it as one sentence.
- The teammate step ranks role templates against the profile (the same
  matcher recruiting uses), preselects the best, and prefills a name. The
  existing member creation route stays reachable for anything else.
- Start talking creates the member through the existing `createAgent` path,
  marks onboarding complete, and opens the member chat with a drafted first
  message passed as a `prompt` route parameter that the conversation adopts
  into its draft once.
- Onboarding state keeps its shape (status, selectedWorkspace, memberReady,
  lastStep); `lastStep` gains the values `folder`, `teammate`, `talk`.

## Consequences

- The onboarding component moves out of `App.jsx` into
  `src/components/onboarding/FirstRun.jsx`; `App.jsx` keeps only the wiring.
- Provider setup is no longer part of onboarding. Autohand AI works with the
  account; other providers are configured in Settings.
- The directory is no longer the landing surface after onboarding; the first
  member's chat is. Skip still lands on the directory.
