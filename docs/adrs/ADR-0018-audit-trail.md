# ADR-0018: Audit trail and durable per-member identity

Date: 2026-09-26 · Status: accepted · Issue #34

## Context

Runs are logged to `web.otlp.jsonl`, but nothing a person can browse ties a
message, an edit, a shell command, a handoff, or an approval to the member
that did it. Members live in the browser (`localStorage`) and only their ids
reach the bridge, so identity has to be a stable id, not a signed key
(cryptographic signing and cross-machine identity are out of scope).

## Decision

- **One append-only JSONL file per member** at
  `<squadStateDir>/audit/<memberId>.jsonl` (`server/audit/trail.mjs`). The
  member id is the durable identity; it is sanitised to a file-safe name and
  can never escape the audit folder.
- **Records are OTLP LogRecords plus an `id`**: `timeUnixNano`,
  `severityNumber`/`severityText`, `body` (the human summary), and
  `attributes` with `autohand.member.id`, `event.name`,
  `autohand.activity.kind` (`message | run | edit | shell | handoff |
  approval`), `autohand.activity.status`, `autohand.activity.source`
  (`bridge` or `web`), and flat refs (`autohand.run.id`,
  `autohand.channel.id`, `autohand.task.id`, `autohand.workflow.id`,
  `autohand.message.id`, `autohand.workspace`, `autohand.file.path`,
  `autohand.shell.command`, `process.exit_code`, `autohand.related_member.id`).
  A run id seeds `traceId`, so a member's records correlate with the run's
  own log lines. The same helpers as `server/otel-logs.mjs` encode them, so
  the export is readable by any OTLP consumer once wrapped in an envelope.
- **Exactly one record per member action.** `audit.route.mjs` subscribes to
  the bridge bus (`"*"`) and maps each documented event to one kind:
  `run.finished`, `member.stopped` → run; `chat.finished`,
  `mention.received` → message; `shell.ran` → shell; `handoff.pending` →
  handoff (attributed to `fromMemberId`, receiver kept as a ref);
  `approval.pending` → approval (member resolved from `ctx.runs` by run id);
  `file.edited` → edit. Events without a member produce nothing. Client-side
  actions the bridge never sees (messages a member posted in a channel through
  a non-bridge path, edits the app observed) are appended through
  `POST /api/members/:id/activity` with the same validation; handoffs and
  approvals go through `POST /api/events` only, never both.
- **Reading is newest-first with a cursor.** `GET
  /api/members/:id/activity?before=&limit=&kind=` reads the whole file,
  drops corrupt lines (counted in `dropped`), sorts by time, and pages by
  record id or time. `GET …/activity/export` streams the file byte for byte
  as a download, so the export always equals the file.
- **UI** is a profile "History" section (`MemberHistory.jsx`): heading, one
  sentence, underlined text filters, a divider list grouped by day, Load
  more, Export. Pure grouping, filtering, and relative-time helpers live in
  `src/lib/member-history.js` so the Node check covers them.
- **Check**: `scripts/check-audit.mjs` (`check:audit`) covers append, paging,
  corrupt lines, one record per documented event with its run id, route
  handling against a stub `ctx`, byte-equal export, and the browser helpers.

## Consequences

- The trail survives reloads and app restarts because it is a file, not
  browser state; deleting a member does not delete its trail (an export is
  still possible afterwards).
- Reading loads the whole file per request. At 50 records per page and a
  few hundred bytes per line that is fine for years of one member's work;
  if a file grows past tens of megabytes, replace `readAllRecords` with a
  reverse tail reader without changing the route or the record shape.
- Appends are chained per file in-process, so concurrent events never
  interleave lines. Two bridge processes writing the same file would, which
  the single-bridge design already rules out.
- `shell.ran` and `member.stopped` are documented in the contract but not
  yet emitted by `server.mjs`; until they are, the shell kind comes from the
  web app's POST. Adding the emits is a one-line change per site.
