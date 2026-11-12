# ADR-0209: Re-read Windows cleanup proof after querying the OS

## Context and evidence

ADR-0208 corrected a fixture that asserted replacement before its drain receipt
existed. A separate production ordering remained: the initial receipt read can
return ENOENT, then the watchdog can persist the receipt and exit while the
native status helper starts. The status helper correctly reports a missing job
on the same boot. That result alone is insufficient cleanup proof, but the
receipt now present is sufficient.

`node scripts/check-owned-windows-proof.mjs` models that ordering through
`windowsJobDrained`, using a real receipt file written during its status query.
It failed before the second read and passes with it. It also checks missing
proof, a strictly lower boot uptime, and a mismatched late receipt. This is a
deterministic ordering reproduction, not a trace proving that this race caused
the earlier Windows CI failure.

## Decision

Read and validate the durable receipt again after the native query. Both reads
use the existing no-follow, regular-file, single-link, size and job-name checks.
A missing job on the same boot still cannot authorize replacement by itself.
Allow an in-process query callback for the ordering regression; production uses
the native helper unchanged.

## Consequences

A valid receipt published during a slow helper launch is recognized immediately.
The extra file read adds a small amount of I/O. Windows process-group behavior
still needs the Windows runtime CI checks; this cross-platform regression proves
the JavaScript ordering and validator, not Windows kernel behavior. Existing
receipt durability and boot-reset assumptions remain unchanged.
