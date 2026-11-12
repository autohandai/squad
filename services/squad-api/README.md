# Squad API

Squad's independent control plane, intended for desktop sync and a future hosted
multi-tenant product. This is a separate Worker, database and pair of private R2
buckets, not a namespace hosted by the general Autohand API.

`cloudflare.config.ts` defines the service and its bindings. `/health` identifies
the service; private operations require a **Squad session**, not an Autohand
inference/API token. Autohand identity is verified at session exchange and
again for current-owner operations such as phone relay control and team access.

## Run and verify

Use Node 24.22+ and npm in this directory:

Install the repository's root dependencies first with `bun install --frozen-lockfile`.
The interoperability tests execute the real desktop backup client and broker;
an API-only dependency installation cannot resolve those runtime modules.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Tests run actual workerd HTTP routing, D1 transactions and R2 storage with a
fixture identity provider. They also run two temporary desktop stores through
the API. They do not upload a real user's memories.

For a local persistent API, use the same ID and persistence folder for the
migration and dev server:

```sh
export SQUAD_API_DATABASE_ID=00000000-0000-4000-8000-000000000001
node_modules/.bin/cf d1 migrations apply "$SQUAD_API_DATABASE_ID" --dir migrations --local --persist-to .cloudflare/local-state
node_modules/.bin/cf dev --local --persist-to .cloudflare/local-state --port 8787
```

Point a desktop bridge at `AUTOHAND_SQUAD_API_URL=http://127.0.0.1:8787`.
Cloud sync remains off until Settings → Cloud sync → Enable sync. Opening the
section or discovering workspaces does not upload memories.

## Domain and authority

- A tenant is a cloud access group, shown as a team. Memberships belong to people
  and carry owner/admin/editor/viewer roles; these are distinct from agent members.
- A cloud workspace contains shared Squad data across devices. It is not a Git
  checkout path. Project/member memory references use portable IDs.
- A device registration is scoped to a user, tenant and workspace. It is not a
  credential for hosted code execution.
- Roles are checked on every private request. A tenant/workspace ID alone grants
  nothing. Owner removal is refused; ownership transfer is not implemented yet.
- Memory mutations require `baseRevision` and `Idempotency-Key`. A 409 means read
  the current entry before choosing a resolution. Deletions are versioned
  tombstones (`content: null`), not missing objects. Scope cannot change in place.

All private responses are `Cache-Control: no-store`. Success uses
`{success:true,data:...}`; errors use `{success:false,error:{code,message},requestId}`.
The public release manifest is a flat, versioned JSON document, with ETags.

## HTTP contracts

| Method | Path | Authority / result |
|---|---|---|
| POST | `/v1/auth/exchange` | `{identityToken,deviceName}` → 24-hour Squad session |
| GET / DELETE | `/v1/auth/sessions`, `/v1/auth/sessions/:id` | List / revoke own sessions |
| DELETE | `/v1/auth/session` | Revoke current session |
| GET | `/v1/me` | Current Squad identity |
| GET | `/v1/owners` | Personal owner and, with `X-Autohand-Identity`, currently accessible Autohand team owners |
| GET / POST | `/v1/tenants` | List memberships / create a team as owner |
| PATCH | `/v1/tenants/:tenant` | Administrator renames a team |
| GET | `/v1/tenants/:tenant/members` | Human memberships |
| PATCH / DELETE | `/v1/tenants/:tenant/members/:user` | Manage non-owner membership; only owner grants/manages admins |
| POST / DELETE | `/v1/tenants/:tenant/invitations`, `.../invitations/:id` | Create / revoke email-bound invitation; no email is sent |
| POST | `/v1/invitations/accept` | Accept capability with matching signed-in email |
| GET / POST | `/v1/tenants/:tenant/workspaces` | List / administrator creates workspace |
| DELETE | `/v1/tenants/:tenant/workspaces/:workspace` | Administrator archives workspace, preserving data |
| GET / POST | `/v1/tenants/:tenant/workspaces/:workspace/devices` | List / register own device |
| GET / PUT | `/v1/tenants/:tenant/workspaces/:workspace/memory/:id` | Read / editor CAS mutation |
| GET | `/v1/tenants/:tenant/workspaces/:workspace/memory/changes?cursor=0&limit=100` | Ordered immutable changes, including deletions |
| GET | `/v1/tenants/:tenant/audit` | Administrator reads latest content-free events |
| GET / PUT | `/v1/releases/:channel/manifest` | Public discovery / separate publisher credential |

## Encrypted phone relay

Computers explicitly enable **Reach from anywhere** and connect outbound to
the `MobileRelay` SQLite Durable Object export. Every control route below
requires a Squad session and `X-Autohand-Identity` for the same actor. Team
write access is freshly checked. Room IDs bind actor, owner, dataset and
computer; knowing an ID is not authority.

