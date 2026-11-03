# ADR-0170: Stop agenda work when the person's message arrives

Date: 2026-11-03. Status: Accepted.

## Context and reproduction

The aggregate `check:always-on` first stopped on stale prompt assertions from
before ADR-0138. Updating those assertions exposed an actual integration bug:
`the person's message is answered` failed while the agenda fixture was holding
its background task. This is the existing real-bridge, controlled-engine case;
no provider or running installed app was involved.

ADR-0125 says the person wins over agenda-started work. Its listener stopped
that work on `chat.started`, which previously fired as the direct request
began. ADR-0147 correctly added admission before starting a chat, but the
agenda's own busy run then caused the request to queue. `chat.started` never
arrived, and the agenda kept the person waiting behind itself.

## Decision and consequences

Notify the agenda of an ordinary local person's DM before queue admission and
await stopping only work the agenda owns for that member. Update its idle
timestamp at arrival. Both JSON and streaming routes use the same seam after
remote/goal handling. Independent threads, ephemeral work, team/channel work
and ordinary already-running chats retain their admission contracts.

This is an interruption of opted-in background agenda work, as ADR-0125 already
promises. It does not let a later DM bypass earlier person follow-ups, cancel
unrelated runs, or silently resume a paused queue. The existing chat-started
listener remains useful for turns entered through other paths.

Validation uses `check:always-on` for the held agenda turn, person's reply,
stopped run, idle pause, later task, cap and restart. Queue-admission and routine
checks separately protect ordinary message order and scheduled work. Local
fixtures do not establish live vendor execution.
