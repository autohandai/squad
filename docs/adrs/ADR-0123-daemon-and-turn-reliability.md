# ADR-0123: Daemon and turn reliability

Date: 2026-10-14
Status: Accepted

## Context and evidence

On 2026-10-14 at 00:27 (11:27 UTC) a Claude Code member, Alex, answered
"Could not answer — error: An unknown error occurred (Unexpected)" after
62 ms. Work details showed "Starting Claude Code..." then the same line on
stderr. Fourteen minutes later the self-improvement feature posted "I had a
look at how I have been working and made a few changes: • Remember: error:
An unknown error occurred (Unexpected)". The person's words: "sometimes our
daemon is not actually running correctly and can cause this; this has to be
tight and flawlessly working with the app; if crash has, it must resume any
pending or existing work that was working on."

What the installed bridge's own records say (`~/.autohand/squad/web-state/
run-history.json`, read on 2026-10-14):

| started (UTC) | status    | duration | resume | reply                                      |
| ------------- | --------- | -------- | ------ | ------------------------------------------ |
| 11:06:39      | completed | 7.7 s    | yes    | "I can't start yet. This session is still in planning mode…" |
| 11:27:27      | failed    | 352 ms   | yes    | "" (stderr ×3: An unknown error occurred (Unexpected)) |
| 11:27:30      | failed    | 62 ms    | no     | "" (stderr ×2: same)                        |
| 11:46:12      | completed | 36.7 s   | no     | "Nothing is running right now. I have no active task in this…" |

Two things are visible in that table that the chat did not show.

- The bridge already retries once when a turn with a `--resume` id fails
  with at most one event (a stale-session guard). The first attempt (352 ms,
  resumed) failed, the guard **wiped the member's resume id** and ran again
  without it (62 ms, same error). `harness-sessions.json` for the member
  reads `{"claude": {}}`. The next successful turn at 11:46 started a fresh
  session, which is why the member then said it had no active task: the
  planning session from 11:06 was gone. A start failure had been taken for
  a stale session.
- Both attempts exited within a second with no stream-json event at all,
  before Claude Code printed its `system/init` line. "error: An unknown
  error occurred (Unexpected)" is the Bun runtime's own uncaught-error
  format (the string sits in the binary next to its sibling "…, possibly
  due to low max file descriptors (Unexpected)"), printed two or three
  times in six milliseconds: the engine's process failed at start, not the
  request. At that moment the Mac's data volume had about 222 MiB free
  (two lanes' browser checks had filled it; it filled twice that day).

### Reproduction (all against the real `claude` 2.1.296, 2026-10-14)

Same command shape as the failed run, cwd a scratch folder, with
`--permission-mode plan --restricted --append-system-prompt … --add-dir ×2
--mcp-config <the member's vault config>` and a trivial prompt:

| variant                                             | exit | time    | stderr / result                                        |
| --------------------------------------------------- | ---- | ------- | ------------------------------------------------------ |
| baseline, disk 5.5 GiB free                         | 0    | 4340 ms | none; `result: "OK"`                                   |
| `CLAUDE_CONFIG_DIR` on a 4 MiB volume filled to ENOSPC | 1 | 1137 ms | none; `init` emitted, then `result` "Not logged in · Please run /login" |
| `HOME` on that full volume                          | 1    | 1167 ms | same                                                   |
| `TMPDIR` on the full volume                         | 0    | 3477 ms | none; answered                                         |
| `TMPDIR=/nonexistent`                               | 0    | 4418 ms | none; answered                                         |
| `ulimit -n 24`                                      | 0    | 5628 ms | none; answered                                         |
| `--resume 00000000-0000-4000-8000-000000000000` (stale id) | 1 | 4668 ms | "No conversation found with session ID: …"; one `result` event, `error_during_execution` |

So: the flag set is not the cause (the identical command works);
`--restricted`, `--mcp-config` and the plans `--add-dir` were all present on
the passing baseline; a full disk under the engine's config dir does not
produce the error either, because Claude Code keeps starting and fails
later on sign-in (the keychain entry is keyed to the config dir), and a
missing or full temp dir is survived. The exact syscall that returned an
errno Bun did not recognise could not be reproduced on a healthy machine,
and the unified log held nothing for the `claude` process in that minute.
What the evidence does establish: the 62 ms exit before any event is the
engine process failing to start, the environment at the time was the only
anomaly (222 MiB free on the volume every engine writes to), and the same
command worked 19 minutes later without any change. That makes it a
transient cold start, which is what the fix is built around rather than a
diagnosis of one errno.

