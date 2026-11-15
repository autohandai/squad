# ADR-0226: Give Intel release dry runs the release build's time budget

## Context and evidence

PR82's CI run 43750448354 passed Web, all four runtime suites, Desktop shell,
release metadata and Linux, Windows and Apple silicon release dry runs. Its
Intel dry run (job 132927251353) remained in `Build release binaries`, then
completed as cancelled. The check annotation states: "The job has exceeded the
maximum execution time of 35m0s". The job started at 19:20:04 UTC on 15 November
2026; GitHub finalized its cancellation at 20:00:04 UTC. The latter includes
cancellation overhead and is not evidence of forty minutes of useful build.

The job-log endpoint returned BlobNotFound/404. We cannot establish the last
compiler operation or diagnose a compiler hang from an unavailable log. The
separate older public-release Intel runner communication failure also does not
establish the same cause. These remain distinct observations.

CI used a flat 35-minute budget for every release dry run. The actual Release
workflow already allows its Intel runtime-artifact job sixty minutes, with
thirty-five minutes for the other platforms. Both execute a cold, single-job
release-mode Rust build. PR83's Intel dry run was still building when this
mismatch was found; its completion was not assumed.

## Decision

Use the Release workflow's existing platform-specific budget in CI: sixty
minutes for `macos-x64`, thirty-five for the other three release dry runs.
Retain the builds, tests, package/manifest checks, matrix coverage and runner
selection. Do not move a release tag or publish before all four dry runs and
manifest validation succeed on the reviewed source.

## Consequences and verification

This permits a slower cold build and can also delay reporting a real stuck
build. It does not diagnose or repair a compiler/runner stall, introduce a
cache, or guarantee the extra time is sufficient. A new exact-head CI run must
prove that the Intel package and aggregate manifest complete; a longer timeout
or source review alone is not a passing build.

Local verification uses `node scripts/check-release-workflows.mjs` and
`git diff --check`. Exact-head GitHub CI and its Intel packaging result are
reported separately on the PR.
