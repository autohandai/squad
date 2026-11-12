# ADR-0196: Recover unowned data only through an explicit import preview

Status: Implemented; part of the account-owned Squads change, not released.

## Context and evidence

Older Squad installations saved data under separate bridge-state and agent
roots, with some current conversations only in browser storage. A next-login
migration cannot establish who owns those files. Igor chose manual recovery
instead of assigning every legacy member to the next signed-in account.

`scripts/check-legacy-recovery.mjs` creates separate old state, app and work
folders plus old browser records. Its saved and browser conversations differ.
The test exposed an initial incorrect containment check on macOS: a chosen
`/var` path canonicalized to `/private/var`, leaving work files as external
references. The implementation now maps the chosen root's lexical alias to its
canonical root, then checks each descendant without following child symlinks.

## Decision

Settings and operator MCP explicitly choose source folders and/or a bounded
set of old Squad browser records, name the receiving owner, and require
consent before reading sources. Discovery and ordinary sign-in do no recovery
scans. Read-only owners cannot prepare recovery.

A passive allowlisted copy uses an initiating-actor-private staging folder.
It includes canonical channels, memories, routines, conversations, artifacts,
attachments and member profile/memory/skill data. Optional assigned work files
must stay in the chosen work root. Credentials, sessions, runtime state,
pending work, Git authority and rebuildable caches are excluded. Previously
removed members remain removed. Account-owned dataset paths cannot be claimed
through legacy recovery.

The passive export uses `urn:autohand:squad:legacy`, `unowned` as provenance;
it grants no destination authority. The resulting verified source goes through
the existing restore preview, explicit replacement, writer drain, new dataset
and paused-agent transaction. A stable request reuses its verified preview
after a lost response. Originals are never renamed, deleted or rewritten.

Canonical disk profiles and channel definitions win matching browser IDs.
Different browser current conversations become archives so both versions
survive. No text comparison guesses which is newer.

## Consequences and limits

Recovery requires locating the correct roots; it cannot infer the owner or
recover data from a different browser origin automatically. Browser-only
automations are excluded rather than translated into executable routines.
Runtime grants and external folders require reconnection. Unsupported records
or limits fail before publication; originals stay available for a narrower
recovery. Files copied while another app writes are checked for individual-file
changes; this is not a filesystem-wide point-in-time snapshot. The user should
finish old work before recovering it.

The focused test verifies actual staged restore, exact memory/work bytes,
attachment/artifact references, credential and deleted-member exclusions,
idempotency, actor/read-only/path fencing and unchanged original/destination
data. Browser and MCP integration checks are recorded separately from this
filesystem test. No installed app or real account data is used.
