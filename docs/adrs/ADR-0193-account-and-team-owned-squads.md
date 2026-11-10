# ADR-0193: Bind every Squad data path to a verified owner

Date: 2026-11-10
Status: In progress

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

An authenticated served-token client remains a remote transport even when two
bridges share one computer. Route its bearer credential through the destination
worker's token validation and restricted member-route allowlist. It must not
need the other broker's browser generation, bypass token checks through public
readiness, or acquire local operator authority. Actual attachment forwarding
and both loopback/nonloopback ownership tests exercise these boundaries.

Runtime readiness without a context returns machine information only. Review
found that exempting `/api/runtime` from the generation fence allowed an old
page to request a new owner's sessions and paths. Native analytics similarly
used to aggregate legacy machine files and materialize a machine snapshot;
it now performs pure, captured-owner reads and requires a generation for
private HTTP metrics. Identity-backed usage requests match both the current
credential fingerprint and its verified issuer before sending the credential.

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
  a changed broker PID. These lifecycle integrations remain in progress.
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
runtime evidence; native windows/daemon isolation, full writable runtime,
restore/reset handoff and installed-app verification are still outstanding.

`node scripts/check-owned-operations.mjs` exercises the durable operation
journal separately from restore execution: idempotent request IDs, phase and
revision fences, and actual dataset pointer publication whose final response
is deliberately omitted. Recovery observes that committed pointer and waits
for an explicit restart; it does not publish the import again. An interrupted
operation before publication retains the old pointer, and actor/owner checks
reject another window's receipt. This metadata foundation is implemented;
restore execution and its UI handoff still need integration.
