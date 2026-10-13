# ADR-0072: Channel success follows a committed mutation

Date: 2026-10-13 · Status: accepted

## Context and evidence

The reliability brief reported that creating a channel was impossible. Existing
browser verification intercepted `/api/channels`; aggregate `bun run ci` passed
before these changes, but did not cover the real channel lifecycle.

`node scripts/check-channel-lifecycle.mjs` against a disposable real bridge and
Chrome reproduced four independent defects before the fix:

- The sidebar dialog could create once, then timed out reopening. Its
  `closedAfterSubmit` flag only reset through the dialog's own open callback;
  the sidebar opens it through a prop, so the retained flag hid later dialogs.
- POST discarded channel projects (returned `undefined` for the saved path).
  The server normalizer omitted `projects`, although the browser included them.
- Twelve concurrent POSTs succeeded but GET retained only two channels.
  Each request read the same file and replaced it independently.
- Retrying a channel id failed. Name collisions were not prevented, and the
  browser announced success before a best-effort full-snapshot PUT completed.

This corrects the broader initial suspicion that channels were simply missing:
the screens and APIs exist; the lifecycle and verification were incomplete.

## Decision

Use the existing CRUD and membership APIs for user mutations. Navigation,
closing a create form, and agent creation announcements follow backend success.
Keep form input and a stable request id after a failure; suppress overlapping
submissions. Failed saves remain visible with an action to retry.

All bridge channel writers share a serialized read-modify-write queue and the
existing atomic JSON writer. Preserve projects, sidebar sections, git bindings,
events, legacy array documents and existing message/thread fields. Identical
creation retries return the original channel; other name collisions return 409.

Add an additive `/api/channels/sync` for browser caches and conversation updates.
Merge records by id and update time instead of replacing another window's
document. Persist deletion ids so stale caches cannot revive a deleted channel.
Keep the legacy snapshot PUT; callers supplying a revision receive 409 when
their snapshot is stale. Corrupt JSON causes a visible failure rather than an
empty state that could overwrite existing data.

## Consequences and limits

The file format remains version 1 with additive revision/deletion fields. Git
and relay share the queue; embedded test contexts retain their existing fallback
interfaces. This serializes one bridge process, not multiple independent bridge
processes writing the same state directory. Legacy revision-less snapshot PUT
remains replacement for compatibility and cannot detect stale old clients.

Deletion ids are retained without pruning to avoid resurrecting old caches.
Conversation metadata merges still use timestamps, so clock skew across remote
machines remains a limitation. Public/private remains the existing local label,
not a new multi-human security model. Provider execution and full agent channel
authorization are separate acceptance work; this decision does not claim them.

Verification results are recorded in `docs/reports/squad-reliability.md` as the
checks run. The gate is real backend/browser behavior, not source regexes.
