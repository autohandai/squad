# ADR-0177: Retry interrupted pinned component downloads

Date: 2026-11-04
Status: Accepted

## Context and evidence

Main CI run [41798449553](https://github.com/autohandai/squad/actions/runs/41798449553), Intel dry-run job 126471177761, failed while downloading the pinned Computer Use archive. Node reported an interrupted response body (`TypeError: terminated`, cause `read ETIMEDOUT`) about 70 seconds after download began. The same source passed the other platform packaging jobs and both actual Mac desktop release jobs. This failure was a transport interruption, not a source compilation or checksum failure. The downloader previously made one attempt, so a broken connection failed the whole build.

## Decision

Keep the exact pinned URL and SHA-256 requirement. Permit up to three attempts for transient socket/DNS/timeouts, HTTP 408 and HTTP 5xx responses, waiting one then two seconds. Each transfer retains its 120-second timeout and 512 MiB limit. Delete partial bytes before retrying; move the temporary file into its prepared location only after its full checksum matches. Always remove the task-owned download directory afterward.

Do not retry checksum failures, oversized files, filesystem errors, permanent HTTP errors or a corrupt existing input. Check-only mode still performs no download. Valid cached bytes remain unchanged. This is build-time resilience; agents do not download a different component at runtime.

## Consequences

A temporary connection failure can recover without rerunning compilation or weakening artifact verification. A sustained outage can add up to three bounded transfer attempts to build time and still blocks the release. Rate limits and permanent missing artifacts remain errors. The change covers Computer Use's existing downloader rather than adding a general network abstraction or changing other dependency-fetching paths.

## Verification

`check-computer-use-download.mjs`, included in `check:computer-use`, uses an actual local HTTP server. It interrupts a response after a partial body, then confirms a complete retry is saved without concatenating stale bytes. It covers recovery after temporary HTTP failures, exhaustion after three interrupted transfers, one-attempt rejection of wrong checksums and HTTP 404, valid/corrupt cached files, check-only mode and absence of leftover partial directories. Tests replace waiting with a recorded backoff, not the network stream.
