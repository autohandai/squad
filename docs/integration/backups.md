# Owned Squad data and portable backups

The version 1 format is `autohand-squad`. JSON and YAML encode the same data
model; neither format requires a particular harness. Definitions may retain
Claude, Codex, Autohand or other provider-specific fields, but credentials and
engine resume capabilities are excluded. Namespaced `extensions` preserve
unknown integration data without interpreting it as an access grant.

The normative JSON Schema is
[`packages/squad-portable/squad-backup.schema.json`](../../packages/squad-portable/squad-backup.schema.json).
The API publishes it at `/schemas/squad-backup-v1.json`. The shared validator
also enforces cross-record uniqueness, file coverage and byte checksums that
JSON Schema alone cannot express. Run `node scripts/check-squad-portable.mjs`
to validate the package and regenerate the schema.

## Document fields

| Field | Meaning |
| --- | --- |
| `format`, `schemaVersion`, `createdAt` | Format discriminator, major version and snapshot timestamp |
| `owner` | Source provenance: `{kind: user|team, issuer, id}`; never destination authority |
| `agents` | Each member's ID, profile, memories, conversations, routines, skills, file references and extensions |
| `shared` | Shared structured data and managed-file references |
| `workspaces` | Folder labels and path hints; external content is not implicitly copied |
| `omissions` | Explicit excluded/missing paths and reasons |
| `extensions` | Namespaced data for interoperating consumers |
| `files` | Exact base64 payloads keyed by `{agentId, id}`; `agentId: null` means shared |

Each file reference has a portable relative path, kind, MIME type, SHA-256 and
byte count. A file ID/path is scoped to its member, so two members may both
have `MEMORY.md`. Paths cannot traverse directories, use symbolic links, or
contain Windows device names/invalid filename characters. YAML aliases,
duplicate keys, custom tags and unsafe object keys are rejected. Unknown major
versions fail explicitly. Per-file limit: 25 MiB; document limit: 256 MiB;
maximum inventory: 100,000 files. Limits fail with an error or a visible
exclusion; a successful result never silently truncates a file.

## Hosted API

Use `/v1/users/me` for personal data or `/v1/teams/:accountId` for an existing
Autohand team. Authenticate with a Squad session from `/v1/auth/exchange`.
Team operations additionally require `X-Autohand-Identity`; the API verifies
the identity matches the session and rechecks current `/v1/accounts` access.
Squad cloud-sync tenant IDs are a separate domain, not Autohand team accounts.

| Relative route | Behavior |
| --- | --- |
| `GET /agents?limit=100&cursor=…` | Canonical owned roster |
| `GET /agents/:id` | Immutable revision content behind the current head |
| `PUT /agents/:id` | CAS publish `{baseRevision,content}` with `Idempotency-Key`; null content is a tombstone |
| `GET /agents/:id/memories` | Memory entries and document references |
| `GET /agents/:id/files` | Managed inventory |
| `GET /agents/:id/files/:fileId` | Raw bytes with attachment headers |
| `PUT /files/:sha256` | Upload raw bytes before publishing their references |
| `GET /state`, `PUT /state` | Shared owned metadata with the same CAS contract |
| `GET /export?format=json|yaml` | Bounded convenience export; repeat `agent` to select members |
| `POST /exports` | Freeze a coherent export plan with an idempotency key |
| `GET /exports?limit=50&cursor=…` | List retained backups, newest first, with an opaque pagination cursor |
| `GET /exports/:plan` | Read an authorized plan's immutable snapshot metadata |
| `POST /exports/:plan/retain` | Writable owner explicitly retains a frozen backup with `{label}`; idempotent and does not rename on retry |
| `DELETE /exports/:plan` | Writable owner removes a backup plan with `{confirm:"remove-cloud-backup"}`; live agent records are kept |
| `GET /exports/:plan/agents?limit=100&cursor=…` | Page frozen revision pointers |
| `GET /exports/:plan/agents/:id` | Frozen member content |
| `GET /exports/:plan/agents/:id/files/:file` | Its exact file bytes |
| `GET /exports/:plan/state` | Frozen shared state |
| `GET /exports/:plan/state/files/:file` | Shared file bytes |

Plan body: optional `agentIds` and `includeShared`. A selected-member plan
defaults to excluding shared content. Plans expire after 24 hours and cannot
be reused after membership revocation. Records may change or be deleted while
an authorized export continues reading its frozen revisions. The local Node
exporter uses these pages and verifies all file hashes before publishing a
finished file; ordinary current-head pagination is not a coherent snapshot.

