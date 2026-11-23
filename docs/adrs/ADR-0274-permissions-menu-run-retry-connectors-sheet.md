# ADR-0274: A permissions menu in the chat header, Retry for failed turns, connectors in a sheet

Status: accepted, 2026-11-23

## Context

Three requests from the owner on 23 Nov 2026:

1. "when i click a new permission icon next to ... i want to be able to see a
   quick menu options permissions".
2. "there's no retry here [Execution › Runs] or reschedule automatically a
   retry in 10 min for example by default". The run in the screenshot was
   Daniel's "learn all the things we do for Noda", which ADR-0273 traced to a
   forced dry run.
3. "a dedicated view of Connectors per bot … but is isolated like this [the
   full page], shift to a side slider like the rest of it."

What the code did:
- Retry existed only for a turn a restart interrupted (ADR-0123).
  `finishChatRun` cleared `run.launch` for every finished turn, so a failed
  turn could not be sent again.
- Daniel's run is recorded as `completed` with exit code 0
  (`app/run-history.json`). The CLI ends a turn whose model only narrated with
  "The model kept announcing steps instead of executing them through 2
  tool-free recoveries…" and exits 0. So even a Retry for failed runs would
  not have appeared on it.
- "Manage" in the Permissions tab navigated to `/squad-members/:id/connector`,
  a full page that leaves the conversation.

## Decision

- **A shield icon beside the member menu** opens a popover with:
  - how the member acts: Ask me first (interactive), Play it safe
    (restricted) or Act on its own (unrestricted);
  - the same rows as the Execution panel's Permissions tab: Manage the team,
    Connectors and Computer Use;
  - All permissions for the full page.

  A mode set here changes the member's base permission mode and launch
  policy. Per-workspace overrides stay on the full page.
- **A failed direct turn offers Retry and tries itself again once after ten
  minutes** (`AUTO_RETRY_MS`):
  - The failed run keeps its launch, including across restarts.
  - The retry is a queue item with `notBefore`. It is not run, and does not
    hold the member, until then.
  - The Runs row says "Tries again at 3:16 PM", with Retry now and Don't
    retry (`POST /api/runs/:id/retry/cancel`).
  - Queue, goal and routine turns have no launch, so a retry is never retried
    again.
  - An automatic retry does not pause the member after a restart, and a
    failing one does not pause the queue.
- **The CLI's narrate-only stop counts as a failure.** `engineGaveUp`
  (`server/harness/stop-reason.mjs`) recognises the message, and the run is
  recorded as failed, with the reason in its errors.
- **Manage opens the member's connectors in a side sheet**
  (`MemberConnectorsSheet`). It reuses `MemberConnectors`; the conversation
  stays open behind it, and Connect closes the sheet before going to Settings.

## Evidence

- `check-reliability` covers the failure path with a fake engine whose turn
  fails:
  - the run is retryable;
  - `autoRetryAt` is 9–10 minutes away;
  - the queue item waits with `automaticRetry` and `notBefore`, and the member
    is not paused;
  - nothing starts within 1.5 s;
  - Don't retry cancels the item;
  - on a second failure, Retry now starts the turn again, and a further Retry
    is refused (409).
  - `engineGaveUp` matches the CLI sentence and ignores a reply that merely
    mentions it.
  - The existing interrupted-run and restart cases still pass, after a restart
    first left the queue paused because of a waiting automatic retry. That is
    what the restart-pause exclusion fixes.
- `check-member-controls-browser`:
  - Manage opens the sheet with connectors offered while the conversation URL
    stays;
  - Escape closes it;
  - the shield opens the menu with all seven entries;
  - Play it safe and Ask me first reach the bridge as `restricted` and
    `interactive`.
- `check-execution-panel-browser` passes.

## Consequences

- The ten minutes is fixed; there is no setting to change it or turn it off
  per member.
- Only one automatic retry. A turn that fails for a lasting reason (a
  sign-in, a missing engine) fails twice and then waits for the person.
- Recognising the CLI's give-up by its wording is fragile. A reworded CLI
  message goes back to being recorded as completed. A structured stop reason
  from the CLI would be better.
- The profile's own Connectors section (`/squad-members/:id/connector`) is
  still a full page; the entry points from the conversation use the sheet.
- The quick menu's mode applies to the member as a whole; a workspace with its
  own override keeps it.
