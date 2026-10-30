# ADR-0156: A collective memory library with scoped local vector search

Date: 2026-10-29

Status: Accepted

## Context and evidence

The person searched Settings for Memory and found only Cloud sync. The app had
member-specific memory pages and `team.json`, but no cross-member library,
collection settings, persistent groups, or graph. `squad_recall` searched only
the team store using an all-words substring filter. Profile Markdown and the
isolated CLI's saved memories were absent from that lookup.

The supplied text and images ask for an explorable, colorful graph: stable
member colors, meaningful grouping, filtering, smooth focus/zoom and source
inspection. A graph with undifferentiated dots and unexplained lines does not
make collective knowledge inspectable.

We inspected the separate native Squad implementation in
`crates/squad-memory/{store,types,vector,cli}.rs`, its engine collection service,
and its authenticated MCP tools. It already uses TurboVec 1.1.2, with 1536
dimensions and four-bit quantization. Its encoder is deterministic lexical
tokens/bigrams, **not a semantic embedding model**. Its useful boundaries are
canonical source ownership, an independently rebuildable index, allowlists
before top-k, and saved relationships distinct from computed similarity.

The [upstream TurboVec repository](https://github.com/ryancodrai/turbovec)
provides an in-process vector index, not an embedding model or a graph database.
Simply adding the crate would implement none of the requested product or MCP
behavior. We ran `cargo add turbovec@=1.1.2` in `daemon/`, pinning the compatible
version used by native Squad. That version requires Rust 1.89 or later; existing
CI/release jobs install current stable Rust, and the manifest now declares the
minimum. Local validation uses the installed 1.93.1 toolchain.

## Decision

### One collection over the existing sources

`server/memory/collect.mjs` projects shared/private/project entries from the
existing team store, member memory arrays, member memory-profile Markdown,
and each member's isolated Autohand home. It does not scan arbitrary global
accounts, repositories, conversations, or session logs. The person can opt
into up to eight read-only Markdown folders, explicitly shared with the team.

Collection settings affect library/search inclusion. They do not delete
original files or change the existing member prompt's saved context. The
original member and team writers remain authoritative. Imported records are
read-only in the library, with a source location and a link to the member's
memory page where applicable. Team-store entries can be edited or forgotten
through the same ownership-checked writer.

Canonical CLI `events/LOG.jsonl` supersedes legacy JSON projections, including
when the canonical log is empty. Replay respects create/update/delete/snapshot
semantics and validates identities, versions, levels and timestamps. A malformed
or unfinished existing log produces a warning and an empty projection; it never
resurrects old JSON or derived summary snapshots. CLI user-level files inside a
member's isolated home remain **that member's private Squad memory**. Their CLI
storage level is not permission to share them with the team.

Source reconciliation runs on each library refresh/search; no old imported
content is saved as canonical knowledge. Markdown paragraph content hashes
invalidate links/curation when a paragraph is replaced. CLI and structured
entry IDs remain stable through content edits. Retained explicit links are
rendered only when both current endpoints exist and are visible.

### A derived Rust index in an existing packaged executable

The existing `autohand-squad-daemon` has a private `--memory-index --index-dir`
mode. It dispatches before daemon configuration, network listeners or telemetry.
`server/memory/vector-client.mjs` manages this stdio child; no extra executable,
remote service, Python process or model download is required. Source libraries
remain browsable with keyword search if the index cannot start.

The pipe supports bounded `sync`, `search` and `status` requests. Rust uses
TurboVec's `IdMapIndex`, stable IDs, normalized lexical token/bigram features,
incremental updates/deletes, and a checksummed, private cache. Index/manifest
corruption is recoverable from a fresh canonical collection. A failed worker
is isolated from the bridge and later requests may start a fresh worker.

The application first computes the actor's visible record IDs and supplies
those as an allowlist **before** nearest-neighbor selection. Missing/empty
allowlists return no results. Private owner/explicit-share access, shared team
scope, and the authenticated current project apply equally to direct reads,
search and graph endpoints. The local person's library can inspect all members.
Agents cannot supply another identity, choose collection paths or edit settings.

Search combines exact words with local vector similarity. It makes no claim
of semantic understanding. Limits are visible in the runtime status: 20,000
documents, 32 KiB/document, 16 MiB total indexed text and 100 vector hits. The
bridge apportions an indexing prefix budget across every collected record;
complete original text remains readable. Large Unicode similarity queries are
bounded by UTF-8 bytes independently of retained document content.

### Real MCP operations, not a second memory silo

The existing managed, per-work Squad MCP gains `squad_search_memory`,
`squad_memory_graph`, `squad_read_memory`, `squad_share_memory`,
`squad_relate_memories` and `squad_organize_memory`. `squad_recall` uses the same
collection. Remember/update/forget continue to use canonical team records;
imported files are never rewritten through these tools. Mutations require
ownership/authorship in addition to visibility. Sharing grants a named member
access; it does not manufacture a teammate reply or send a message.

Groups, tags, readable titles, kind, pinning, explicit shares, and typed links
live in atomically written `memory/library.json`. Only references, supports and
contradicts links may be saved, with an evidence sentence. Automatically
computed links remain ephemeral, dashed and labelled text similarity. The
general external control-plane MCP does not inherit managed member credentials
or gain arbitrary private-memory access.

### An explorable surface and discoverable settings

Memory is a primary navigation destination at `/memory`; Settings has a real
Memory section at `/settings/memory`, indexed by the setting finder. The library
has an open canvas, member/kind/group clustering, pan, anchored wheel zoom,
fit, focus, draggable nodes, keyboard controls, member colors, owner/kind/scope
filters, groups and full-text search. A divider list provides an equally usable
alternative. Selecting a memory opens its content, scope, author, source,
curation, sharing and actual connections in a plain inspector.

The graph and settings load only when opened. They inherit the active skin and
light/dark tokens. Camera transitions honor reduced motion. Empty, loading,
partial collection, unavailable index and failed-write states are explicit;
failed writes retain drafts. Source collection and cloud upload are separate.

## Corrections learned during implementation

- The first UI check tried to serialize a DOM element through CDP and reported
  a grouping timeout although the Kind view had rendered correctly. The check
  now asserts a boolean from the actual rendered node.
- Worker-crash review reproduced an unhandled stdin EPIPE with a deliberately
  exiting worker. A write callback alone does not consume a stream `error`
  event; the client now handles stdin/stdout failures and keeps the bridge alive.
- Record bounds and query bounds are different. A valid long Unicode memory
  can exceed the vector query's byte limit. Similarity queries now use a bounded
  UTF-8 prefix rather than incorrectly marking a healthy index unavailable.
- Collected documents are much larger than the original short team entries.
  MCP search, recall and graph results therefore have a total excerpt budget,
  with an explicit complete-record read tool. Collection also enforces its
  record/text budget during traversal, not after materializing all folders.

## Validation

- `cargo +1.93.1 test --manifest-path daemon/Cargo.toml --lib memory_index`
  exercises real TurboVec mutation, deletion/reload, allowlist filtering,
  corruption recovery, Unicode/empty input and protocol bounds.
- `node scripts/check-memory-library.mjs` exercises the actual built Rust
  executable, source collection/reconciliation, privacy/project scopes,
  sharing/revocation, curation persistence and real managed stdio MCP over HTTP.
- `node scripts/check-memory-browser.mjs` exercises the rendered graph/list,
  grouping/search, actual vector similarity edges, source details, creation,
  editing, collection settings, failed-write drafts, restart, themes, mobile and
  reduced motion with an isolated bridge and fixture data.

- `node22 scripts/check-memory-library.mjs --packaged` and
  `node22 scripts/check-memory-browser.mjs --packaged` passed against the staged
  production runtime on Node 22.23.1, using the actual compiled Rust worker.
  The browser check includes pointer pan, wheel zoom, node drag, keyboard
  selection, and rejection of stale text edits while preserving the draft.
- Existing team/MCP operations, member profiles, Settings navigation, runtime
  imports, release packaging metadata, Rust formatting, workflow syntax and
  production build checks passed. The Settings check had a stale fixed count
  that already omitted Cloud sync; it now compares actual rows with the
  canonical section registry, including Memory.
- Evidence is in `.codex-artifacts/memory-20261029/verification.json` and
  `packaged/*.png`. Eighteen source/build files were compared byte for byte
  with the staged runtime. The memory screens are separate lazy-loaded assets.

An initial staging attempt failed with ENOSPC while copying the native
Computer Use bundle. A concurrent Rust cache assertion had returned
`cached: false`; its original I/O cause was swallowed, so disk pressure is a
supported explanation rather than a recorded error from that first assertion.
Cache write failures now log their exact cause privately. We removed only
this task's generated incremental caches and incomplete staging copy, then
successfully staged again and reran the Rust and staged memory checks. No
source, installed application or saved memory was removed.

These checks do not prove a published/installed desktop release, cloud
synchronization of the library, full aggregate CI or live model behavior.

## Consequences and deliberate limits

The graph is a view over real knowledge, not a claim that every similar sentence
is related. Exact source provenance and explicit evidence take priority over a
denser diagram. Lexical vectors work offline without billing or model setup,
but cannot reliably find synonyms or multilingual paraphrases like a learned
embedding model. A future semantic encoder must version its cache and explicitly
choose its model, storage, download and privacy behavior.

The retained source stores remain separate; this avoids a risky data migration
but makes write-back to imported Markdown/CLI records intentionally unavailable.
Metadata whose imported paragraph disappears is not automatically transferred
to a different paragraph. The existing team-store capacity and cloud-sync
contract are unchanged. Groups, tags, graph links and explicit personal shares
are local; they are not silently uploaded by existing team-memory cloud sync.

The first graph renders at most 500 filtered records, with up to 160 source
records producing optional similarity links. It reports visible versus matching
counts and asks the person to narrow filters rather than claiming the entire
corpus is on screen. It has no continuously running force simulation, semantic
clustering, summary-model calls, or background agent conversations. Source file
limits and collection warnings remain visible. This is a deliberate local-first
implementation, not a multi-tenant memory service.
