# ADR-0174: Reset preserves supervision and waits for explicit restart

Date: 2026-11-04
Status: Accepted

## Context and evidence

[Issue #48](https://github.com/autohandai/squad/issues/48) describes a reset dialog that stays open without progress and allows quitting while work is being archived. The existing UI waited a fixed 2.5 seconds before reloading. The daemon checks its supervised web-server record every five seconds, so even successful recovery could lose that race.

The more fundamental defect was on disk: reset moved the entire state directory, including web-server.json, then exited Node. The surviving supervisor skips recovery when that ownership record is absent. A new test using the actual daemon and bridge failed waiting for a new healthy bridge PID. Preserving the original ownership records made that same scenario pass without any manual restart. The older API test manually restarted Node, masking the production failure.

That first green test was still insufficient: its CLI launcher exited, so macOS reaped the old bridge independently. In the actual isolated native app, the long-lived desktop shell retained an exited Node child as a zombie. `process_is_running` considered it alive, causing twelve failed probes before recovery. The native fixture reproduced this delay. A runtime test calling the actual bridge spawn while retaining its parent failed in three seconds before the correction. Bridge spawns now keep a per-child waiter to reap the exact child; the supervisor integration resets a second time to exercise a bridge parented by the surviving daemon too.

Investigation also found that AUTOHAND_SQUAD_HOME alone did not isolate managed member workspace roots: those use os.homedir(). Reset checks now override homedir only in their child process, without changing HOME, and assert the reported workspace root is inside the fixture before sending a reset. An audit after the baseline check found no new November 4 archives of the person's managed roots; existing November 2 archives were left alone.

## Decision

Archive the team state, member homes and managed workspace roots once each. Retain daemon, analytics, bridge, tray and native-token ownership records unchanged so surviving services remain identifiable and the supervisor can launch a fresh bridge. Persist a request-specific progress/terminal receipt across the archive. Duplicate delivery of a completed request returns that receipt instead of resetting the new profile again. New API mutations are fenced while the old bridge exits; the renderer also rejects background mutations until restart.

Stop managed work before archiving, with a bounded wait. A partial rename failure rolls completed renames back in reverse order. Keep anything concurrently recreated in a recovery archive rather than delete it. Unknown outcomes remain visible and check the original receipt; they never repeat the destructive request automatically.

The native shell acquires a quit/close guard before showing confirmation. Cancel or X releases only confirmation. Once working, only a matching terminal receipt releases the guard. The dialog shows progress, then a completion prompt with the single Restart Squad action. There is no timed reload. Native Quit, tray actions, update-triggered quit, main-window close and navigation are guarded before their side effects.

On explicit restart, verify the bridge is healthy with a new PID at the same state directory and origin. Restart the shell and reuse those healthy services through the normal bootstrap. Avoid broad process-name cleanup, which could stop another profile. Clear only Squad browser storage at that explicit restart; keep unrelated browser keys and Autohand Code authentication.

## Consequences

Reset now has a visible lifecycle and survives a lost HTTP response without archiving twice. Recovery depends on preserved service ownership and a functioning supervisor. An unavailable service leaves an actionable status/retry state rather than pretending completion. Failed reset attempts also require an explicit restart before continuing.

The shell restart deliberately does not reinitialize the surviving daemon's in-memory device identity or configuration; team data is read from disk by the fresh bridge. This is not a fully transactional filesystem journal: power loss, force quit or external interference can still interrupt a multi-directory archive. OS force termination cannot be blocked by an application quit guard. Dated backups are retained, and rollback failures are reported rather than called success.

## Verification

- `check-system-reset-archive.mjs`: retained ownership bytes/modes, coalesced roots, preserved account data, injected partial-rename rollback.
- `check-system-reset.mjs`: safe child-home isolation, retained sign-in and dated data, fresh first-run API behavior.
- `check-system-reset-supervisor.mjs`: actual daemon recovery with a different Node PID, readable completion receipt and idempotent replay; no manual restart or model calls.
- `e2e/system-reset.spec.mjs`: confirmation cancellation, visible progress, no dismissal while working, explicit restart after waiting past the old reload timer, lost-response recovery and unavailable-service cancellation, on desktop and phone viewports. Native IPC is mocked in these browser tests.
- Rust reset-guard tests cover matching ownership and terminal phases, cancellation boundaries and stale completion receipts. The retained-parent bridge test failed before child reaping and passed afterward.
- An isolated macOS native fixture (separate app identifier, loopback ports, data/home directories, mock API and SDK) verified Cmd+Q/window close stay blocked in confirmation, Cancel works, completion has only Restart Squad, and explicit restart returns to first-run setup. Its bridge changed from PID 4048 to 14264; all moved paths stayed under the disposable fixture. This local preview was ad-hoc signed; it is not published-release signing proof.

## Regression-test startup correction

The first v0.1.20 release attempt failed the Intel retained-parent unit test while its other 98 runtime tests and all four desktop release jobs passed. The failed check included Node startup in its three-second disappearance deadline and recorded no evidence that the fixture had executed `process.exit`. Its message therefore could not establish that an exited child was actually a zombie.

A deterministic Node wrapper that sleeps four seconds before executing real Node reproduced that failure with the production waiter intact: the old test failed in 3.04 seconds. Split fixture startup from reaping. Wait up to 30 seconds for an atomically published exit marker containing the exact recorded child PID, then keep the three-second reaping limit. A missing or mismatched marker fails as a fixture/startup failure. Failure diagnostics include the selected runtime, marker PID, phase durations, process state/parent and bridge log; a fixture still alive after startup failure is stopped by its exact PID before removing its directory.

With the four-second wrapper, the revised check passed in 4.27 seconds. As a negative control, temporarily removing the production waiter made it fail after 3.029 seconds of reaping with the correct exit-marker PID and `ps` state `Z`; the waiter was restored immediately. The full local runtime library suite then passed all 99 tests. This corrects an ambiguous, timing-sensitive test; it does not prove which process state the original Intel failure had, since that attempt did not record it. Production spawning and supervision behavior are unchanged. Startup still has a finite deadline, so a genuinely stalled or broken Node launch continues to fail CI with separate evidence.
