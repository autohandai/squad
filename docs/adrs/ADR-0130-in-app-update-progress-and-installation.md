# ADR-0130: Download first, install when work is finished

Date: 2026-10-14
Status: Accepted

## Context and evidence

The user's installed 0.1.6 screenshot called the app up to date against public
0.1.5, put versions and a full timestamp in one long line, and repeated GitHub
and installer instructions. ADR-0064's bridge streamed and verified downloads
but exposed no measured progress and opened the installer immediately. Its
single long POST did not survive a view reload as an observable operation.
The user asked for notification of new releases and an easy in-app upgrade.

## Decision

Keep official GitHub discovery, compatible asset selection, checksum, redirect,
size, timeout and same-origin guards. Split Download and Install into explicit
choices. A bridge-owned operation reports real byte counts, verification,
preparation, ready, failure and restart; it persists the verified installer and
recovers after navigation/reload. Cancellation removes partial downloads. No
percentage is invented when content length is absent. Retry retains the reason.

Settings shows one status and next action, followed by separate version rows
and the last check time. A build ahead of the published version is a preview.
Expanded and compact sidebars expose the same operation. Automatic discovery
respects the System switch in the browser, bridge and daemon. Inspection found the daemon’s once-per-minute cycle still contacted GitHub with the switch off; it now reads the same saved setting. Manual checks always work.

A writable installed Mac downloads the existing release DMG, mounts read-only,
checks bundle id/version/signature and preserves the current signing team,
stages beside the installed app, then offers Install and restart. The native
main window may quit only for an armed operation addressed to its current PID.
Resolve the exact live executable on every attempt: an inherited PID was an
incorrect first design because bootstrap reuses a healthy bridge after Quit.

An installation owner blocks duplicate download/install and new work at the
actual launch/registration seams, including requests admitted before locking.
Active chats, observations, sessions, runs, goals and queued follow-ups refuse
installation. Before the final idle check, acquire an owned daemon admission
pause under the same mutex as direct run/queue creation. Preparation has a shared two-minute deadline; mount cleanup is bounded separately. Resume it on failure;
a fifteen-minute lease releases a pause abandoned by a crashed bridge. Manual
daemon stop clears the owner so a lease cannot undo shutdown. The helper waits for the native process and stops only identity-
checked owned services, using their graceful /stop lifecycle and the bridge’s
normal SIGTERM cleanup. Calling `squad stop` was rejected during review because
its machine-wide cleanup can stop work outside this bridge. The native worker
uses macOS atomic directory exchange, preserving the previous bundle at the
staging path. An opener failure exchanges it back. No user state is moved.

## Consequences and proof boundaries

- Existing DMG releases work without a second update manifest or pretending the
  current 0.1.5 release is a new candidate. GitHub publication remains separate.
- Windows/Linux, browsers and unwritable/ambiguous Mac installs use the verified
  system installer. Linux AppImage replacement remains manual and says so.
- Checksum provenance is not a new signed update framework. Current signing-team
  checks supplement it; local ad hoc builds are still not notarized releases.
- A successful system opener is launch acceptance. Rollback covers replacement
  and opener failure, not an arbitrary crash after launch. The previous app is
  retained; successful update is acknowledged by the new frontend's progress
  request against its matching version, not merely by the helper exiting.
- Older verified downloads and rollback bundles are retained. Automatic retention
  cleanup and administrator-elevated installation are deliberately left undone.
- Focused backend checks use mocked downloads/openers. Native filesystem tests,
  rendered browser checks and installed-app inspection are separate evidence.

## Validation

`check:update-flow` verifies chunked byte progress, duplicate refusal, ready-state
persistence, idle refusal, checksum recheck and cancellation. `check:desktop-updates`
retains its official URL/platform/size/timeout/checksum cases. The native Rust
atomic exchange test exchanges real directories and restores them. The live isolated daemon HTTP check confirms rejected run/queue records while paused and successful owner resume. Its first assertion wrongly expected the JSON test client to reject HTTP 503; the helper parses response bodies regardless of status, so the corrected test asserts rejected records and an empty persisted runs list. Further
browser/package/install results are recorded with the local candidate receipt
in `docs/reports/squad-reliability.md`.
