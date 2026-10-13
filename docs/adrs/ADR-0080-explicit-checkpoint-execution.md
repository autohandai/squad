# ADR-0080: Execute explicit retries from saved handoff checkpoints

Status: accepted

## Context and evidence

Retry checkpoint previously marked a failed handoff pending and appended context
without dispatching a request. The real browser regression timed out waiting for
a recipient retry (`collaboration-retry-red.log`). An initial implementation
completed the task but left the old failure in its source conversation: shared
append events intentionally ignore duplicate message IDs. Retry results need
distinct attempt identities, without changing that event contract.

The second configured-provider probe exposed separate parent tasks for parallel
mentions from the original member, and premature review because Builder mentioned
a later Reviewer with `@`. All mentions dispatch immediately; the old runtime
instructions did not explain that consequence. This failed probe is retained in
`live-collaboration-second.json`, including Reviewer's observed missing tests.

## Decision

Execute a saved receiving checkpoint on explicit retry. Retain its handoff/request
ID, original context, workspace, attempt history and completed source work. Guard
rapid clicks synchronously and check current availability/permissions through the
existing runtime. Link child handoffs to their receiving parent and save its
confirmed own reply before delegation. Reconstruct failed ancestor results from
saved replies and completed child receipts after retry, without model execution.
Unknown or failed own executions cannot be reconstructed as success.

Parallel recipients of one reply share its parent. Explain immediate `@mention`
dispatch: ordered work mentions only the next recipient. Decline a busy receiving
member in both the app and bridge before another model request. A delegated
message's Retry uses its checkpoint; ordinary Retry retains its request ID so
channel-action receipt checks can recognise completed effects.

## Validation and tradeoffs

Eight browser/bridge checks pass: two-hop return, partial failure, rapid explicit
retry, sibling results, break refusal, parallel root mentions, busy refusal with
a competing real API request, and abrupt browser loss plus bridge restart followed
by review retry. The last case proves one implementation execution, one QA
execution and two review attempts, with the verdict returning to the origin.
Domain checks cover idempotent reconstruction and unresolved/own-failed states.
Configured-provider proof is separately reported; fixtures do not prove code
quality or provider availability.

Arbitrary file/command effects are not transactionally deduplicated. Retry asks
the recipient to inspect existing evidence before editing; completed source work
and bridge channel-action receipts have stronger reuse guarantees. Legacy
handoffs lack dependency links and cannot reconstruct lost ancestors. Tasks
remain in device-local browser storage without a cross-window task conflict
protocol or bridge delegation worker. Busy refusals require explicit retry,
without secretly queueing work.

The fresh-runtime browser driver has a 60-second cold bridge/browser/page setup budget after observed 10-second startup failures, while recipient execution assertions retain their existing bounds. Each HTTP call is bounded to 10 seconds. Failed/cancelled setup runs remain in the evidence; they are not product passes. A real signalled child cleanup probe passed in 2 ms after fixing a second-exit wait.

Configured-provider implementation, independent QA and review completed on one parent with final result return in the fifth probe. Its original assertion required `read_file`, even though Reviewer actually ran `cat README.md clamp.mjs clamp.test.mjs` and independently ran `node --test`. That probe failure is retained. The corrected evidence validator accepts a concrete read through either authorised path and rejects listings, test execution alone and unrelated reads. `node scripts/verify-collaboration-live-evidence.mjs` passed against the saved actual receipts, executing the generated test suite and four independent bounds assertions. This artifact check did not reopen the live browser after restart; that limit is separate from controlled restart coverage.

The additional normal error-message Retry regression selects the teammate by its accessible label, since an unread count changes the button text. The discarded exact-text driver failure is retained. Cold Chrome protocol initialisation uses the same bounded setup budget; subsequent protocol operations retain the original 15-second limit.

A further real browser regression found the source conversation’s returned handoff error lacked checkpoint metadata: its Retry reran completed implementation and made two parents (`collaboration-source-retry-red.log`). Returned results now retain handoff/task/request IDs. Explicit retry follows failed children when an ancestor has confirmed own output, so retry from the source conversation can resume review while preserving QA’s committed channel receipt and purpose execution. Clicking a historical completed error explains the current state instead of replaying work.

Final `node scripts/check-collaboration-cycle.mjs` passed all 11 cases with the current source, including both receiving and source error-message Retry, unchanged QA channel/purpose receipts after child retry, and a completed historical error explained without replay. Evidence: `collaboration-checkpoints-final-current.log`. The earlier 10-second cold-start failures, protocol initialisation failure and exact-text unread-badge locator failure are retained separately.
