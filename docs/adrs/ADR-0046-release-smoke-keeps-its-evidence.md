# ADR-0046: A failing smoke test has to say what happened

Date: 2026-09-29
Status: Accepted

## Context

The nightly release build failed on the Intel runner with one line:

> Autohand Squad web server did not become ready.

Nothing else. No server log, no exit code, no state. Investigating it took an
agent an hour and ended without a proven cause, because the evidence had been
thrown away by the step that failed.

Two things were established and are worth keeping.

**It was not a regression.** The boot path and the `/api/runtime` handler the
test exercises are byte-identical between the night that passed and the night
that failed. Nothing in `.github/`, `daemon/`, `src-tauri/`,
`scripts/stage-desktop.mjs` or the lockfile changed. The only commits touching
`server.mjs` in that range added request-time behaviour, and the route
plug-ins load after `listen` inside a `catch`, so a failure there cannot block
readiness.

**The diagnostic was unreachable.** The step runs under `set -euo pipefail`.
`squad serve` waits for the bridge itself and exits non-zero when it does not
answer, so the shell aborted on that line, three lines above the
`cat "$state_root/web-server.log"` that exists precisely for this. The log was
written and never read. That is the whole reason this failure is unexplained.

It also turned out that this step is the only place in any workflow, on any
platform, where the bundled bridge actually boots. The CI dry run never builds
a bundle or mounts an image; the portable smoke stops at `--help`; Windows and
Linux only assert that files exist. So the one test that can catch a broken
bundle was also the one that reported nothing when it did.

## Decision

**The serve command fails soft and carries its status into the report.** The
readiness loop then runs, and on failure the step prints the exit code, the
bundled server's own log, the state directory, and what was listening. If the
log was never written, it says so, which is itself a different diagnosis.

Nothing else changes. The timeouts, the probe and the pass criteria are
untouched, because the cause is not yet known and changing behaviour to chase
an unproven theory is how a flake becomes permanent.

## Consequences

- The next occurrence explains itself, whether it is a slow first response, a
  crash on boot, or a port already taken.
- The leading theory is recorded but not acted on: `/api/runtime` shells out
  to the 91 MB vendored CLI on every request with a five second allowance,
  while the readiness probe gives up after 800 milliseconds, and it reads from
  a read-only compressed disk image that is also the server's working
  directory. The same Intel runner took 3.9 seconds the night before and the
  Apple silicon runner took 2.0 seconds in the failing run. That is a race,
  not a cliff. Caching the version would remove it, and should wait for one
  run that proves it.
- This does not fix the coverage gap. A bundle that boots only on macOS is
  still the only boot anyone checks.