A writable owner can also supply a validated portable `state` in that plan
body. It creates immutable plan-owned state, without updating the live `/state`
head. Upload its referenced blobs first. This allows selected-member backups to
retain workspace references and exclusions safely. `agentIds: []` explicitly
captures no members and can back up shared-only state; omitted `agentIds` means
all current members. The request hash includes custom state for safe replay.

An explicitly retained plan reports `retainedAt` and `expiresAt: null`. It
survives temporary-export cleanup and keeps immutable referenced versions until
removed. The application permits at most 1,000 retained plans per owner. Retain
and remove require write authority; reading still rechecks current access, so
retention cannot outlive a revoked membership. `GET /v1/me` includes immutable
`issuer` and `subject` for binding an exchanged session to the local actor.

## Local bridge and MCP

The broker validates immutable identity and owner selection before starting a
private dataset worker. Private requests carry `X-Squad-Context`; GET download
URLs can carry the generation as `context`. This is a context fence, not an
alternative identity credential. Account/scope transitions revoke requests,
streams and managed work tokens. Legacy unowned data stays hidden until an
explicit recovery import.

Outside-session hook installation binds `actorKey.ownerKey.datasetId` and the
public broker port in its command. Before each event it resolves the current
generation only when that exact actor/owner/dataset is selected and writable.
No credential is stored in the command. Legacy/unmatched commands do not
ingest terminal sessions; Settings requires an explicit installation for a new
destination. A matching binding can survive an ordinary service restart.

Main app live updates use `GET /api/owned/events`, with named change signals
`channels.changed`, `vault.changed` and `relay.message|channel|presence|status`.
Signals contain no private payload; re-read the relevant API with the captured
context. This combines domain streams so two app windows retain connection
capacity for saves. Remote member tokens cannot use operator-owned routes.

`POST /api/ownership/legacy/preview` accepts
`{id,stateRoot?,appRoot?,workspaceRoot?,browser?,consent:"preview-unowned-data"}`.
Use explicit absolute or `~/` paths. The state root contains `channels.json`;
the app root contains `agents/`. Optional managed work is copied only for
assigned paths inside its chosen root. Optional `browser` accepts only
`agents`, `removedAgents`, `messages`, `channels`, `channelThreads` and
`channelMessages`. Settings reads only those former unscoped keys after consent.
No account credential, vault or general browser storage is read. The result is
an ordinary actor-private import preview; use the same restore transaction to
review and confirm replacement. Sources stay unchanged. Matching canonical
definitions win over browser definitions; differing current conversations are
kept as archives. Browser-only automations and runtime capabilities are excluded.

Operator MCP exposes the same behavior as `prepare_legacy_recovery` with
`request_id`, exact `destination_owner`, chosen `state_root`, `app_root`,
optional `managed_work_root`/`browser_data` JSON and `confirm_preview:true`.
Its `source_id` is compatible with `restore_squad`. It does not auto-import.

`GET /api/owned/members` and `/api/owned/members/:id[/memories|/files]` read
canonical selected-owner data. `POST /api/backups` accepts `{format,memberIds?}`
and returns a UUID receipt and download URL. Exact bytes are downloaded at
`/api/backups/:id/download`. Exported profiles, memory/skill documents,
conversations, artifacts, referenced attachments and ordinary files in assigned
owned member homes are managed content. The `ai.autohand.squad` extension maps
managed workspace file prefixes to source path hints for rebasing on import.
Git authority, harness runtime directories, dependency caches and external
project contents are explicit exclusions. Custom avatar data URIs are preserved
in profiles; bundled product avatars keep their asset references.

Current browser conversations are saved separately from unsent drafts under
`/api/owned/browser-state`. Its PUT uses `baseRevision` to reject conflicting
windows instead of silently replacing newer saved conversations. A failed save
keeps local state and reports that backups need attention.

Restore and reset are broker transactions, not commands to a mutable worker.
All routes below require the captured context, a freshly authorized writable
owner and loopback access.

