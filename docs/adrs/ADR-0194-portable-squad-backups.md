# ADR-0194: One interoperable document for Squad backups

Date: 2026-11-10
Status: Implemented locally; release verification in progress

## Context

Existing share/import team presets intentionally omit runtime data. They do
not back up an agent's memories, conversations, routines, skills or file
contents. A preset cannot satisfy recovery or organization-level portability.
The operator explicitly requested both JSON/YAML and interoperability.

## Decision

Define one documented, versioned document and JSON Schema, with equivalent
JSON and YAML encodings. Preserve agent definitions, saved memories,
conversations, routines and managed files; file records carry relative paths,
media types, byte lengths and SHA-256 checksums. Preserve namespaced extension
data for other tools. Provenance records the source owner but grants no access
and never chooses the restore destination.

Separate immutable content-addressed file blobs from agent revisions in the
API. Upload blobs before publishing a revision that references them. Export
streams file contents rather than loading the whole organization's bytes into
a Worker. Document limits and fail explicitly rather than silently truncating
a backup. JSON and YAML use the same validator and content hashes.

Back up managed agent data, not an arbitrary checkout or the machine's home
directory. Inventory external folder references and missing or excluded files.
Credentials, device/MCP capabilities, native grants and provider session tokens
are excluded and reported. Restore asks for destination ownership and folder
mapping, creates new records without overwriting existing agents, reconnects
credentials separately, and leaves routines and other autonomous work paused.
File paths cannot traverse directories or use absolute/native device paths.
YAML aliases, duplicate keys, custom tags and unsafe object keys are rejected.

Operator MCP exposes the same service and returns a downloadable backup receipt
instead of passing file bytes through its generic secret-redaction layer, which
would corrupt base64 or checksums. Managed member tools keep their narrower
current-member authority and cannot export another account or entire team.

For larger hosted backups, freeze agent and shared-state revision pointers in
one D1 transaction, then page immutable, plan-bound records and files. Every
request rechecks owner access; the plan is not a capability that survives team
revocation. Plans expire after 24 hours. Node writes JSON/YAML to a private
partial file, incrementally checks every file hash and publishes exclusively
only after validation and fsync. It cannot overwrite an existing backup.

The hosted convenience response reserves a budget of 900 combined record/file
reads, 16 MiB of aggregate metadata and 100,000 structural nodes; larger exports
use the frozen plan path. These are application bounds, not measured platform
maxima. Individual metadata publications are limited before JSON parsing to
50,000 structural tokens and validated records to 50,000 nodes. Worker file
hashing uses `crypto.DigestStream`, avoiding a retained file-sized hash buffer.

Temporary exports expire after 24 hours; that is unsuitable for a deliberately
saved cloud backup. Retain an explicitly chosen frozen plan instead of extending
all temporary exports automatically. Retention keeps its immutable revision and
blob references, with a label and retention timestamp. Every later read still
reauthorizes the owner. A read-only operator can download a retained backup but
cannot retain or remove one. Retention is idempotent, does not rename on retry,
and has a per-owner guard of 1,000 retained plans. That number is an application
resource policy, not a measured hosted capacity. Removing a backup requires an
explicit confirmation and removes its plan, not live agent data or shared blobs.

The local upload path must use record CAS and surface remote conflicts rather
than blindly overwriting another device. It may update individual canonical
records before a later conflict; only a frozen plan validated against the
intended complete snapshot may be retained or reported as a successful backup.
Failed/partial uploads must remain visible as failures, with local data intact.
An uploaded backup may supply its own validated shared-state snapshot when the
plan is frozen. It writes a plan-owned immutable state object and never replaces
the live shared head. This matters for selected-member backups: their workspace
references and exclusions must survive without clearing shared team data or
accidentally including unrelated cloud members. Explicit `agentIds: []` means a
shared-only snapshot, not all agents. Uploading custom state requires current
write authority even though ordinary read-only export-plan creation is allowed.

## Consequences

- Backup and owned-file links open a separate browser target. The desktop shell
  already routes new HTTP windows through the system browser; a same-window
  attachment link would otherwise rely on an unverified WebView download path,
  the same class of failure reported in issue57. The URL retains the selected
  ownership generation, and the broker rechecks it before serving bytes. This
  keeps Squad open without introducing general filesystem IPC permissions.
  Saving is managed by the browser, so this does not offer an in-app save
  dialog and requires the local service to remain available during transfer.
  It does not repair the older blob-based conversation/draft export path.
  The owned-backups browser check clicks the actual receipt link, reads the
  resulting JSON file from a temporary download folder, verifies the member
  and exact managed memory bytes, and checks that Squad's page stayed open.
  This is browser/HTTP proof, not an installed WebView or OS-save-dialog test.

