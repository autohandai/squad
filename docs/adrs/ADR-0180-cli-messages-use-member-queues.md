# ADR-0180: CLI messages use the member conversation queue

Date: 2026-11-05

## Context and evidence

The external operator MCP had ten tools. Its `send_message(member_id)`
handler used `POST /api/runs`, while direct conversations select chat runs
in `server/chats/transcript.mjs`. Consequently that tool started independent
Mission Control work and did not put a message in the member conversation.
This was confirmed by inspecting those entry points, then exercised with
the isolated bridge and fake Codex harness in `scripts/check-control-plane.mjs`.

The bridge already owns durable per-member queues, saved member profiles,
chat transcripts, published artifacts and the knowledge library. Reusing
those surfaces lets an operator CLI talk to the running app without sharing
a member's private MCP credential or creating another engine session.

## Decision

Add eight operator tools: `message_member`, `get_conversation`,
`get_member_queue`, `wait_for_message`, `list_artifacts`, `get_artifact`,
`list_memories`, and `read_memory`. Keep the existing run/goal/channel tools
compatible. Direct messages enqueue against a known member and reuse its
last work/queue workspace, then its registered project. They do not preempt
busy work or resume a paused queue. Waiting returns a receipt outcome rather
than holding an MCP call for an entire agent turn.

Extract the reusable transport/tool implementation into `runtime.mjs`.
Autohand Code bundles an attributed copy of that module and the schemas,
avoiding an app installation or new package dependency just to initialize
MCP. The CLI owns its selected recipient for one session; explicit messages
do not change it. Managed members keep their scoped MCP and do not receive
the operator connection. Library access is read-only and all output strings
are redacted. Loopback HTTP redirects are refused. Stdio handles cancellation
while waits are pending; concurrent tool requests are bounded at 64.

## Validation

Run `node scripts/check-control-plane.mjs`: 158 assertions pass against an
isolated real bridge with a fake harness. This covers a queued message and
reply in the actual chat transcript, a receipt matching queue state, redacted
replies, busy-member ordering, cancellation of a wait without cancelling
delivery, library listing, the legacy run/channel flows and both framings.
The CLI's Tuistory scenario additionally exercises keyboard selection,
direct delivery/history and discovery/calling the bundled MCP through the
normal tool-search and permission path. No real member is messaged.

## Consequences

The operator connection can read the person's library; it is unsuitable as
a managed member credential. Queue acceptance and agent completion are
distinct. There is no automatic send retry/idempotency key: callers that
lose a receipt must inspect the queue before resending. Transcript reads
are bounded to bridge history and do not replace archived-chat retrieval.
Artifacts return metadata/links, not executable content. Creating members
and changing models remain app operations. The CLI vendor copy must be
updated with the canonical schemas/runtime and its source revision recorded;
there is no shared published package or automatic cross-repository rollout.
