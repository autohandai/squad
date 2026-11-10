# ADR-0195: Prove writers have stopped before changing owned data

Date: 2026-11-10
Status: Implemented locally; Windows execution verification pending

## Context and evidence

Hiding an old roster is not proof that its writers stopped. The first native
ownership integration correctly returned no visible work once the broker
receipt was revoked, while an admitted native process could still spend 2.5
seconds shutting down and then write its final run and telemetry records.
Background ping and telemetry also awaited network responses before writing.
A dataset clone at that point could miss those final writes.

Review found two additional mistakes in that first design. Reading the daemon
incarnation from a mutable service record allowed an old listener to claim a
replacement daemon's identity. Keeping process cleanup uncertainty only in
memory meant a crash/restart could incorrectly acknowledge an empty activity
count while a detached helper survived. Those observations changed the design;
zero projected work and a changed PID are not accepted drain evidence.

## Decision

Track admitted native writers until process-group cleanup and final receipts
finish. A machine-only capability binds drain/resume to a broker, operation and
immutable serving-daemon incarnation. Private daemon requests carry the
caller's captured ownership generation. Stop, update and ownership holds remain
independent: completing one cannot reopen another.

Native process launch first persists an intent, starts a wrapper waiting on
stdin, persists its process-group identity, and only then sends the launch
handshake. A crash before that handshake cannot start the workload. On normal
completion, confirm the captured group no longer exists before removing its
intent. Uncertain cleanup poisons admission and survives restart through the
intent. Startup only retires an old intent once its daemon is gone and its
group is absent; it never sweeps a process name or kills a recycled group ID.
The native service itself holds an OS file lock for its lifetime.

Real Linux CLI integration exposed a separate transport assumption. The broker
emitted chunked JSON, but the existing native HTTP reader expects a plain JSON
body; its health probe failed before any stop request. Broker JSON now carries
an explicit UTF-8 byte length, as the existing worker responses already do.
Supplying an owner generation to the old shutdown route was insufficient: it
would stop a private worker while leaving its broker running.

Machine shutdown therefore terminates at the broker. The CLI reads the existing
private `ownership-control.json`, captures matching broker health identity and
sends that capability with the exact broker UUID, PID and start timestamp.
The route requires loopback, refuses browser Origin and served authorization,
and compares against its in-memory capability. It remains available while
signed out or blocked because closing a service does not grant data access.
One cached drain promise closes admission and completes the existing worker,
log and native barriers. Only then does the broker acknowledge `drained:true`
for that incarnation; listener closure follows the response. Sharing the promise
prevents a concurrent signal or retry from acknowledging an unfinished drain.
The CLI waits for connection refusal and rechecks its captured control record
before deleting a matching service record. Authentication, parsing and timeout
errors do not prove shutdown and cannot trigger a protocol-1 PID-kill fallback.
The real two-instance stop check retains its sibling/unrelated-process guards
and additionally launches an owned child tree that ignores graceful signals.
New native run records carry the immutable serving-daemon incarnation before
their first queued write. One pure read projection feeds lists, individual
runs, active counts and metrics. A previous incarnation's queued/running record
is shown as interrupted only after startup proves its durable process intents
resolved. Unconfirmed or unstamped legacy execution is shown as unknown.
Stored status, timestamps and exit codes are not rewritten, and reads neither
resume work nor fabricate completion times. Machine lifecycle events count
currently admitted native activities instead of reading unowned legacy runs.
The broker also checks that durable native ledger when the daemon record is
missing or its PID is dead. Review reproduced a surviving group with no daemon;
returning an unconditional successful no-op drain there was wrong. The focused
lifecycle check now exercises both absent-daemon capture and drain refusal.

