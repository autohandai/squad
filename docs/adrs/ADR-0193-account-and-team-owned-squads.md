# ADR-0193: Bind every Squad data path to a verified owner

Date: 2026-11-10
Status: Implemented locally; release verification in progress

## Context and evidence

The reported account switch exposes the previous person's agents. Source
inspection found that App initializes its roster, messages and drafts from
unscoped localStorage before its sign-in gate renders. Native login persists
email/name rather than an immutable subject. Bridge stores, daemon queues,
status snapshots, native menus and usage caches share machine-level paths.
Clearing credentials or filtering a directory screen cannot establish isolation:
the old browser state is subsequently mirrored back into the bridge.

The existing Squad API has its own tenant membership system, but Autohand's
actual organizations are returned by `/v1/accounts`. `/v1/profile` identifies
the person and carries no team memberships. Upstream's unavailable-account
fallback returns only a personal account, so a missing team must not retain a
previous grant. Team read-only entitlement preserves retrieval while forbidding
resource mutations; roles alone do not express that distinction.

## Decision

Use an issuer plus immutable subject for personal ownership, and the issuer
plus existing Autohand account ID for team ownership. Email is never a key.
New agents inherit an explicit validated owner, including conversational,
onboarding, team-template, API and MCP creation paths. Profile snapshots cannot
transfer ownership.

Keep installation records and credentials at the machine service root. Place
private runtime state and generated member homes under owner namespaces. A
stable local broker admits requests to an immutable-context private worker.
Account or scope transitions close admission and subscriptions, drain the old
worker into its original namespace, revoke work tokens, invalidate native
surfaces and then activate the next context. Context generations bind browser
requests, subscriptions and operator MCP clients; an old response cannot become
new-account state. Browser bootstrap resolves ownership before mounting the
account app or reading private storage.

Within each owner namespace, `current.json` selects one UUID dataset. Workers
capture `datasets/<uuid>/{state,app,member-homes,logs}` for their entire lifetime;
browser storage includes that UUID as well as actor and owner. Restore/reset
stage another dataset and atomically publish its pointer, rather than applying
several independent file replacements. Validate ordinary directories beneath
the service root and refuse symlinks, hardlinked private records, malformed
pointers and namespace escapes. A failed staging operation must not publish
imported data into the active dataset. Retained datasets require explicit,
owner-scoped recovery/cleanup rather than automatic deletion.

Use a separate passive projection worker for verified read-only membership.
Inspection found that the normal runtime's constructors repair interrupted
queues, routines and histories; other startup paths reconnect Telegram/relay,
watch Git and dispatch HTTP workflow steps without reaching the agent-launch
guard. Merely blocking engine creation was therefore insufficient. The passive
worker initializes only checked readers and backup output. Failed identity or
revoked membership is locked, never interpreted as read-only access.

The hosted API authenticates its existing opaque Squad sessions. Team requests
also present the Autohand identity credential in a header, never a URL. Verify
that identity matches the Squad principal and resolve current upstream account
access for each team operation. Do not store that credential in D1 or return it
to the browser or MCP. Read/export remain available to current read-only team
members; write, restore and execution require resource-operation permission.

The operator chose manual legacy recovery. Preserve unowned originals, do not
display their roster to the next login, and require explicit recovery/import
into a selected authorized owner. Never infer ownership from the latest login,
an email match, a filesystem modification time or an imported document's owner.

DOM-loaded attachment images, media, downloads and member avatars cannot carry
fetch headers. Bind their local API URLs to the captured generation at render
time; keep saved references free of generations and credentials. The real
attachment browser check caught a decoded-image failure at this boundary.
Browser-managed fetches keep their header-based ownership fence.

Reload can occur before a debounced conversation save. A draft in the exact
actor/owner/dataset browser namespace may be recovered automatically only when
its recorded verified revision still matches the canonical revision, all member
IDs remain authorized, and a fresh CAS succeeds. A missing revision, competing
write or failed save preserves the draft separately and keeps canonical data.
No other account's browser cache participates. The real attachment test caught
the pre-debounce reload case and now verifies saved/reopened file references;
the two-window backup test retains its conflicting-write/draft-recovery checks.

Canonical hydration also exposed an older registry omission: its member field
allowlist dropped `conversationStartedAt` and `lastConversationAt`, which had
previously survived only in browser storage. The execution-panel browser check
then showed yesterday's turns inside a newer conversation. Both timestamps now
persist in the canonical profile; the original old-turn exclusion assertion is
retained rather than relaxing it to accept the resurrected history.

An authenticated served-token client remains a remote transport even when two
bridges share one computer. Route its bearer credential through the destination
worker's token validation and restricted member-route allowlist. It must not
need the other broker's browser generation, bypass token checks through public
readiness, or acquire local operator authority. Actual attachment forwarding
and both loopback/nonloopback ownership tests exercise these boundaries.

