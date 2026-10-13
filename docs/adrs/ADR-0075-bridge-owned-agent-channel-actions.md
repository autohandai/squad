# ADR-0075: Execute agent channel actions in the bridge

Status: accepted

## Context and evidence

The README promised that members could open channels with `SQUAD_ACTION`.
The implementation parsed those lines only in the browser's DM completion
callback. It did not inspect permissions, channel completions did not execute
actions, and the delayed purpose call captured the channel list from before
creation. A successful channel POST therefore did not prove purpose dispatch.

`node scripts/check-agent-channel-actions.mjs` drove `/api/chat` through the
actual SDK adapter with controlled output and isolated storage. Before the fix,
the ask-permission assertion failed: `channelActions[0].status` was undefined,
rather than a persisted, reviewable proposal. The first harness attempt failed
earlier because its temporary workspace was outside the user directory; moving
the workspace into the allowed repository reached the intended action seam.
That validation failure was not evidence of the channel bug.

## Decision

Process actions after successful chat and background-run completion, shared by
DM, channel, goal chat and tracked runs across SDK, CLI and external harness adapters. Identity and workspace
come from the execution request; action JSON accepts only type, name, existing
teammate names and purpose. Reject forged fields, ambiguous or missing members,
unassigned project scopes, stopped turns and unavailable members.

Add `squad_create_channel` to the existing tool policy and settings UI. All
autonomy rungs default to ask; legacy missing policy also asks. Allow creates,
ask persists a proposal, and block refuses with a visible result. Turning off
built-in runtime policy checks does not implicitly grant this separate channel
capability. Workspace overrides are resolved by the existing profile code.

Keep channel access, proposals, receipts and purpose deliveries in the existing
atomic channel document and mutation queue (ADR-0072). Explicit member-setting
writes update authority before the UI publishes the change. Later stale turn
payloads cannot replace an established grant, revive a removed member or erase
receipts. Legacy snapshot replacement preserves these bridge-owned fields;
additive cache sync never accepts them as authority. Remote settings forward to
the owning bridge with its existing token, failing visibly if it rejects them.

Use actor, request ID and action index for durable idempotency; a changed action
with a reused request ID fails. Goals use a stable ID per pursuit turn. Current
permissions, membership, project scope, breaks and proposal expiry are checked
again at approval. Concurrent approvals resolve once. A same-name channel is
reused only when the actor already belongs; its purpose and membership are not
silently replaced. Deleted-channel retries do not recreate it.

Commit the purpose root, thread and queued recipient deliveries with creation.
Dispatch through the existing runtime after the originating turn releases its
session. Persist actual replies or explicit delivery errors. Queued deliveries
can continue after restart; running deliveries become visibly interrupted and
are never automatically replayed. Automatic channel chains stop at two levels.
The browser displays receipts and plain approval rows; it never executes model
action text. Channel change events refresh open windows and unresolved proposals
remain in the Needs you count until explicitly resolved.

Background runs capture the same trusted action context at launch and expose
their final reply and receipts in the run summary. Completion waits for the
permission check and durable action write before emitting `run.finished`.
SDK error events with no reply fail the run, matching the existing chat error
decision in ADR-0061. Stop marks the run and aborts before awaiting its adapter,
so a late completion cannot create a channel while interruption is pending.

The real-provider onboarding screenshot exposed a further attribution defect:
the saved purpose named the member in its body but showed the human's name and
avatar. Purpose roots now carry the member ID while retaining the existing
prompt/thread role. Rendering and export honor that identity. On restart,
older roots recover identity only from their own bridge-owned action receipt;
their body, timestamp and completed deliveries are preserved without replay.

## Consequences and knowingly deferred work

The serialized store prevents competing approval, permission and channel writes
from losing each other. Atomic rename covers document writes; this is not a
cross-process lock, and two independent bridge processes must not write the
same state directory concurrently.

Purpose delivery is sequential and uses normal runtime timeout/availability
checks. It does not promise transactional rollback of tools a model already
ran. Interrupted or failed purpose work requires a new user channel prompt;
automatic retries and a separate retry queue are deliberately left undone.
Receipts are retained without pruning so old requests cannot replay; retention
limits require a future explicit migration. Proposals expire after 24 hours.

Permission authority follows the existing trusted local API and authenticated
remote bridge boundary. This does not sandbox a hostile shell-capable agent
against the local user's administrative APIs. Public/private remain the
existing local workspace labels, not multi-human ACLs. Cross-bridge proposal
aggregation and channel mirroring are deferred: review a remote proposal on
the bridge that owns the member. Run process handles remain ephemeral; the
durable channel receipts do not turn interrupted runs into restartable jobs.
CLI completion captures output for the existing trace/reply projection, which
adds memory use alongside its existing transcript. No deployment or native
release is implied.

## Verification

The regression uses a controlled SDK through real routes, persistence and the
session pool; it does not contact a provider. It covers ask/allow/block, actual
purpose adapter calls and persisted replies, approval races, restart, retry,
revocation during a held turn, forged fields, missing members, workspace scope,
breaks, expiry, deletion, corruption, interrupted delivery, remote grant
propagation and token revocation. Its optional browser journey checks visible
approval failure/retry and opens the confirmed channel. Results and broader
checkpoint limits are recorded in `docs/reports/squad-reliability.md`.

`check-run-channel-actions.mjs` initially reproduced nine missing action
receipts (ask/allow/block across SDK, CLI and Codex) and an SDK error incorrectly
marked completed. Its thirteen checks now cover those cases, duplicate run
requests, delayed output after Stop, revocation during execution and receipt
restart preservation. The controlled browser regression also checks actual
purpose attribution; the backend check repairs a legacy root without rerunning
completed deliveries. These controlled adapters remain distinct from provider
proof. The real clean onboarding journey verifies first chat, approval, purpose
delivery and reopening through the configured provider.
