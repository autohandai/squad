# ADR-0208: Wait for durable cleanup proof in the Windows check

Date: 2026-11-12
Status: Accepted

## Context and evidence

The Windows runtime job in [CI run 43196079950](https://github.com/autohandai/squad/actions/runs/43196079950/job/131107286715)
passed 104 native tests, then failed the broker-crash check when the replacement
ledger correctly refused unconfirmed cleanup. The failure was at the replacement
call in `scripts/check-owned-windows.mjs`, after the fixture's drain predicate.

That predicate accepts a live named job with no active processes. Native cleanup
first terminates and drains the job, then flushes and atomically publishes its
receipt before exiting. A status query can observe the empty live job before
publication. The next recovery check can read the receipt before publication,
then query job status after the watchdog exits, observing neither proof within
that call. Empty state is therefore insufficient as a stable precondition for
this replacement assertion.
This explanation follows the helper and ledger control flow; no Windows trace
has established the precise scheduling of the failed run.

## Decision

After confirming both fixture processes are gone, wait for the receipt to exist
and require the existing `windowsJobDrained` validation to accept it. Only then
attempt replacement. Retry missing-file observations within the existing bounded
poll; propagate other file errors. Keep the contender rejection, broker crash,
detached-child checks and replacement assertion.

## Consequences and verification

Only the verification script changes. Production cleanup, job validation and
fail-closed ledger recovery remain unchanged. This adds no sleep or timeout
increase and does not retry replacement or suppress its failures. A missing or
invalid receipt still fails the check. Native Windows acceptance must come from
the corrected head's Windows runtime CI; macOS syntax or browser checks do not
establish that result.
