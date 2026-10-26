# ADR-0147: Direct messages share admission with queued follow-ups

Date: 2026-10-26. Status: Accepted.

## Context and evidence

The reported conversation had a completed reply and an unpaused follow-up
still labelled Next. Read-only inspection found that the item had never
started before it was manually sent. Recent run timings also showed a later
direct message starting before the earlier greeting finished. The cancelled
item cannot establish how long it would have waited without intervention;
the overlapping turns establish that queue order was not enforced at entry.

The durable dispatcher correctly waits while its member is busy. But only
the browser's local sending flag decided whether to enqueue a message. The
ordinary JSON and streaming chat routes accepted direct turns without
checking existing follow-ups. A second window could consider itself idle,
start a later turn and keep the saved queue waiting. Polling faster cannot
repair that priority inversion.

Initial hypotheses included a leaked SDK busy flag and a missing completion
signal. The existing `check-queues.mjs` passed its Codex/Claude lifecycle
checks. A new SDK control also passed: finish the first prompt, and the saved
follow-up runs. The failing reproduction adds one later direct caller while
that follow-up waits. Before the fix:

```
node scripts/check-queue-admission.mjs
SDK control passed: completion releases the member and the follow-up runs.
AssertionError: a later direct message bypassed the saved follow-up and kept its member busy
true !== false
```

This corrected the initial suspicion of ordinary SDK completion being broken.
It does not imply every long provider turn is a queue bug.

## Decision

The existing QueueDispatcher owns admission for ordinary member DMs as well
as queued execution. A per-member promise chain serializes asynchronous idle
checks; a reservation holds an admitted direct turn until its route releases
it in `finally`. A new caller joins the durable queue if a direct turn, a queue
worker, another busy owner or an older queued item exists. The dispatcher
respects reservations before and after awaiting eligibility checks. Members
remain independent; there is no global chat lock or separate harness launcher.

Both chat endpoints acknowledge a saved follow-up explicitly: JSON returns
201 with `queued: true` and the public item; SSE sends `queued` and ends.
The app removes its optimistic question/answer placeholders, refreshes the
existing queue and reconciles the actual question/reply when execution starts.
It does not fabricate an empty answer, record a completed turn or delegate
from that acknowledgement. Drafts remain independent of queue reconciliation.

Explicit Send now / Cmd+Enter carries `interruptQueue: true` through the
existing interruption path. Channel work, goals, collaboration turns,
independent/ephemeral reply threads and utility/anonymous calls keep their
existing contracts. Queue launch snapshots also preserve effort and access;
they were accepted by the UI but omitted from the private launch allowlist.

## Validation

- `node scripts/check-queue-admission.mjs --browser`: real isolated bridge,
  durable store and session lifecycle, with gated SDK/CLI/ACP fixtures. Each
  of Autohand, Codex, Claude Code and ACP executes the initial turn, queued
  head and later message once in order. Both JSON and SSE entry points are
  covered, along with simultaneous idle sends, explicit interruption and
  release after a failed direct turn. Saved effort/access are checked on disk.
- The browser case sends from a document that has no local sending flag while
  another client holds the member. It verifies the queue row replaces the
  optimistic bubbles, the queued turn starts automatically, one question and
  its answer appear, and an unsent draft survives. Artifacts:
  `.codex-artifacts/queue-admission-waiting.png` and
  `.codex-artifacts/queue-admission-delivered.png`.
- `node scripts/check-queues.mjs`: FIFO, edit/reorder, pause/resume, break,
  Stop, clear, interrupted restart recovery and context gauges.
- `node scripts/check-member-threads.mjs`: independent member/channel threads
  still execute concurrently, preserve their histories and stop independently.
- `bun run build`: production JSX and bundle validation.

Claude's first matrix fixture stalled on its readiness `--help` probe: unlike
the existing fixture, the new gated executable waited for every unknown
prompt. Adding the help response fixed the fixture; no production harness
change was justified by that timeout.

## Consequences and limits

- Ordinary requests from a window with stale local state may now receive a
  queued acknowledgement rather than an immediate model stream. Clients must
  handle the documented result and follow queue state. Deploy the matching
  frontend and bridge together.
- An older paused follow-up also holds newer ordinary messages. Resume or
  explicit Send now is required; a second window cannot accidentally bypass
  the person's pause. An empty paused queue does not prevent a fresh direct
  turn. Existing failure/Stop/restart pause rules remain unchanged.
- This fixes admission fairness, not arbitrary provider hangs. Work that is
  actually still running continues to block ordinary follow-ups; it is not
  declared idle merely because reply text appeared.
- Independent threads remain outside DM serialization, but existing member
  busy rules can still make a DM follow-up wait for other owned work.
- Fixtures prove bridge, harness-adapter and rendered-browser behavior. They
  do not prove live provider latency or a published desktop release. The
  already cancelled real follow-up was not silently resent.
