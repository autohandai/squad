# ADR-0196: Remember unsupported optional daemon endpoints

Date: 2026-11-11
Status: Accepted

## Context and evidence

Issue [54](https://github.com/autohandai/squad/issues/54) reports repeating
404 errors for device registration, feature flags, heartbeat and telemetry.
These legacy `/v1/squad/*` paths are absent from the dedicated Squad API
router. The daemon constructed a new client for every operation, sent all four
requests every observability cycle, and logged every unsuccessful HTTP status
as an error. The snapshots discarded unsuccessful response statuses, while a
telemetry snapshot counted attempted events as sent. Even disabled telemetry
returned a `remoteError` that the cycle logged as a failure.

The regression `observability_does_not_repeat_unsupported_remote_requests_or_errors`
drives three actual observability cycles against an isolated HTTP server,
with automatic updates disabled in its temporary state. Before the fix it
failed with **12 requests instead of 4** in 0.08 seconds. This reproduces the
reported requests and logging seam without touching an installed app or a
remote service. No wall-clock waiting or live account is required.

The ranked explanations were no retained endpoint support, a wrong API
destination, and a transient server error. The fixture reproduces the symptom
with a known destination and stable 404 responses; client recreation and the
absence of a support state explain the repeating cycle. We have not changed
the configured API destination. The separate missing team-proposal control
is a channel receipt/rendering defect (PR62); the 404s do not establish that
feature flags caused it.

## Decision

Keep one cloneable API client per daemon, with endpoint-specific in-memory
support state shared by scheduled and manual requests. Treat only HTTP 404,
405 and 501 from these four optional endpoints as unsupported. Preserve the
status, report `success: false`, and distinguish `remoteState: unsupported`
from `failed` without populating `remoteError`. Pause that endpoint for one
hour, then probe again; a new daemon/configuration starts fresh. Serialize
probe admission to prevent concurrent checks from repeating the same missing
endpoint. Bound requests to ten seconds.

Authentication errors, rate limiting, malformed flag JSON, network failures
and other server errors remain errors and are retried by the existing cycle.
Do not apply optional semantics to releases or owned-data routes. Disabled
telemetry sends nothing and has no error. Count telemetry as sent only after
an HTTP success. Preserve the local event buffer and existing update policy.

## Validation

The original full-cycle regression now passes: four requests, unsupported
snapshots retaining 404, and no repeated 404 error logs. Additional real HTTP
tests cover 404/405/501, shared cloned clients, endpoint isolation, retry after
expiry, a fresh client's probe, 401/403/429/500/503 retries, successful flag
parsing, acknowledged event counts, disabled/empty telemetry, malformed JSON
and a refused connection. The ordinary native suite passed all 93 library tests; the final full-cycle
regression passed again after the event metadata and disabled-policy changes.
`cargo fmt --check` and `git diff --check` also passed.

## Consequences and limits

An undeployed optional service no longer creates a minute-by-minute error
storm or masquerades as successful delivery. Operators can still see the
unsupported status in the saved snapshot and event metadata. A newly deployed
endpoint may remain unused for up to one hour, or until daemon restart. The
cache is process-local; restarting also permits another missing-route probe.
The narrow admission lock serializes optional probes, so a slow request can
delay a manual optional check until its bounded deadline.

This does not implement a hosted telemetry collector, remote flags, device
registration, a server capability manifest, persistent backoff, event-buffer
retention or a delivery cursor. The existing local flag list remains empty
when none was fetched; its unsupported state must not be interpreted as a
successfully fetched set. No API deployment, provider request, release or
installed-app verification is claimed by the fixture tests.
