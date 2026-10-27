# Squad API

Squad's independent control plane, intended for desktop sync and a future hosted
multi-tenant product. This is a separate Worker, database and pair of private R2
buckets, not a namespace hosted by the general Autohand API.

`cloudflare.config.ts` defines the service and its bindings. `/health` identifies
the service; private operations require a **Squad session**, not an Autohand
inference/API token. Autohand identity is verified only at session exchange.

## Run and verify

Use Node 24.22+ and npm in this directory:

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

Cloud sync currently covers shared team memories. Hosted execution, profile and
message sync, member/project mapping, account purge/export, billing, orphan
collection and retention policies remain future work. See
[ADR-0151](../../docs/adrs/ADR-0151-dedicated-multitenant-squad-api.md) and
[ADR-0152](../../docs/adrs/ADR-0152-explicit-cloud-memory-sync.md).