A wrong first guess, kept here: "full disk makes Claude Code crash at
startup" was the obvious reading and the simulation did not bear it out.
Claude Code tolerates its own writes failing; it is the Bun runtime that
died, and a nearly full APFS volume is the likeliest reason without being
a proven one.

### What else was found while reading

- Nothing supervised the bridge. `squad serve` spawns `node server.mjs`
  detached, writes `web-server.json` and returns. The daemon
  (`daemon/src/daemon.rs`) ran a 60 s observability loop for registration,
  flags, pings and updates; it never looked at the bridge. The desktop
  shell navigates its window to the bridge's URL once at boot. A bridge
  that died left a window whose every request failed and nothing to bring
  it back.
- After a bridge restart the app's recovery of in-flight chats
  (`recoverInterruptedChats`, keyed on `runtime.serverStartedAt`) only ran
  when the runtime was re-read, which happened at page load and after
  sign-in. The presence poll noticed the bridge was away (dotted rings)
  and noticed it was back, but never re-read the runtime, so the loading
  bubble stayed loading until a reload.
- ADR-0113 wrote only finished runs to `run-history.json`: "a run that was
  running when the process died is simply absent". The person's question
  went with it.
- The chief of staff's "a failure that keeps happening is worth
  remembering" rule took any failed record. The audit trail turns a failed
  `chat.finished` into "Reply failed: <error text>", and `lessonText` keeps
  what follows the first colon, so two failed replies became a memory of
  the engine's error string.
- Queues (ADR-0111), goals (ADR-0066) and routines (ADR-0110) already
  recover across a restart: a running queue item fails with the restart
  explanation and the member's queue pauses until resumed; an active goal
  pauses with "The bridge restarted. Resume when you are ready"; a running
  routine run becomes `interrupted` and is not replayed. `check:queues`
  section 8, `check:goal-bridge` and `check:routines` were run on this
  change and pass.

## Decision

