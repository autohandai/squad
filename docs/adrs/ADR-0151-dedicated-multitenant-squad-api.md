# ADR-0151: Give Squad an independent multi-tenant control plane

Date: 2026-10-27
Status: Accepted

## Context and evidence

An installed update check displayed GitHub HTTP 403. Source inspection found
that the default updater called the unauthenticated GitHub releases API. The
alternative Autohand API branch read a version from `/v1/squad/releases/…` but
populated no installer URL, name or checksum. Neither used a dedicated Squad
service. The transient GitHub refusal was not established to be a rate limit;
a later request succeeded.

Shared team memory was local `team.json`, not remote R2. Existing account/project
memory in the general API does not make this store a cloud sync implementation.
The operator explicitly requested a standalone API for future hosted,
multi-tenant Squad, rather than further routes inside the general API.

## Decision

Create `services/squad-api` as an independently installable, testable and
deployable service. Its Cloudflare configuration owns `squad.autohand.ai`, the
`squad-control-plane` D1 database, private `squad-memory` R2 bucket and separate
`squad-releases` bucket. It imports/binds no general API internal code or data
resources. The package stays in this repository to test desktop/API contracts
together; deployment is independent and the package can later be extracted.

Reuse Autohand identity through an HTTPS profile check at explicit session
exchange. Issue separate opaque Squad sessions with hashes at rest, expiry
and revocation. Squad owns identity mappings, tenants, owner/admin/editor/viewer
memberships, invitations, workspaces, devices, memory revisions and content-free
audit events. Device registration alone grants no hosted runner authority.

Every private operation resolves current membership in D1. Tenant/workspace
IDs are jointly checked, never accepted as authority. Unknown and inaccessible
tenants both return 404. Private responses use `no-store`; browser origins are
allowlisted. Membership removal applies on the next request without a cached
role. Invitations are expiring, email-bound capabilities returned to the
inviter; the service sends no email.

Write immutable, tenant/workspace/entry-scoped memory JSON to R2 first. A D1
batch atomically compares/advances its revision, appends an ordered change
record and saves the idempotency receipt. A pointer cannot precede its object;
a rejected compare cannot overwrite the winner. Tombstones keep scope and
revision, so an old create at revision zero cannot resurrect them. One entry's
scope is immutable; cloud project/member IDs are portable identifiers, not paths.

D1 transactions are sufficient for these bounded memory operations. A Durable
Object per workspace would add a second coordinator before hosted execution
or live presence needs it. Future run coordination and tenant/database sharding
are separate design decisions, not claims about current scalability.

Serve a versioned public release manifest from Squad-owned R2, with ETags and
cache headers. A separate CI publisher credential changes channel pointers;
tenant roles cannot publish software. Stable metadata is immutable per version
and cannot downgrade the channel. CI verifies checksums and complete desktop
platform coverage before publication. Desktop checks prefer Squad's feed;
official immutable GitHub assets remain the download transport. During bootstrap,
`auto` falls back to GitHub only for API unavailability (transport/404/429/5xx).
Invalid metadata, redirects and permission failures fail closed. Environment
`AUTOHAND_SQUAD_UPDATE_SOURCE=api` requires the dedicated API; `github` remains
an explicit diagnostic option.

## Consequences and deferred work

- This is a control-plane/memory foundation, not hosted execution, billing or
  a complete browser edition. Existing members and MCP operations keep their
  local execution behavior.
- R2/D1 do not share a distributed transaction. Ambiguous failures can retain
  orphan objects; deleting a potentially committed object would be worse.
  Orphan collection, change-log retention, tenant export/purge and plan quotas
  remain deferred. Entry text follows the desktop's 500-character contract;
  the initial workspace limit includes 2,000 entries/tombstones.
- One D1 database is an initial scaling boundary, not a throughput promise.
  The future hosted data plane needs separately scoped workload credentials.
- Upstream identity revocation is not a synchronous cross-service transaction.
  Squad session revocation and tenant membership are checked at their own
  boundaries; identity tokens can authorize new session exchanges.
- First-party installer mirroring, signed update manifests and Apple
  notarization are not established by this service.
- Deployment requires the intended account and publisher secret. The initial
  `cf` login was unavailable; the operator selected Wrangler, whose OAuth login
  authenticated the account owning `autohand.ai`. That temporary operator token
  is not a CI deployment credential. Automatic API deployment stays disabled
  until a separately scoped credential is configured. Local validation alone
  does not establish a live hostname or deployed migration.

## Evidence and validation

Installed `cf` configuration types define bindings; generated workerd types
derive the environment. `npm run build` creates an independent Worker bundle.
`npm test` exercises real HTTP routing, sessions, D1 batches and R2 in workerd:
tenant/workspace isolation, role changes/revocation, competing writes, retries,
deletion cursors, publication authority and ETags. Two isolated desktop stores
also synchronize through that HTTP service. Identity is a fixture; actual
user memory is never uploaded by these checks.

The final integration run passed ten tests. The release publisher also builds
the complete four-target metadata twice from immutable GitHub publication
metadata and verifies that replaying it returns the same release, while a
corrupt installer fails before publication. The daemon's 93 library tests and
30 desktop-update cases passed; these do not substitute for a published native
release or an installed-app update.

The loop caught a platform difference: Node-style `redirect: error` is not
implemented by Workers fetch. Explicit `manual` checking now refuses redirects
without forwarding identity credentials. A Node mock would have missed it.

Storage behavior relies on [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
and [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/).