- Restore stages a fresh dataset and requires explicit replacement confirmation,
  rather than merging two independently authored registries. The old dataset is
  retained separately. This avoids guessing conflict winners across member,
  channel, thread, library and workspace identities; it knowingly leaves an
  automatic merge of backups out of this format version. Selected-member imports
  use the same replacement rule and the preview must say so.
- Fresh identities rebase typed relationships, not prose. Restored reply roots
  share the parent conversation's remapped message identity. Artifact IDs use
  the actual `artifact_UUID` route contract. Review found both a detached-thread
  bug and a wrong artifact prefix in the first materializer; the round-trip
  check now covers those real consumer contracts.
  Recognized local Markdown artifact destinations also rebase to the new member
  and artifact IDs; inline/fenced code and ordinary prose retain their bytes.
- The library has metadata, groups and links, not an `entries` array. Export
  uses the passive canonical collector and records each memory's source type,
  reference and text hash. Restore recollects staged sources and reapplies only
  display curation to their new identities. No vectors or runtime services are
  initialized. Unknown fields, namespaced extensions and unrecognized payloads
  remain inert portable source material and are included on later exports.
  Review caught unknown profile fields disappearing after a second import;
  retained provenance now merges the original unknown content without nesting
  a new history wrapper on every round trip.
- A source type such as `cli` or `profile` is not proof that a foreign tool
  supplied this app's canonical source files. Unreconstructed text memories use
  member profile memory as a fallback; this avoids overflowing the separately
  bounded 200-entry shared team store. The original records remain inert source
  material. Project-scoped or unknown-scope shared memories remain unbound until
  their folder scope is explicitly reconnected; dropping a workspace must never
  promote project-only knowledge to team visibility. Preview names that tradeoff.
- Portable limits are broader than some current runtime readers. Preflight
  rejects records exceeding the current conversation/metadata budgets and
  artifacts above 20 MiB before publication; it never truncates them. A long
  attachment extension uses `.bin` internally while keeping the original name,
  MIME and exact bytes. Case-normalized Git/harness directory exclusions apply
  on all platforms, including case-insensitive volumes.

- JSON/YAML embeds binary files as base64, increasing their encoded size.
  Streaming limits peak buffering but does not remove transfer cost.
- A file reference is not its contents. Exclusions remain visible and cannot
  be described as a complete copy of external project directories.
- Ordinary work files inside an assigned owned member home are included as
  exact payloads with managed-workspace references. Git authority, harness
  runtime directories and dependency caches are explicit exclusions; external
  projects and symbolic links are not followed. Custom avatar data URIs stay
  self-contained in the profile. Bundled product avatars retain their asset
  references. This keeps project output portable without importing a live
  machine's execution authority.
- Credentials and machine-specific tool sessions must be reconnected after
  restore; imported routines never start merely because a backup was opened.
- Unknown future major formats fail with an actionable error. Extension data
  can round-trip without being executed or becoming an authorization grant.
- Frozen pointers keep old immutable objects reachable until plan expiry.
  Expiring a plan removes its metadata, not content still referenced by records.
  Multiple API requests increase latency but avoid one unbounded invocation.
- Explicitly retained plans keep their referenced data reachable until removal.
  Scheduled expiry excludes them. This deliberately increases storage retention;
  a later garbage collector must consider live records and both retained and
  unexpired temporary plans before removing an immutable object.
- The local writer caps a portable document at 256 MiB and fails explicitly.
  External working directories are inventoried as references and exclusions.
  This is not an archive of every checkout or the machine's credentials.

## Sources and validation

