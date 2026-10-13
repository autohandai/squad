# ADR-0074: Show saved thread records when messages are unavailable

Status: accepted

## Context

The channel regression verifier retained coverage for an archived thread with
`replyCount: 2` and no messages. The current flat stream (DESIGN.md) receives
only `messagesByChannel`; it does not read thread metadata. Inspecting this seam
showed that removing or losing a transcript hides a still-persisted thread.
The old collapsed-thread assertions no longer describe the intended layout,
but that data-compatibility assertion still describes a necessary behavior.

The verifier also incorrectly pinned channel requests to the CLI, despite
ADR-0030's SDK session pool, and mocked chat without informing bridge-owned
presence (ADR-0016). Those fixture defects are distinct from the missing-record
defect. The fixture now holds active replies until presence is observed,
derives its presence response from those pending requests, and checks SDK/CLI
selection, inline replies, participants, follow-up selection/cancellation,
export, and recovery after reload. The initial label-only diagnosis did not
account for the mocked bridge having no active chats; that correction is kept
here so the next verifier change starts at the actual ownership boundary.

## Decision

Project saved thread metadata into the flat stream when the original root
message is absent. `channelTranscript` is a pure, read-only projection: it
keeps every actual message unchanged, filters foreign threads, deduplicates
roots, and adds a Squad record naming the saved title and unavailable content.
The stored count is explicitly a recorded count, not evidence of visible
replies or completed work. Partial transcripts retain their real replies.

## Consequences and tradeoffs

The projection restores discoverability and a thread target for follow-up;
it does not recover missing bodies. It never writes synthetic records back
to storage, adds unread messages, or invents authored member content. Exports
continue to use persisted messages; exporting these recovery notices is left
undone so a display-only diagnostic does not become conversation history.
Actual root messages replace notices automatically when available again.
The current inline layout is preserved rather than resurrecting retired
collapse controls solely to satisfy stale test selectors.

## Verification

`scripts/check-channel-transcript.mjs` covers missing and partial roots,
unchanged actual messages, idempotence, duplicate metadata, channel isolation,
invalid counts and explicit missing-content text. The rendered regression
retains its archived-thread fallback assertion. Run results and proof limits
are recorded in `docs/reports/squad-reliability.md`.
