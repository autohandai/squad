# ADR-0137: Recover local services without changing the desktop's origin

Date: 2026-10-21
Status: Accepted

## Context and evidence

While installing the published 0.1.8 release, reopening the desktop failed with
“Analytics port … is in use by another program”. The listener was Squad's own
analytics executable. The first suspicion, a stale process, was incomplete:
`/health` answered HTTP 200 in 0.000518 seconds and `/metrics` in 1.131718 seconds.
The CLI's HTTP read deadline is 800 ms. Preflight decoded `/metrics` to establish
ownership, then labelled any failed response as another program. The installed
`squad doctor` reproduced that false analytics-port failure; its captured report
is `.codex-artifacts/runtime-bootstrap/native-install-0.1.8/doctor-before.json`.

Analytics builds metrics by reading all telemetry and recent-log source files.
The measured machine had approximately 70 MB of telemetry and an 85 MB daemon
OTLP log. Both HTTP metrics collection and the periodic snapshot ran synchronously
inside Tokio tasks. A slow status request was evidence of expensive collection,
not evidence that the service needed killing. The bridge supervisor similarly
used `/api/runtime`, which performs CLI/account discovery; a cold live request
took 0.892899 seconds, beyond the same deadline. Old 0.1.7 logs show repeated
bridge restarts after failed probes; this is not a claim about 0.1.8 restart counts.

The deterministic regression `analytics_readiness_does_not_collect_metrics`
ran red with the original probe and green with `/health`: a live listener can
answer health while metrics is unavailable. The real installed `doctor` command
provides the separate original-machine reproduction.

## Decision

Use cheap, in-memory health responses for analytics readiness and bridge startup
and supervision. Return service, version, PID, state directory and start time;
keep full metrics and runtime discovery on their existing routes. Move analytics
collection to Tokio's blocking pool, removing the duplicate snapshot write.
Retain the older analytics health-message contract and bridge runtime fallback
for reattaching to older releases, rather than requiring a coordinated restart.

Before startup, resolve service ports in one runtime module. Reuse only healthy
services for this state directory. An unhealthy analytics listener can be recycled
only when its saved host/port/PID, sole listener PID, exact executable and process
birth time agree. Recheck ownership immediately before normal TERM/KILL shutdown.
Analytics executes no agent work. Never call the global Quit/stop cleanup here.
An unresponsive recorded daemon or bridge is retained because startup cannot
prove that its agent work is idle. A failed health check alone is no kill authority.

Unrelated background listeners stay alive: choose separate free daemon/analytics
ports and use their actual persisted records on later starts/stops. An explicitly
fixed daemon port remains fixed. Keep the configured web address stable. During
design we considered automatically moving every occupied port; inspecting
`src/App.jsx` showed that members, onboarding, drafts and other saved state still
depend on origin-scoped localStorage. Changing the UI port would make that state
appear missing. Therefore a foreign web listener receives a concrete conflict
message and Retry rather than a silent move to an empty-looking desktop. No
broader Tauri origin permission is required.

The same identity boundary applies to explicit stop/restart: a stale saved
endpoint does not authorize sending a shutdown request to its new owner, and
an old PID does not authorize a signal. Linux reads the executable through
`/proc/<pid>/exe`; its `ps comm` field is a basename, unlike macOS's full path.
Preserving a possibly busy daemon needs less evidence than terminating it:
retain a live expected core image even if cold-start timing made the saved birth
time imprecise, but ignore a positively identified foreign image as a recycled
PID. A live daemon on a fallback port remains the owner even when the default
port later becomes free; explicit fixed-port changes must first stop that work.

## Consequences and limits

- A healthy service is reused, not killed to obtain a free bind. Busy agent work
  is preserved when ownership or idleness is uncertain.
- Automatic stale analytics termination is enabled where Unix listener and
  executable/start-time evidence can be established. Without that evidence,
  choose a free background port rather than signal an unverified PID.
- Snapshot scans remain proportional to history size. Incremental aggregation,
  caching/coalescing simultaneous metrics requests and log retention remain
  separate performance work; the health contract no longer depends on them.
- Port selection releases its probe socket before service startup. Another
  process can still acquire it; Retry reruns resolution. Socket handoff and
  automatic recovery of an unresponsive potentially busy bridge are left undone.
- A foreign web-port conflict still needs the conflicting app closed. A stable
  native UI origin or a fully durable replacement for browser-held state would
  be required before safely moving that address automatically.
- The installed public 0.1.8 release is distinct from this subsequent source fix.
  The release was signature/checksum verified, atomically installed and opened
  with nine saved members and existing channels; the fix needs a later build.

## Validation

`cargo test --manifest-path daemon/Cargo.toml --lib` covers the actual health
request path, healthy reuse, foreign listener preservation, fixed-port refusal,
separate background ports, executable/PID-reuse rejection and real termination
of a deliberately stalled owned analytics child. That child is reaped by its
test parent: the first fixture incorrectly treated an exited-but-unreaped child
as an alive service through `kill -0`; the reaper corrects the fixture rather
than weakening production identity checks.

The final local suite passed 91 tests. Additional regressions exercise a real
stalled daemon on a recorded fallback port, recycled unrelated PIDs, fixed-port
changes, diagnostics following the actual daemon record, and a foreign HTTP
listener receiving no shutdown POST despite stale saved service records.

`node scripts/check-runtime-bootstrap.mjs` checks the real bridge health response
with isolated state and no installed CLI before exercising first-run recovery.
The native 0.1.8 launch/data proof is separate from these source regressions;
no replacement of a running user's app is inferred from passing tests.
The updated CLI's `doctor` exited 0 on the original machine, recognizing all
three occupied Squad ports; the captured counterpart is `doctor-after.json`
beside the failing report. Desktop compile validation used
`TAURI_CONFIG='{"bundle":{"externalBin":[],"resources":[]}}' cargo check
--manifest-path src-tauri/Cargo.toml`: this checkout has no staged sidecars,
so that check proves shell/runtime compilation, not a new packaged release.
