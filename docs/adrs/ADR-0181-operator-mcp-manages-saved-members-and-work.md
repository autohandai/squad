# ADR-0181: Operator MCP manages saved members and work

Date: 2026-11-05

## Context and evidence

The external MCP exposed messaging and Library reads but could not change the
configuration used by those members. The app already stores extra folders in
member projects and passes them to harness adapters, prepares pinned skill
snapshots on each turn, owns channel threads and owns routine schedules.
Adding independent MCP configuration would let the app and CLI disagree.

Inspection of `updateAgent`, `setAccess`, `withSavedMember` and the harness
adapters showed two important constraints. Stale app snapshots are merged
against canonical revisioned profile fields, while permissions and projects
were outside that field set. Codex resumes also have no `--add-dir` flag;
the existing adapter sends sandbox writable roots as config overrides when
applicable. A full-access resume already has unrestricted filesystem access.
The first new engine assertion assumed every turn had the literal flag; it
failed on that full-access resume. The corrected check exercises a fresh
thread and verifies the actual directory argument.

Legacy MCP channel replies were mirrored only by `wait_for_reply`. A client
that disconnected after dispatch left the run outside the visible thread.
The new disconnected-client check confirms this is now bridge-owned.

## Decision

Add nineteen tools to the operator connection (37 total): member profile,
ability, folder and skill management; channel settings, membership, threads,
private groups and explicit recipient dispatch; routine reads, previews,
creation, edits, pause/resume and manual execution. Keep the managed member
MCP identity-scoped and the existing operator tools compatible.

Member edits use narrow patches with an atomic expected-revision comparison.
Reject revision-checked writes when the member has been removed, even if
the last profile revision still matches: deleting a member does not itself
increment its profile revision. This closes a race between asynchronous
selection validation and a concurrent removal. The regression check applies
a previously prepared edit after removal and verifies the tombstone remains.
Revision-checked patches rebase onto the latest canonical agent so an
unrelated concurrent engine setting (outside the profile revision) is also
preserved. A separate check exercises that interleaving.
Include projects and permissions in that same canonical profile revision,
so a stale app snapshot cannot undo an external grant or policy edit. An
explicit expected revision protects a caller's earlier read; when omitted,
the handler reads one immediately before saving. Existing execution prepares
the new configuration on later turns without restarting current work.

Folder grants require existing directories under the physical home, reject
home itself and symlink escapes, preserve displayed aliases and deduplicate
physical roots. Revocation does not delete data and cannot remove the primary
workspace. Ability edits patch known capability/tool IDs, preserve other
policies and never change OS grants or safety guards. Skill selection validates
catalog references, including explicit local and registry origins; the receipt confirms assignment, not installation.

Private groups reuse channels. Creation starts no work. Messages publish only
unless recipients are explicitly selected from the channel roster. Each run
returns its own receipt/error. A marked operator channel run is mirrored on
`run.finished`, and terminal restored runs are repaired at startup, using the
same reply ID as the legacy waiter. Ordinary app channel replies retain their
existing path. The channel thread's existing context/session isolation is reused.

Routines reuse the scheduler and saved run history, require an explicit IANA
timezone, and default to disabled. Enabling, pausing and running now are
separate explicit actions. There is no routine deletion tool.

## Validation

`node scripts/check-control-plane.mjs` passes 225 assertions against a real
isolated bridge and fake Codex executable. New coverage includes profile
conflicts and stale snapshots, rejected folder escapes, actual engine grants,
next-turn local and qualified registry skill installation, channel membership, two replies persisted
after sender disconnect, waiter deduplication, routine preview and manual
execution, restart persistence, catalog argument forwarding and older-bridge
upgrade errors. No real member is messaged or reconfigured. The Web checks workflow now
runs this MCP regression check explicitly; it was previously present only
in the broader local `ci` script.

Related checks pass: member profiles (all 17 built-ins through controlled SDK
configuration), member shaping, channel actions, permissions, local skills,
routines, durable queues, SDK sessions and bridge import boundaries. These
are controlled bridge/runtime checks, not live provider or native UI proof.

## Consequences

The operator connection can change member permissions and dispatch work; it
must not be handed to managed agents. Older running bridges need an update
for member management. There is no automatic retry or idempotency key for
sends: callers must inspect receipts before resending after a lost response.
Multi-recipient dispatch is not an all-or-nothing transaction; partial errors
are returned per recipient. Current work keeps its settings until completion.
Skill installation can still fail during engine preparation. This does not
add member creation, model changes, routine deletion, approvals, credentials,
OS grants or application lifecycle control.