Team-template validation found that paused routines were missing after import.
The initial suspicion was unresolved member IDs; the actual failure was the
worker calling its own rewritten Host address without the private transport
capability. Member design used the same self-request pattern. Internal calls
now use the captured broker origin and generation, with an ownership check
before and after transport; they never discover a newer account mid-operation.
Notification links and served-bridge addresses also name the public broker,
not an inaccessible private worker port. The real team-builder check verifies
both imported paused routines through the normal scheduler API.

Runtime readiness without a context returns machine information only. Review
found that exempting `/api/runtime` from the generation fence allowed an old
page to request a new owner's sessions and paths. Native analytics similarly
used to aggregate legacy machine files and materialize a machine snapshot;
it now performs pure, captured-owner reads and requires a generation for
private HTTP metrics. Identity-backed usage requests match both the current
credential fingerprint and its verified issuer before sending the credential.
The analytics integration check subsequently caught an omitted generation on
the web worker's native metrics request. Its fixture now asserts that exact
header; the bridge also checks its captured context after consuming the reply.
Only a loopback daemon address is admitted, with redirects refused.

## Consequences

- Team authorization requires a reachable authoritative account service and
  fails closed when that service cannot establish current membership. This
  adds upstream requests rather than retaining a stale membership grant.
- A scope transition initially pauses its old background work instead of
  keeping multiple accounts' execution running invisibly.
- The stable broker and private workers add lifecycle responsibilities, but
  avoid retargeting the existing global stores beneath active callbacks.
- Dataset staging costs disk space and copy time. Clones must not use hardlinks;
  typed managed path references need rebasing, while authored historical text
  stays intact. Graceful draining can save interrupted/paused statuses in the
  departing dataset; failed import does not promise byte-identical pre-drain
  records. A durable operation journal must distinguish a committed pointer
  from a lost response, and readiness uses owner/dataset/generation rather than
  a changed broker PID. Restore/reset use that journal and explicit restart
  handoff; the earlier dataset remains available for recovery.
- Read-only teams use a smaller browse/export surface. They do not mount the
  writable app or expose semantic GETs that start credential/provider probes.
- File permissions protect the local cache within the OS account. This does
  not claim encryption against someone who controls that same OS account.
- Older unowned data cannot be attributed reliably and needs manual recovery.

## Validation

`node scripts/check-squad-ownership.mjs` runs the real broker with isolated
fixture children: A -> B -> A, stale-context rejection, an explicitly admitted
in-flight request, private-port fencing and fresh team revocation pass.
`node scripts/check-owned-data.mjs` launches the actual passive `server.mjs`
worker against an isolated identity fixture. Seeded interrupted records remain
byte-identical, provider/execution routes are denied, no unexpected identity
service call occurs, and exact managed files export in JSON/YAML. This is local
runtime evidence. `check-owned-lifecycle.mjs` additionally runs the actual
writable broker and worker through account changes and process-tree cleanup.
`check-owned-backups-browser.mjs` exercises canonical hydration, restore and
explicit restart, manual recovery, and two simultaneous windows with competing
CAS saves and retained draft recovery at desktop and 390px widths. These checks
do not launch or replace the installed application.

`node scripts/check-owned-operations.mjs` exercises the durable operation
journal separately from restore execution: idempotent request IDs, phase and
revision fences, and actual dataset pointer publication whose final response
is deliberately omitted. Recovery observes that committed pointer and waits
for an explicit restart; it does not publish the import again. An interrupted
operation before publication retains the old pointer, and actor/owner checks
reject another window's receipt. The broker now uses that journal for actual
restore/reset; browser verification waits for its durable completion and an
explicit restart into a fresh dataset and JavaScript realm.

The full local native runtime suite passes 105 library tests and two binary
tests; the desktop-shell suite passes 32 tests. Those are filesystem, protocol
and process checks on macOS, not installed-window or Windows execution proof.
The Windows helper cross-check and remaining platform evidence are recorded in
ADR-0195. The hosted API suite passes 21 local D1/R2 tests and type checking;
this change has not yet deployed the hosted API or its migration.

## Review follow-up: local-cache write failures

The real owned Backups browser check reproduced an indefinite Loading screen when a quota error was raised inside the async hydration callback. A second argument to `.then` handled request rejection but missed errors thrown by that callback. The fulfillment chain now ends in `.catch`, fences stale ownership generations, clears the hydration latch and presents a local-storage error with Retry. Canonical data stays in the owner dataset; no cache is silently discarded.

The browser regression injects a quota failure at the actual owned messages write, verifies that Retry is offered without an unhandled rejection or a canonical conversation change, then removes the fault and retries through a new broker realm. Existing backup export/restore and two-window conflict checks run after recovery. This favors an explicit recoverable error over mounting private state after incomplete hydration.