| Route | Contract |
| --- | --- |
| `POST /api/ownership/imports?format=json\|yaml&requestId=UUID` | Raw UTF-8 backup bytes, at most 256 MiB; verifies checksums and compatibility; returns an actor-private 24-hour preview |
| `GET /api/ownership/imports/:id` | Preview for the same actor and owner |
| `POST /api/ownership/operations` | `{id,kind:restore\|reset,beforeDatasetId,sourceId?,sourceDigest?,confirmation:"replace-current-squad"}`; same request ID and intent are idempotent |
| `GET /api/ownership/operations/:id` | Initiating actor’s durable receipt |
| `POST /api/ownership/operations/:id/restart` | `{revision}` acknowledges the exact committed dataset after fresh write authorization |

The preview names the selected destination and all recorded exclusions.
Publication stages a new dataset and changes one durable pointer only after
native and Node writers have drained. Earlier data is kept separately; this
operation does not merge two registries. Selected-member imports follow that
same explicit replacement rule. Source owner provenance cannot choose the
destination or grant access. Agents are on break, routines are disabled,
active historical replies/runs become interrupted, and sessions, Git and
external folder grants are not imported as authority.

Managed workspace bytes receive fresh contained folders. Project-scoped shared
memories remain unbound until folder scope is explicitly reconnected; they do
not become globally shared team memories. The preview reports these records.
Foreign text memories with no Squad-specific source files get member profile
memory entries. Unknown extension data and payloads remain portable source
material. Current reader limits, including 20 MiB artifacts, 400-message/4 MiB
chats, 100 archived chats/member and 200 shared-store memories, fail explicitly
rather than silently truncating the import. Routine definitions/history must
fit their canonical destination limits and carry a valid explicit schedule.

Completion is `awaiting_restart`, even after a lost response or broker relaunch.
`GET /api/ownership/context` reports the pending completion. Restart acknowledges
the durable operation; it does not depend on a PID changing. Another currently
authorized team operator may acknowledge a committed dataset without reading
the initiating actor's private source receipt. The original actor stays in the
journal and the acknowledging actor is recorded separately.

## Explicit cloud operations on the desktop

Discovery and local export never upload data or exchange a cloud session.
Cloud actions capture the current actor, owner, identity credential and dataset;
private cached sessions are verified through immutable `/v1/me` issuer/subject.
They live outside portable agent data. Context changes abort cloud requests and
drain their final filesystem cleanup before another owned transaction publishes.

| Local route | Contract |
| --- | --- |
| `GET /api/ownership/cloud/backups?cursor=…` | Explicitly connect and list the selected owner’s retained plans |
| `POST /api/ownership/cloud/backups` | `{id,backupId,label,resolutions?}` uploads an immutable local backup receipt; stable request IDs permit recovery |
| `GET /api/ownership/cloud/operations/:id` | Current actor’s private progress, conflicts and result |
| `POST /api/ownership/cloud/downloads` | `{id,planId,format}` creates a verified local download receipt, including for read-only teams |
| `POST /api/ownership/cloud/imports` | `{id,planId,format}` creates the same verified restore preview as file upload; no replacement yet |
| `POST /api/ownership/cloud/reconnect` | Explicitly replace only this actor/owner’s cached cloud session |
| `DELETE /api/ownership/cloud/backups/:id` | `{confirm:"remove-cloud-backup"}` removes the selected retained plan, preserving live agents and local files |

The uploader first compares current cloud records against its last confirmed
revisions. Newer/unrecognized cloud versions require explicit resolutions with
the reviewed key, remote revision/hash and `choice: local`. The selected source
file never changes during a retry. Only a complete frozen snapshot matching the
intended content is retained and reported as successful. Individual canonical
agent revisions may have committed before a later conflict or failed request;
the UI reports pending completion, keeps the local backup and never claims
rollback. Session revocation requires explicit Reconnect, not a hidden remint.

An ownership generation is a fence, not remote authentication. Non-loopback
requests require a served bearer and retain remote transport identity through
the broker so the worker enforces its limited remote routes. Passive read-only
workers do not serve remote members; local browsing and cloud downloads remain
available.

Operator tools and their context lease are documented in
[control-plane.md](control-plane.md). Managed member tools are self-only as
described in [teams.md](teams.md). Local restore/reset, cloud services and their
MCP paths, including manual legacy recovery, have isolated transaction/round-trip
and D1/R2 tests. Staged desktop-runtime checks also exercise packaged MCP
retrieval and JSON/YAML exports with exact managed-file bytes. Installed-app,
hosted deployment and release verification are separate from these checks.