**A cold start is named, retried once, and never mistaken for a stale
session.** `server/harness/cold-start.mjs` classifies an exit that produced
no substantive events (raw lines and stderr echoes do not count) and was
not stopped or timed out: a spawn error is `binary-missing`; stderr that
says no space, or less than 512 MiB free on the engine's own state disk
(`CLAUDE_CONFIG_DIR` or `~/.claude`, `CODEX_HOME` or `~/.codex`, the
member's home for Autohand) or on the workspace, measured with
`fs.statfsSync`, is `disk-space`; a login request is `not-signed-in`; a
rejected option is `bad-flag`; a runtime error string or an exit inside
1.5 s with nothing said is `engine-crash`. Disk and runtime failures are
transient: the bridge waits 750 ms and runs the same command once more,
with the same resume id, and says so in the run log. Whatever remains is
the reply the person sees ("Claude Code exited 62 ms after starting,
before it read the request: its runtime reported "…". That is the engine
failing to start on this machine (disk, memory or file limits), not a
problem with the conversation. Retry; if it keeps happening, check free
disk space.") and a system line in the run log. The stale-session retry
now fires only when the engine said the session is the problem ("No
conversation found…", "session"/"thread" in the error), so a start failure
can no longer wipe the member's conversation.

**The daemon supervises the bridge.** Every 5 s it reads `web-server.json`
and probes `GET /api/runtime` with an 800 ms deadline. A probe that fails
while the process is alive is counted; the third in a row restarts the
bridge; a process that is gone is restarted at once. The restart
terminates any leftover pid, respawns through the same `spawn_web_server`
that `squad serve` uses (same server path, host, port and dev flag from
the record), writes the new record, logs it to `server.log`, records a
`daemon.web_server_restarted` event, and counts it in `GET /status` as
`webServerRestarts`. Consecutive restarts back off 5, 10, 20, 40, then 60 s.
No record (the person stopped the bridge) or a draining daemon means no
restart. The decision is a pure function with a unit test.

**The app shows one quiet line and recovers without a reload.** While the
presence poll cannot reach the bridge it polls every 2 s instead of 10;
after 1.5 s away one muted line at the top of the main area says "Squad's
local service is restarting. Replies and queues continue once it is
back." (past a minute: that it has not answered for a minute and restarts
on its own). When the bridge answers again the runtime is re-read, so the
recovery keyed on `serverStartedAt` runs then.

**A chat turn cut short by a restart is an `interrupted` run with Retry.**
`run-history.json` now also carries live chat turns (never live launched
runs: their process is gone and they have no prompt to resend), with the
prompt and the launch payload the queue needs. At boot a record that was
live comes back `status: "interrupted"`, finished at boot time, with one
log line saying Squad restarted while it was running. `POST
/api/runs/:id/retry` (in the queues plug-in, which owns the store) puts the
same prompt and launch on the member's queue, so it runs when the member
is free, in order, and resumes the engine session that survived on disk;
the run remembers the item it became and a second retry is 409. Goal,
queue, routine and channel turns are not retryable from here; they recover
on their own. The Runs tab says "interrupted by a restart" with a Retry
button, then "interrupted · retried".

**The chief of staff never learns from a failed reply.** A record with
status `error`, a failed `chat.finished`, or text that describes the
engine failing (unknown error, exit code, not signed in, no space, a
restart, no events, maximum runtime) is not a sample of the member's work
and counts for none of the failure rules.

## Evidence

`bun run check:reliability` (`scripts/check-reliability.mjs`, in the ci
chain after `check:chats`) runs a real bridge in a temporary state dir
with a fake Claude Code that can crash at start exactly as the real one
did (two "error: An unknown error occurred (Unexpected)" lines, exit 1,
nothing on stdout). It proves: a turn whose engine crashes once answers on
the second attempt with no error shown, both attempts resumed the saved
session, the run log carries "cold start: engine exited 30 ms after
starting with code 1 (…); retrying once in 750 ms" and "started on the
second attempt"; an engine that always crashes is retried exactly once and
the reply names the cause, the resume id on disk is unchanged; "Not logged
in" is named and not retried; a missing executable answers instead of
crashing the route; a bridge killed with SIGKILL mid-turn comes back with
that turn `interrupted`, `retryable`, carrying the restart line at its
finish time, every finished run still listed, the resume id intact and the
recovery line in the structured log; Retry answers 201 with a queued item,
the item runs with `--resume <the same session>` and the original prompt,
the run then shows its retry item and refuses a second retry; the
interrupted record survives another restart. Pure checks drive every
classifier branch (the 62 ms Bun exit, the same exit with 222 MiB free,
ENOSPC text, a nearly full workspace, ENOENT, sign-in on stderr and on
stdout, a rejected flag, a silent quick exit, a clean exit, an engine that
started, a slow unexplained exit, stopped, timed out, a stale session),
`freeDiskBytes` walking up to an existing path, the history record and its
restore as interrupted, and the app's bridge-away wording.
`check:chief-of-staff` gains the night's records: five "Reply failed:
error: An unknown error occurred (Unexpected)" produce no proposal, and a
real lesson beside them is still proposed. `cargo test` in `daemon/`
passes (77 unit tests, one new) and `cargo build --bins` succeeds.

Also run on this change: `bun run build`, `check:render`,
`check:chat-recovery`, `check:chief-of-staff`, `check:queues`,
`check:goal-bridge`, `check:routines`, `check:chats` (its pure check that a
running record restores as nothing was changed to expect `interrupted`),
`check:harness`. All pass.

## Consequences

- One automatic retry costs 750 ms plus a second spawn on a disk that is
  genuinely full, and the second attempt will fail the same way; the reply
  then says to free space. No retry is attempted for sign-in, a missing
  binary or a rejected flag.
- The disk threshold (512 MiB) is a judgement. A machine that runs with
  less free space than that will have every start failure attributed to
  the disk even when the engine died of something else; the stderr text is
  still quoted so the person can tell.
- The errno behind the 62 ms exit remains unproven. If it recurs with
  plenty of free disk, the classification will say "engine-crash" and
  quote the runtime's line, which is honest but not a diagnosis.
- The supervisor's deadline is 3 probes × 5 s plus an 800 ms read timeout:
  an unresponsive bridge takes about 16 s to be restarted, a dead one about
  5 s. A bridge that hangs while still answering `/api/runtime` is not
  detected.
- The daemon restarts the bridge, not itself. If the daemon dies there is
  still nothing to restart it; the desktop shell's tray notices on its next
  refresh. Left undone.
- Interrupted turns are listed and retried on request; they are not
  re-sent automatically. Queued follow-ups and goals likewise still wait
  for the person after a restart, as ADR-0111 and ADR-0066 decided. The
  person's "it must resume any pending or existing work" is met by making
  every piece of pending work visible with one action to continue it, not
  by replaying turns on the engine without anyone asking; a retry runs an
  engine with full access by default (ADR-0120), which is not something to
  do on a crash loop.
- Live chat runs now write to `run-history.json` at start, one debounced
  write per turn more than before. A launched run that was live at the
  crash is still absent, as ADR-0113 left it.
- The browser-side chat bubble for the interrupted turn still comes from
  `recoverInterruptedChats` ("This request was interrupted when Squad
  restarted"); its Retry re-sends directly, the Runs tab's Retry goes
  through the queue. Two paths to the same prompt, by design: the bubble
  exists only in the window that sent it, the run exists everywhere.
- No change to the self-improvement wording when it does act; a failed
  reply simply no longer reaches it.
