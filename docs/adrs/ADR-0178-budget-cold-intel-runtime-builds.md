# ADR-0178: Budget cold Intel runtime builds separately

Date: 2026-11-04
Status: Accepted

## Context and evidence

The second v0.1.20 release attempt passed its Intel runtime tests but was cancelled during `cargo build --release --bins -j1`. GitHub annotated job 126480870014 in [run 41798463350](https://github.com/autohandai/squad/actions/runs/41798463350) with “The job has exceeded the maximum execution time of 35m0s”. Publication and feed updates were skipped. Both notarized Mac desktop installers and the other platform jobs had already passed.

This job compiles and tests a debug runtime before building every optimized runtime binary. A cold hosted Intel build cannot rely on a previous successful cache, especially after an earlier job failed before cache publication. Its existing 35-minute limit was insufficient for the observed work. Retrying unchanged source does not correct that budget.

## Decision

Give the Intel macOS runtime artifact job a 60-minute limit. Retain 35 minutes for other runtime targets and existing independent limits for desktop and PR jobs. Keep serial compilation, runtime tests, packaging checks, signatures and publication dependencies intact. A cache remains an optimization rather than a release prerequisite.

Leave failed version tags immutable and unpublished. Prepare 0.1.21 from the corrected source, carrying the artifact Library, managed MCP visibility, reset recovery and signing changes that never reached stable downloads in 0.1.19 or 0.1.20.

## Consequences

A cold Intel build has room for both profiles and packaging. A stalled Intel runtime job can now consume up to an hour before cancellation, so failures may cost more runner time. Other targets keep their existing limits. This does not speed compilation, guarantee external-service availability or weaken any validation gate. Cache redesign and compiler/profile optimization remain separate work.

## Verification

The release workflow contracts validate the resulting source, and the new immutable release run must establish that the cold Intel job completes and all downstream publication checks pass. The cancelled v0.1.20 attempt is evidence for the budget change, not evidence of a published release.
