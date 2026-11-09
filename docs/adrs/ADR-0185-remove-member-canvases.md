# ADR-0185: Remove member canvases

Date: 2026-11-09

## Context and evidence

The owner asked to remove Canvas from agents. Member conversations exposed a
Canvas header button, a separate editor and canvas mentions despite already
having a Library for published deliverables. A browser regression observed one
Canvas header button where none was wanted. Channel documents have a separate
shared editing contract and were not the requested removal.

## Decision

Remove the member Canvas view, its mention suggestions and attachment path.
Keep deliverables in the member's Library. Consume old member-canvas links by
returning to the ordinary conversation. Reject member-canvas creation and
mutation with a removed-feature response, and exclude them from discovery.

Remove retired member-canvas entries from the rebuildable search index when it
opens, and refuse stale clients' indexing attempts. Keep channel canvases.

## Validation

`check-work-plans-browser.mjs` first failed with one member Canvas button. It
now passes in light and dark. `check-canvases.mjs` covers rejected creation and
edits, legacy reads and ordinary channel edits. The search retirement check
injects an older cache entry and verifies that reopening removes it, rejects
new indexing attempts, and retains a shared channel document. The broader
search check passed over 5,000 generated records in both FTS and fallback modes.

## Consequences

Original member-canvas files are retained and readable by exact ID for
recovery; this change does not erase existing content or migrate it into
artifacts automatically. The editor and active discovery are removed. Shared
channel documents remain, so this is not removal of every use of Canvas in
Squad or of HTML canvas rendering.
