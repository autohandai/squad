# ADR-0140: Reply threads are independent work lanes

Date: 2026-10-22. Status: Accepted.

## Context and evidence

The person wants to reply to individual messages and let independent work
proceed in parallel. Channel threads already correlate replies, but direct
messages have one conversation. Reusing it for independent work would also
reuse its engine transcript. Worse, `team.openWork` and `vault.openWork`
kept one mutable credential per member: a second run could retarget a tool
call to its workspace, run and channel.

The added parallel-work case in `check-team-operations.mjs` first failed:
two scopes returned the same credential. `check-member-threads.mjs` first
returned 404 for POST `/api/members/:id/threads`. With the implementation,
two gated SDK turns for one member both start before either is released;
they use separate SDK instances and prompts. Stopping the first preserves
the second answer; that answer survives restarting the real bridge.

Extending the check to ordinary channel entry points exposed missing saved
thread context. The first assertion looked only at the user prompt, but
Autohand receives this context in `appendSystemPrompt`; the corrected check
tests that actual engine interface and excludes the other thread's history.
Both channel turns now start independently and stopping one preserves the
other's answer. The rendered DM sheet shows the saved answer after restart.

## Decision

Store direct reply threads on the bridge in `member-threads.json`, keyed by
member and the original message id. Creation and message retries are
idempotent. Snapshot the original message and preserve every thread's own
messages, run ids and outcomes independently of the main chat archive.

Run each thread turn through the existing executor with an ephemeral engine
session and explicit thread history. Do not resume or replace the main
conversation. The same member identity, profile and saved permissions still
apply. Different threads may run concurrently; one thread runs one turn at
a time. Stop targets its exact run, never every run belonging to the member.

Apply the same fresh-session rule on the bridge to every channel turn,
regardless of which caller supplied it. Supply completed messages from its
saved channel/thread only, at most the last 24 and 12000 body characters.
Never infer history from time or reuse another thread's warm transcript.
Derive the bridge's reply count from actual saved replies, not dispatches.
Count in linear passes over saved history. An added legacy case first
counted its unparented root as one reply; the bridge now uses the same first
thread-root fallback as the stream and reports zero until an actual answer.

Managed MCP credentials and private config files are scoped per ephemeral
work. They are revoked and cleaned up when that work ends. Ordinary chat
retains stable credentials and warm sessions. Ephemeral Autohand SDK leases
close rather than return to the warm pool; Claude/Codex do not write a
resumable main-session id. This also corrects isolation for automation drafts,
scheduled work and teammate deliveries.

Expose Reply on both user and member messages and Threads in the chat
header. Use the existing plain Sheet and text rows. Closing the sheet leaves
work running; only completed nonempty answers contribute to the reply count.
After restart, unresolved work is visibly interrupted, never silently retried.

## Consequences and limits

- Fresh engine sessions cost a cold start and use explicit, bounded context:
  the original message and the last 24 thread messages. Shared files remain
  shared; this does not create isolated Git worktrees automatically.
- Threads are durable in a separate bridge record, not inferred from message
  time or browser-local state. Deleted/archived main conversations do not
  erase independently running work.
- The current limit is 200 threads per member and 200 messages per thread.
  Reaching it returns an error. Automatic archival and a delete/history
  management interface are left for a separate change; records are not
  silently discarded to make room.
- Controlled engine transports establish concurrency and identity behavior;
  live provider and packaged native proof remain separate verification.
