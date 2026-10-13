# ADR-0086: Readable timing and reliable terminal replies

Date: 2026-10-13

## Context

The user’s native screenshot showed Alex still working at `95m 14s`, alongside
a self-review reporting that Claude Code timed out after 300 seconds. The
runtime activity record confirmed failure at `2026-10-13T03:53:39.649Z`; the
browser’s saved reply began at `03:48:39.212Z` and still had `status: loading`
without a completion time. These timestamps put the recorded failure at
300,437 ms, rather than the later elapsed time displayed in the screenshot.

Three causes were considered: rejecting the final update, overwriting it with
late progress, or never emitting a final event. The shared-conversation handler
rejected any mutation larger than 512,000 JSON characters. This guard applied
to local updates as well as incoming broadcasts. Live output was truncated,
but the final server result included full diagnostics. Alex’s saved live row
was already 492,043 characters. A minimized oversized error update reproduced
the loss of `status`, duration and failure text. The original final payload was
not retained, so its exact size is not claimed as measured.

The external harness also used five minutes as a fixed deadline. Autohand SDK
chat already used a renewable silence window and a 45-minute ceiling. The user
explicitly selected “Continue while progressing” for external chat too.

## Decision

Format elapsed time with named units, including `1 hour 35 min` instead of
`95m 14s`. Omit seconds once hours are shown and normalize rounding at minute
and hour boundaries.

Keep the shared-message validation and size limits. When a terminal patch’s
diagnostics exceed those limits, validate and apply its answer, final status,
duration and other controls separately. Retain the activity already received,
omit the oversized final trace, event list and computer-use payload, and mark
the reply with a visible work-details limitation. Bound outgoing terminal
broadcasts the same way. Late loading updates cannot reopen a terminal reply;
Retry creates a new request and reply.

External chat turns renew a five-minute silence window on parsed activity,
under the existing 45-minute chat ceiling. The first-event watchdog still
applies. Explicit background job deadlines keep their wall-clock semantics.
Channel browser streams use the shared ceiling plus five seconds for delivery,
rather than aborting at 305 seconds. Failure text distinguishes silence,
startup failure and maximum runtime, with a continuation hint.

## Evidence

- `node scripts/check-duration.mjs`: human units, plurality, invalid values and
  rounding boundaries. The initial native formatter failed the 95-minute case.
- `node scripts/check-shared-conversations.mjs`: oversized error, complete and
  stopped patches keep terminal controls and streamed details, outgoing patches
  remain bounded, removed rows remain removed, late progress cannot restart a
  timer, and invalid-input/reset guards remain effective. The timeout regression
  failed before the handler change.
- `node scripts/check-harness-timeouts.mjs`: real local subprocess fixtures
  cover progress across silence windows, silent termination, startup failure,
  the hard ceiling, and unchanged background deadline semantics. The silence
  regression failed before adding the inactivity timer.
- `node scripts/check-chat-timing-browser.mjs`: an isolated bridge and rendered
  browser consume an oversized controlled error stream, show the cause, Retry
  and frozen five-minute timing, preserve streamed details, retry into a new
  completed reply, show hours, and retain both replies after reopening. No
  vendor provider was invoked.
- The macOS 0.1.6 candidate was built at `2026-10-13T06:32:28.980Z`, verified
  against 343 staged runtime files and its strict whole-bundle signature,
  installed, and opened after stopping the previous idle runtime. The running
  app-info receipt matches the installed executable checksum. Native
  accessibility and screenshot inspection showed Alex’s confirmed failed reply
  at `5 min`, with its cause and Retry, without a working timer. A SQLite backup
  precedes the one-row repair; all nine member identities, roles and workspaces,
  every conversation message ID, and the channel-history file were preserved.

## Consequences

- A diagnostic overflow can no longer conceal a valid bounded final answer or
  timeout. Full final raw output and computer-use additions can be omitted in
  that fallback; already received evidence is kept and the omission is visible.
- The control payload must still pass validation. This does not permit
  arbitrarily large answer text or malformed terminal controls.
- Parsed stderr activity renews the silence window too; an active but looping
  process can therefore run until the finite ceiling. Unparsed raw stdout does
  not renew the window.
- Genuine operations with no parsed progress for five minutes still stop.
  Background jobs and Autohand CLI fallback deadlines are not converted by this
  decision. Durable goals retain their independent pursuit timer and abort
  boundary. This is not a blanket removal of every runtime budget.
- Seconds are intentionally hidden for work lasting an hour or more. Existing
  historical rows are not mass-rewritten. The one confirmed stale Alex reply
  can be repaired locally from its runtime failure receipt with its original
  browser state backed up first.
- The deterministic checks prove local policy and UI behavior, not a live
  45-minute Claude/Codex provider run or a published release.