| Method | Path | Body / result |
| --- | --- | --- |
| POST | `/v1/mobile-relays` | `{computerID,actorID,ownerScope,teamID?}` → `{roomID}`; ownerScope is the desktop's opaque dataset scope SHA-256 |
| GET + WebSocket upgrade | `/v1/mobile-relays/:roomID/host` | One outbound computer socket; `relay.ready` confirms protocol, computerID and leaseUntil |
| POST | `/v1/mobile-relays/:roomID/lease` | Renew the ten-minute host lease after current access verification |
| POST | `/v1/mobile-relays/:roomID/offers` | `{pairingID,expiresAt}` → `{endpoint,relayToken}`; ten-minute bootstrap route |
| POST | `/v1/mobile-relays/:roomID/offers/:pairingID/approve` | `{deviceID}` promotes that route after local matching-code approval |
| POST | `/v1/mobile-relays/:roomID/devices/sync` | `{deviceIDs}` removes cloud capabilities no longer in the local private key store |
| DELETE | `/v1/mobile-relays/:roomID/devices/:deviceID` | Remove one phone's routing capability |
| POST | `/mobile/:roomID/v1/mobile` | Native phone `{relayToken,packet}` → original encrypted packet; no account credential |

The public route rejects browser Origins, unknown routes, invalid/expired
capabilities and unapproved device IDs. Raw capabilities stay in QR/device
storage and POST bodies; only SHA-256 hashes persist at the relay. Socket
frames contain ciphertext and routing IDs, not Autohand credentials or keys.
The relay has no durable message queue: at most sixteen pending requests,
twenty approved phones and 25 seconds per response. Reconnect does not replay
work. The computer's durable receipt and canonical queue own deduplication.
Apply migration `0003_mobile_relays.sql` before deploying the SQLite export.
See [phone protocol and verification](../../docs/integration/mobile-companion.md)
and [ADR-0212](../../docs/adrs/ADR-0212-outbound-encrypted-phone-relay.md).

## Owned agents and portable backups

Personal agents live under `/v1/users/me`; Autohand team agents live under
`/v1/teams/:accountId`. Both require a Squad session. Team requests also require
`X-Autohand-Identity`, matching the session's immutable identity, so current
Autohand account membership and write permissions can be rechecked. These
owners are separate from the cloud-sync tenants above.

Each owner exposes agent and shared-state retrieval, revision-checked writes,
managed-file uploads/downloads, JSON/YAML export, and retained immutable backup
plans. The public format is versioned as `autohand-squad` v1 and published at
`/schemas/squad-backup-v1.json`. See the complete
[owned API and backup contracts](../../docs/integration/backups.md#hosted-api)
for routes, limits, authentication, pagination and retry behavior. Retrieval
does not implicitly publish a desktop's local data; cloud uploads are explicit.

Create a memory:

```json
{
  "baseRevision": 0,
  "content": {"text":"Keep provider proof with the change.","scope":"team","memberId":null,"projectId":null}
}
```

Use a new idempotency key for each logical edit and repeat the same key/body on
retry. A deletion uses the current base revision and `content: null`. Text is
limited to 500 characters; initial workspace capacity includes 2,000 entries
and tombstones. Changes are paged with the returned cursor and `hasMore`.

## Deployment and release publication

The target account must own `autohand.ai`. Create **new Squad-owned resources**:
`squad-control-plane` (D1), `squad-memory` and `squad-releases` (private R2).
Set `SQUAD_API_DATABASE_ID` to that database's real ID, apply `migrations/`, then
deploy. Never point the binding at the general API database.

Keep `global_fetch_strictly_public` enabled: identity and current team checks
call a public Cloudflare Worker. Local outbound-service fixtures cannot verify
that deployed routing. [ADR-0199](../../docs/adrs/ADR-0199-public-worker-identity-routing.md)
records the isolated hosted failure and flag-only comparison.

`RELEASE_PUBLISHER_TOKEN` is a Worker secret of at least 32 characters. The
matching CI secret is `SQUAD_RELEASE_PUBLISHER_TOKEN`. Configure it without
putting values in source, command arguments or logs.

`.github/workflows/squad-api.yml` verifies the independent package. Deployment
is explicit or enabled with `SQUAD_API_DEPLOY_ENABLED=true`; it needs the account,
database ID and deployment credential. `.github/workflows/release.yml` publishes
stable release metadata in a separate retryable job when
`SQUAD_API_RELEASES_ENABLED=true`. Installer hashes and all four desktop targets
are verified by `scripts/publish-squad-api-release.mjs` before that job writes
the channel pointer. `SQUAD_API_URL` defaults to `https://squad.autohand.ai`.

Desktop checks prefer this service. `AUTOHAND_SQUAD_UPDATE_SOURCE=api` requires
it; `github` explicitly selects legacy discovery. The default `auto` tolerates
temporary API unavailability during rollout, while malformed metadata and
permission failures fail closed. Nightly requires its own valid API metadata.
Existing general-account/inference settings are not repurposed as cloud sessions.

Automatic cloud sync currently covers shared team memories. Owned agent and
conversation backups are explicit snapshots, not continuous profile or message
sync. Hosted execution, account purge, billing, orphan-blob collection and
automatic retention policies remain future work. See
[ADR-0151](../../docs/adrs/ADR-0151-dedicated-multitenant-squad-api.md) and
[ADR-0152](../../docs/adrs/ADR-0152-explicit-cloud-memory-sync.md).
