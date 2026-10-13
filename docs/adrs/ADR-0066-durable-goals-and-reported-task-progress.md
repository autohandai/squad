# ADR-0066: Durable goals and reported task progress

Date: 2026-10-01
Status: Accepted

## Context and evidence

The user saw tool traces and a spinner but no task checklist or clear outcome.
They requested ongoing `/goal` pursuit across the selected harness. Inspection
of the sibling CLI corrected an initial assumption: its noninteractive
`--goal` invocation creates a goal and exits; it does not provide the desktop
app's continuing worker. A normal subprocess exit is also not completion.

The disposable Codex bridge fixture caught a separate readiness bug: an
external harness was resolving the Autohand provider before starting its own
executable. It now gates on the selected harness's own readiness.

## Decision

The bridge owns a persisted goal supervisor in the Squad state directory.
Each continuation reuses the selected harness's context. The browser subscribes
to progress but disconnecting only detaches that subscriber. Restarting pauses
active goals; the user explicitly resumes them. Pause/cancel interrupt the
worker and a late successful result cannot revive it. The default limits are
24 turns and four hours; lack of progress pauses for human attention.

Completion requires an explicit structured completed result, evidence, and no
unfinished reported checklist items. Blocked, failed, paused and cancelled stay
distinct. Remote-owned goals are rejected rather than silently run locally.
Ordinary chat remains one turn. Native plan/todo events and bounded structured
progress feed one inline checklist; only reported completed items are crossed
out. Tool activity alone is not a task list. Final updates carry the outcome
and unfinished work, with diagnostic trace behind Work details.

Main and quick-chat windows exchange per-message mutations rather than stale
whole conversation snapshots. Reset cutoffs reject delayed old-thread writes.
Goals independently recover from the bridge after reload.

## Validation

`check-goal-lifecycle.mjs` passed persistence, completion evidence, continuation,
limits, pause/cancel races, restart, break overrides and launch-credential exclusion.
`check-goal-bridge.mjs` passed two-turn disposable Codex and Claude subprocess
fixtures and an Autohand SDK fixture, including session reuse, native plans,
browser disconnect, interrupt and no dispatch on break. These are controlled
adapters, not live vendor/provider proof. Task progress and shared conversation
checks cover actual status normalization and stale/reset message races.

The browser suites passed 36 existing-surface screenshots and 17 goal, break,
login, updater and compact-window screenshots using isolated mocked bridges.
A compact follow-up showed the controls scrolling away and a crowded header;
quick chat now keeps goal controls outside the history scroller and shows only
status, harness and New chat in its header. The visual review also caught a
chronology bug: the user row had no request timestamp, so shared-message
sorting could put its answer first. Both rows now share that timestamp, with
the user row ordered first. Mock native submission checks do not establish
operating-system delivery.

The installed history exposed a separate stale-request problem: a loading row
from a previous bridge process still said it was waiting more than a day later.
Ordinary requests predating the current bridge start now show interruption and
Retry; their content and unfinished task states are preserved. Live requests,
unknown timestamps, final replies and durable goals are left to their actual
owners. `check-chat-recovery.mjs` verifies that boundary and idempotence.
The pinned Autohand 0.9.7 tool schema uses `tasks/content/status/activeForm`;
both live progress and historical traces now accept that shape. The member
instructions name each harness's real planning tool and teach the fallback
JSON form, rather than referring to an unexplained protocol.

## Consequences

Pursuit is bounded, visible and under human control. It still depends on the
local bridge process staying alive; restarting never auto-resumes. A harness
which does not report a plan shows activity without fabricated checklist
items. No-progress detection can pause useful but indistinguishable repeated
work. Remote goal supervision is deliberately left unsupported. Structured
completion is model-reported evidence, not independent verification of every
claim. Cross-window drafts remain local to each composer.

## Amendment, 2026-10-13: rehydrated goals keep conversation order

`node scripts/verify-goals-browser.mjs` failed at the Needs-you badge step:
the Replies preview for Eva showed an older goal summary ("Working through
the browser fixture") instead of the newest reply. The cause was in
`reconcileGoalMessages`: a durable goal that the bridge still holds but the
local conversation no longer has was appended at the bottom, after messages
that were sent later, and carried no `createdAt`. The newest-looking message
was therefore the stalest one. The same happens outside the fixture whenever
local messages are cleared or arrive from another window while a goal stays
on the bridge.

Decision: a rehydrated goal message is inserted before the first message
whose `createdAt` (or `startedAt`) is later than the goal's start, and
carries `createdAt: goal.startedAt`. Messages without any timestamp are left
in place; a goal is appended after them rather than guessed above them.
Existing goal messages still update in place. `node scripts/check-member-goals.mjs`
(now in `ci`) covers insertion, untimed neighbours, in-place update and the
no-change identity; the browser run passes end to end after the change.

Consequence: ordinary chat messages still carry only a display `time`, so
ordering among them remains array order. Only goal messages gain a timestamp
here; stamping every message is left for a later change.

