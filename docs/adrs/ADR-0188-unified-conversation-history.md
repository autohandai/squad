# ADR-0188: One history manager and explicit transcript merges

Date: 2026-11-09

## Context and evidence

Saved engine conversations and independent reply threads had separate entry
points. Previous chats opened a popover; Threads opened a second list in the
reply sheet. The owner asked to consolidate their management, delete items and
also merge selected conversations. They remain different execution records:
an archived chat can hold provider resume identities, while each thread owns
its independent runs. Combining those identities would misrepresent what an
engine can resume.

The chat record builder bounds ordinary archives to 400 messages and may drop
work evidence above its size budget. Reusing that truncating path for an
explicit merge would silently omit part of the selection.

## Decision

History is one plain side sheet beside New chat, with saved chats and reply
threads in the same divider list. Each row identifies its kind and working
state. Checkboxes support selected deletion with a second inline decision,
and merging two or more conversations with an optional name. Opening a saved
chat still waits for the current direct reply; independent threads remain
available. Stop this thread affects only its own work.

A merge creates a new saved chat and retains all originals. Preserve every
available message, attachment reference, author, work detail and run reference,
including each thread root. Keep each source transcript in selection order,
with its original internal order, and record source/message provenance on each
copied message. Generate new message identities to disambiguate collisions.
Use an empty provider-session map: the merged transcript is context for a fresh
engine session, never a splice of incompatible resume ids.

Reject a selection over the message or byte limit before saving; do not trim
it. Refuse merging a working thread until the person stops it, holding the
thread mutation lock across snapshot and save so a new reply cannot race the
live-state check. Refuse merges at the saved-chat capacity instead of pruning
originals to make room. Stable request ids make retries idempotent and reject
different selections using the same id.

Thread deletion retains creation-request tombstones. A stale open sheet cannot
recreate a removed thread; a new explicit Reply has a new creation request and
can start one. Stop also covers the period before a run id has arrived, so a
late launch cannot escape the person's decision. Saved-chat deletion records
a tombstone before removing the file; startup completes any interrupted removal.

## Validation

`check-conversation-history.mjs` first failed because the unified endpoint did
not exist. It now verifies a mixed saved-chat/thread selection, all messages
including roots, colliding ids, attachments and trace preservation, empty engine
sessions, retained originals, retry/collision handling, refusal above 400
messages, persistent deletion and stale-thread recreation denial.

`check-thread-history-races.mjs` gates the actual route's workspace preparation
and late run receipt. It verifies merge/delete refusal while starting, Stop
preventing a not-yet-launched engine, exact cancellation of a late receipt,
unrelated work continuing and no deleted-thread resurrection.

`check-conversation-history-browser.mjs` passes in desktop light mode at 1440px
and dark mode at 380px: the unified list, selection/name/merge, retained originals,
two-step saved-chat/thread deletion and viewport fit. The existing chat and
independent-thread suites pass with isolated fixture engines. These checks do
not involve the installed app or live provider accounts.

## Consequences

A merge uses extra disk space and does not remove its source records. The
person can inspect the new conversation before deleting originals. Selection
order preserves the boundaries between discussions; it does not invent a
single chronological causal history or resolve contradictions between replies.
Evidence already limited in an old archive cannot be recovered by merging it;
the new record retains that limitation flag. Run evidence and produced files
remain after conversation deletion. Large selections require smaller merges
instead of a new unbounded storage format.