Dependency review rejected the initial Zod 4.3.6 pin for constrained-collection
memory exhaustion (GHSA-mrhx-c7xc-m3w5). Use the patched 4.6.6 floor in both
runtime and API packages, retain the existing pre-parse byte/node limits, and
rerun hostile-input and cross-encoding checks. The advisory is at
[GitHub's reviewed record](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
API CI also installs the root runtime dependencies because its interoperability
tests import the actual desktop client/broker; a passing test against a warm
developer tree had hidden that clean-install requirement.

YAML parsing uses the [library's documented strict parsing and alias limits](https://eemeli.org/yaml/).
Implementation, cross-encoding round trips, binary checksums, hostile imports,
role boundaries and actual HTTP/MCP evidence will be recorded before shipping.

`check-owned-backups-browser.mjs` runs the built UI with an actual writable
broker and temporary home/credentials. A fixture preload refuses external
network and all subprocess execution (sync probes return ENOENT in their normal
result shape). Chrome verifies canonical current-conversation hydration,
export receipt, file upload preview, disabled Restore before confirmation,
fresh-realm completion, explicit Restart and the imported roster. Desktop and
390px views have no horizontal overflow or JavaScript exceptions. Screenshots
under `.codex-artifacts/ownership` were inspected. This is isolated browser
runtime evidence; it does not exercise the installed native application.

`check-import-sources.mjs` verifies immutable actor-scoped JSON/YAML upload
plans, exact bytes, expiry namespace, invalid UTF-8 and checksum/corruption
refusal without changing the selected dataset. `check-owned-restore.mjs` runs
an actual passive export, materializes unpublished files, recollects canonical
memory, re-exports and checks work files, artifacts, attachments, curation and
unknown payloads. It also rejects corruption and context revocation without
publishing. No harness is launched in this check.

The API's initial real D1/R2 workerd suite passed 18 tests, including frozen
plans across live deletion, owner isolation, expiry, read-only export, revoked
membership and the actual Node JSON/YAML exporter. `check-squad-portable.mjs`
checks binary chunk boundaries, duplicate IDs/paths, unsupported YAML/versions,
unsafe paths, MIME header injection and checksums. `check-owned-data.mjs` adds
the real passive worker's managed files and exclusion behavior. UI/MCP wiring
and restoration are now exercised by the broker and browser checks below;
hosted deployment verification remains outstanding.

The suite expanded to 19 tests after adding retained snapshots: it checks
idempotent retention and one audit record, real D1 expiry cleanup preserving
retained pointers, frozen reads after live deletion, owner-private listing,
read-only retain/remove refusal, explicit removal confirmation and the actual
Node YAML exporter reading the retained plan. No live API deployment or hosted
resource-limit proof is implied.

The next integration checkpoint passes 21 API tests. The actual local uploader
now runs against D1/R2: a verified local receipt uploads exact bytes, keeps private
sessions bound to immutable issuer/subject, requires explicit choices for newer
cloud revisions and validates the complete frozen snapshot before retention.
Lost-retain-response recovery reads the existing immutable plan; it does not
replay a later current-head update. A real broker cloud request is stalled,
then cancelled during A-to-B switching: it returns no A result and B cannot
list A snapshots or adopt A’s local receipt. Operator MCP uses the same service,
including downloads, preview, conflict resolution without echoing redacted hash
strings, explicit removal and session reconnection.

The rendered browser check additionally exercises opt-in cloud save, conflict
confirmation, exact download, restore preview and explicit removal with an
in-process cloud transport. Opening Backups/local export makes no cloud request.
That cloud transport is a UI fixture; actual D1/R2 behavior is covered by the
separate API integration checks. The installed native app remains untouched.

An actual desktop runtime staged by `scripts/stage-desktop.mjs --runtime-only`
also passes isolated owner admission, canonical member retrieval through its
packaged MCP modules, and JSON/YAML exports containing exact managed memory
bytes. The validator is imported from the staged `node_modules` package, not
the source-tree package. This proves runtime composition and portable output;
it does not launch an installed GUI or publish a signed desktop release.

An isolated workerd probe observed that a 3,000,124-byte valid object containing
one million empty profile objects retained 142,568,044 bytes of used heap with
its validated copy. That is not hosted OOM proof, but demonstrates why wire
size alone is not a heap bound. A Miniflare fixture configured for one
subrequest still completed three R2 operations, so local tests do not prove
hosted request-limit behavior. Cloudflare documents a paid default of 10,000
subrequests and 128 MiB shared isolate memory:
[limits](https://developers.cloudflare.com/workers/platform/limits/#subrequests),
[February 2026 change](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/),
[local-limit caveat](https://developers.cloudflare.com/workers/wrangler/configuration/#limits),
[DigestStream](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#constructors).