The broker holds a dedicated local SQLite `BEGIN EXCLUSIVE` transaction as its
machine writer lease, and publication uses a separate owner lease. Unlike an
exclusive-create PID file, these locks release on process death without an
unsafe stale-file takeover. The stable lease inode is never unlinked, copied,
reset, exported, or read through an ordinary file reader while held. A
same-process registry rejects contenders before opening that inode, because a
raw close can cancel POSIX SQLite locks. See [SQLite transaction semantics](https://www.sqlite.org/lang_transaction.html)
and [SQLite's file-locking caveat](https://www.sqlite.org/howtocorrupt.html#_posix_advisory_locks_canceled_by_a_separate_thread_doing_close_).

A durable machine worker ledger additionally records detached Node groups
before their startup handshake. Losing the broker's SQLite lock does not imply
those groups exited. Replacement startup refuses an unfinished group; IPC loss
asks the private worker to stop. Ordinary transitions wait for Node group
disappearance, stdout/stderr closure and pending log writes as well as the
native drain acknowledgement. Operation journals for restore/reset are
separate from these lifetime SQLite transactions.

The stronger real CLI-stop fixture exposed a missing boundary: external CLI,
ACP, direct Autohand and project-review launches intentionally had their own
process groups, outside the private worker's group. Their old Stop helper
scheduled a force timer but returned immediately; worker exit discarded that
timer. A stubborn harness grandchild could therefore survive a purported drain.

On Unix, those five controlled engine launch paths now share a gated anchor.
The broker durably records its separate group before admitting the executable.
The anchor remains alive until it has sent the actual engine outcome and then
signals its own group. Worker IPC loss and Stop take the same anchored cleanup
path. Only the live anchor signals that numeric PGID; neither a parent nor a
replacement broker guesses whether a dead anchor's ID has been recycled.
The worker's child facade reports the engine's actual code after group absence
and journal cleanup, rather than reporting the anchor's cleanup SIGKILL as an
engine failure. Worker shutdown awaits those children, and broker drain checks
all registered engine groups separately. If the anchor dies unexpectedly while
descendants survive, recovery remains blocked with the durable intent intact.
Windows retains the private Job Object, which already contains detached engine
descendants. This is managed-process containment, not a claim to sandbox code
that has the user's OS permissions or intentionally launches unrelated services.

Development workers receive an explicit loopback HMR port. The first broker
handoff dropped `--hmr-port`; because a private worker's API port is zero until
listen, Vite derived port 100 and the rendered chat check reported a WebSocket
failure. The broker now forwards the caller's chosen port or selects a fresh
loopback port. This does not expose the private HTTP API or its broker token;
the Vite service lives and stops with the captured worker process group.

Native launch requires ownership protocol 1 in the broker's lightweight health
response. The previous readiness helper accepted the old service name alone
and even fell back to the old private runtime endpoint on a missing health
route. It no longer reuses that legacy runtime. For an incompatible bridge at
this state root, bootstrap and `squad serve` explain that its older app/server
must be closed before retrying; they neither kill it nor adopt its unowned
data. A current bridge at another state root is not this instance's server.
The socket fixture exercises missing, current and unknown protocol versions.

## Consequences

- Local filesystems must provide SQLite/OS locks; unsupported locking fails
  closed. This does not establish network-filesystem safety. The bundled Node
  22.23.4 supports `node:sqlite`, whose API still emits an experimental warning.
  Portable runtimes now require Node 22.13 LTS or 24+; Node 23 is not in the
  supported range. Node 22.13 removed the SQLite flag requirement
  ([release notes](https://nodejs.org/en/blog/release/v22.13.0)). Staging probes
  the actual SQLite API as well as the version, rather than accepting an older
  binary that would fail when the broker imports the lease module.
- Crash recovery preserves ambiguous records and refuses new owned execution
  rather than killing processes whose identity is no longer provable. A
  surviving helper may require explicitly closing it or restarting the machine.
- This adds small machine control/journal files and a launch handshake. Those
  records contain process identifiers, never prompts, member files or tokens
  belonging to a portable backup.
- Windows uses a named Job Object with kill-on-close and no breakaway flags.
  The already packaged daemon has an early helper entry point, before daemon
  configuration/listeners. The broker persists a globally named random job
  before launching its gated Node fork. The worker connects to a one-use local
  named pipe; the host obtains the client PID, holds its process handle, then
  issues a challenge on that same connection. Only its live reply permits job
  assignment. A PID alone is insufficient because it could have been reused.
  Native launches use the same pipe proof with an external job watchdog before
  releasing stdin. The workload never receives a job handle or the pipe name.
  All descendants stay in the job, including detached children after root exit.
  Broker/daemon loss closes the watchdog's control pipe. Its EOF path sets
  closing, terminates the job, checks zero active processes and writes a flushed
  intent-bound receipt before exiting. Normal drain uses that same barrier.
  Review corrected the earlier assumption that a missing job name established
  completed cleanup: Windows can remove an object's name before its remaining
  references and pending termination I/O finish. A missing admitted job without
  a matching drain receipt stays blocked. A strictly lower current kernel uptime
  than the persisted pre-launch uptime proves a reset and permits recovery;
  equal or greater uptime proves nothing. No wall-clock-derived boot identity
  or undocumented system-information enum is used. Abrupt watchdog failure can
  therefore require restarting the computer; ambiguous legacy records and
  access errors also remain blocked. The challenge uses the system CSPRNG.
- Windows metadata replacements flush the temporary file and use same-directory
  `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)` through the packaged helper.
  There is no unlink-first or cross-volume copy fallback. Unix keeps directory
  fsync. These are process-crash recovery guarantees, not a general guarantee
  against power loss or storage-controller failure. A missing/incompatible
  Windows helper blocks admission/publication rather than falling back to
  root-only process termination or pretending directory fsync succeeded.
- Restore/reset transaction integration is verified through actual broker and
  browser checks, including interrupted responses and explicit restart. Native
  installed-window verification and the remaining broad regression checks are
  separate outstanding evidence; no installed application was replaced.

## Validation

The Windows helper module passed `cargo check --target x86_64-pc-windows-gnu`
in an isolated harness importing the actual source. A full daemon cross-check
on this Mac stops at the missing MinGW C compiler, so this is not full Windows
execution evidence. `scripts/check-owned-windows.mjs` is run by native Windows
CI after building the real helper: gated assignment, duplicate-name refusal,
cancellation before attachment, surviving detached grandchildren, host and
broker crashes, named-job recovery, and metadata replacement. The existing
Mac owned-lifecycle and real broker/worker transaction checks passed after
the shared supervision and metadata changes.

Rendered reset testing found two migration errors that backend-only checks
missed: App's pending-reset write guard still admitted only the retired endpoint,
and ownership invalidation immediately navigated while the broker was still
draining. The guard now admits only the exact confirmed pending reset request.
The old realm is fenced/hidden immediately; replacement navigation waits for
a stable broker state. Tests exercise Settings with actual isolated broker
transactions, including a lost response, instead of mocking the old native
PID-based reset protocol.

The real macOS Vite teardown also returned `EPERM` transiently from the null
process-group signal. That result is treated as still present and retried
within the drain deadline, never as proof of exit. Only `ESRCH` retires the
Unix group. After this correction the full 16-case desktop/mobile update,
artifact and reset Playwright suite passed, including explicit restart,
preserved earlier storage and lost-response recovery.

`cargo test --lib run_ -- --test-threads=1` passed the real native process drain,
stored-run counting and new stale-run projection tests. The latter checks
confirmed and unconfirmed cleanup, unstamped legacy execution, unchanged raw
history bytes and matching list/metric projections.

Restore/reset use a durable owner-and-initiator operation journal with a unique
request ID, before/after dataset IDs and monotonic phases. A retry of the same
intent returns its receipt; it cannot publish a second import. After a crash,
the actual dataset pointer determines whether publication committed. A renamed
pointer is not rolled back merely because a later fsync/response failed. An
unpublished interruption preserves the original selection. A committed import
requires explicit Restart Squad before admitting private work.

A newly authorized team operator can acknowledge the already committed dataset
without adopting the initiating actor's private source receipt. The journal
keeps the original actor and records the acknowledging actor separately. This
avoids permanently blocking a team if the original operator is unavailable;
fresh write entitlement and the exact current publication pointer are required.

Review found a failed drain incorrectly reopening `ready` in a generic error
handler. That handler now requires confirmed quiescence and fresh authorization
before reopening the earlier dataset. An uncertain drain remains blocked with
its hold retained. Review also found a credential change during publication
could overwrite a pending activation with the old completion state. Publication
is held locally until the captured generation is rechecked after the journal
write; newly signed-in actors recover through their own activation.

The native shell only guards the originating confirmation/working generation.
It does not use a PID or read a machine-wide legacy reset-progress file as
private completion authority. The broker's operation receipt owns completion
and restart; old callbacks cannot clear a newer owner's confirmation.

`check-owned-transactions.mjs` runs a real broker and fixture worker, checks its
final drain write, uploads a verified source, confirms replacement, restores,
retries the operation after the response could have been lost, restarts the
broker and acknowledges from a different authorized team actor. It also resets
to a new empty dataset and refuses acknowledgment after an entitlement change.
These are isolated local checks, not installed application or cloud proof.

`node scripts/check-owned-lifecycle.mjs`, run with the actual bundled Node
22.23.4, verifies cross-process exclusion, acquisition after SIGKILL of the
known fixture holder, same-process exclusion before inode access, and refusal
of a surviving detached fixture helper until its group disappears.

`cargo test --lib owned_native_run -- --test-threads=1` runs an isolated native
HTTP listener and an actual TERM-ignoring shell/helper. The drain response is
pending while the process writes; private requests require their generation,
machine control requires its capability, and the durable intent clears only
after group exit. Completion stays in the departing dataset. Activity tests
also cover independent holds and uncertain-cleanup refusal.

`node scripts/check-squad-ownership.mjs` and
`node scripts/check-owned-data.mjs` cover broker transitions and the actual
passive worker after the startup handshake. These are isolated local runtime
checks, not installed-app, provider, hosted deployment or release evidence.

Native commands retain the originating generation through grant loading,
human confirmation, OS notification submission/acknowledgement, click dispatch,
badge updates and update quit. A generation change cancels the app's old
Computer Use modal and removes old scoped OS notifications. A new native
process withdraws notifications from the previous process rather than adopting
their routing authority. Historical attention remains available inside Squad.
Notification attempts use distinct IDs so a late failed submission cannot
withdraw a newer retry. Timeout and late-callback paths both withdraw their
own scoped request.

The native binary's existing 31 unit checks passed; two additional filesystem
authority checks passed for A-to-B command rejection and notification
presentation/click fences, including an already queued click and duplicate
event IDs. No real notification was submitted by these tests. An isolated
AppKit fixture under `.codex-artifacts/ownership` also ran a native NSAlert and
called `abortModal`: it reported `modalAborted=true visibleAfterReturn=false`.
That verifies the modal API behavior, not the full installed application flow.
