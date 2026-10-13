# ADR-0082: Bounded channel history requests and explicit corruption recovery

Date: 2026-10-13

## Context and evidence

The installed 0.1.6 local candidate opened the real workspace but displayed
`request body too large (limit 1048576 bytes)` during cache synchronization.
The client sends the complete channel/thread/message history; the generic
one-MiB request budget was appropriate for individual mutations, not history.
`node scripts/check-channel-lifecycle.mjs --api-only` reproduced the exact 413
failure with 160 messages of 8,192 characters before the change. The failing
run is retained in `.codex-artifacts/local-0.1.6/channel-history-red.log`.

The create form separately displayed a JSON parser error. The saved file and
the pre-installation backup have the same SHA-256. Inspection found an intact
first document containing six channels, 19 threads and 83 messages, followed
by an extra closing brace. Its complete file is 1,125,763 bytes; the compact
valid document is 997,362 bytes. These were measured with Python's JSON decoder
and byte counts, not inferred from the request error. The initial assumption
that the two displayed errors shared one cause was incorrect. The origin of
the pre-existing extra brace is not established.

Amendment, later on 2026-10-13: the origin is now established from the code
that wrote the file. The 0.1.5 bridge (`git show e54f494:server.mjs`, line
4540) saved channel snapshots with a plain `writeFile`, and the git route's
fallback mirror wrote the same path with `ctx.writeJsonFile` on every poll.
Two truncating writers interleaved by the event loop produce exactly the
observed shape: the longer document lands first, the shorter one rewrites
from offset zero, and the old file's final bytes survive after the new
document. The damaged file was 3 bytes longer than the recovered one, which
is the `\n}\n` tail of a pretty-printed document. The current store already
serialises every writer through one queue with write-then-rename, so the
cause cannot recur from this bridge; the recovery below is for files that
0.1.5 already damaged.

The same investigation found two follow-on defects in the current source.
The agent-channels route plug-in ran its startup recovery inside `init`, and
the plug-in loader drops a plug-in whose `init` throws; with a damaged file
the installed app therefore lost its channel-event stream and proposal routes
entirely (logged as `route plug-in agent-channels.route.mjs failed to load`
in `~/.autohand/squad/web-server.log` at 15:36 on 2026-10-13) instead of
returning the 409 explanation. The daemon's `PUT /channels` also wrote
`channels.json` through a struct that modelled only channels and threads, so
any caller would have erased messages, revision, tombstones and agent
receipts. Nothing in the shipped bridge or shell calls it, but the write
existed on localhost.

## Decision

Give the additive history sync and legacy snapshot PUT a bounded 16-MiB
request budget. Keep individual mutations at one MiB. Test actual HTTP
acceptance, disk persistence after restart, oversized rejection without a file
change, and the unchanged limit on individual mutations.

Keep strict saved-JSON parsing. Report damaged history with a recovery
instruction instead of raw parser coordinates, and refuse writes. For this
specific local file, retain the original backup and recover the complete first
document after confirming that the only non-whitespace suffix is one extra
closing brace. This is an explicit repair, not an automatic parser policy.

Amendment: that one shape is now recovered automatically by the store. When
a read fails to parse, the store scans for the end of the first complete JSON
value; if the remainder is only whitespace and closing braces or brackets,
it copies the original to `channels.json.damaged-<timestamp>`, rewrites the
document atomically and continues. Any other trailing content, or any
unparseable prefix, still refuses writes with the same 409 message. The
agent-channels plug-in now logs a skipped startup recovery and keeps its
routes loaded, so a damaged file produces the explanation rather than a 404.
The daemon's channel structs carry unknown fields through with a flattened
map, so a daemon write preserves everything it does not model.
`node scripts/check-channel-lifecycle.mjs --api-only` covers all three
(eight checks), and the daemon test
`channels_state_round_trip_keeps_fields_the_daemon_does_not_model` covers the
struct. The user's actual damaged backup, run through the new store, yields
the same six channels, 19 threads and 83 messages as the manual repair, with
the backup byte-identical to the original.

## Consequences and limits

The larger request ceiling buffers more data per mirror operation and does
not solve unbounded workspace growth. Incremental message synchronization or
chunking is deferred; full history mirrors over 16 MiB still fail visibly.
Ordinary mutation limits and corrupt-file refusal remain intact. Recovery
does not infer missing records or automatically discard arbitrary trailing
content. This local macOS check does not certify other release platforms.

Amendment: automatic recovery accepts a narrow signature and nothing more; a
file torn in the middle of a document still needs a backup. Each recovery
leaves a timestamped copy beside the live file that nothing cleans up. A
damaged file still skips purpose recovery at boot, so interrupted deliveries
are only marked after the file is restored and the bridge restarts. The
daemon's write endpoint remains lossy for fields inside records it does
model if their types ever diverge; it stays uncalled rather than removed.
