# ADR-0197: Combine owned live updates to leave connections for data operations

Status: Implemented; verification in the ownership change.

## Context and evidence

The two-window backup/CAS check opened two pages in the same Chrome profile.
Each page rendered Backups, then the second page's ordinary saved-conversation
request stalled. The broker observer measured six concurrent event streams:
ownership, channels and vault in each page. The trace is reproducible with
`AUTOHAND_CHECK_TRACE=1 node scripts/check-owned-backups-browser.mjs`; the
pre-fix log is `.codex-artifacts/ownership/browser-two-pages-before.log`.
An earlier single-page browser check had passed, so it did not establish
multi-window behavior. The existing local HTTP server does not use HTTP/2;
long-lived streams can consume the browser's per-origin connection slots.

## Decision

The main app uses one `GET /api/owned/events` stream for channel, vault and relay
change signals. The independently available ownership stream remains active
before private UI is admitted. Combined signals carry no message, vault secret
or credential payload; consumers re-read through generation-bound HTTP APIs.
The broker closes the captured worker's connection on a context change.
Closing the response removes its event listeners. Read-only data views do not
construct execution updates.

Existing individual domain streams remain compatible for clients that use
them. `useVaultRequests` can still own its original subscription in standalone
surfaces; the main app explicitly supplies updates from its combined stream.

## Consequences

Two ordinary app windows use fewer long-lived browser connections, leaving
room for save/export requests. This does not make HTTP connection limits
unbounded. More windows, independent clients using legacy streams, and
long-running reply streams can still consume slots. Cross-window stream
leadership or an HTTP/2 server would address larger-scale coordination but
would introduce a separate lifecycle/TLS decision; this change does neither.

Validation uses two same-profile browser pages against the actual isolated
broker/worker: one page saves a current conversation, the stale page must fail
export on CAS conflict, and reloading retains its earlier draft while exporting
the canonical saved conversation. This exercises actual browser connection
behavior and the data boundary without a provider prompt or real account.
