# ADR-0201: Separate a requested teammate wait from its transport budget

Date: 2026-11-12
Status: Implemented

## Context and evidence

The reported managed MCP call supplied `wait_seconds: 60` and failed with
`arguments.wait_seconds must be at most 50`. The service rejected the call
before saving or delivering the message. Its dispatch path already capped
waiting to a per-harness budget, but its schema prevented that path from
handling a common one-minute request.

`node scripts/check-team-wait-budget.mjs` reproduces that exact validation
error against the original bound. With the corrected schema the same call
returns a real reply and reports requested 60/effective 25 seconds. The check
also covers a 600-second request, immediate receipt with a zero transport
budget, and rejection of negative, fractional, string or above-limit budgets.
The fixture waits for admitted deliveries before deleting its isolated store.

## Decision

Accept requested integer waits from 0 through 600 seconds, consistent with
the operator's bounded waiting range. Preserve the actual managed-call cap
of 50 seconds and Autohand's existing 25-second cap. Do not extend harness
timeouts to make the input valid. Return `requestedWaitSeconds` and
`effectiveWaitSeconds` with the existing durable delivery receipt.

A transport-limited wait returns queued/running state honestly; the saved
delivery continues and `squad_replies` collects a late answer once. A caller
that intentionally retries can supply the existing stable `request_id` to
avoid duplicate work.

## Consequences

- A one-minute request reaches the teammate instead of failing before delivery.
- The server may return sooner than requested. This is explicit in the schema
  and receipt, rather than a promise to hold an MCP connection for ten minutes.
- Invalid types and unbounded budgets remain validation errors. The fix does
  not silently coerce arbitrary input or resend a pending request.
- Existing clients with cached schemas need to reconnect to see the versioned
  tool contract. Already running installed releases are not modified by source
  or fixture verification.
