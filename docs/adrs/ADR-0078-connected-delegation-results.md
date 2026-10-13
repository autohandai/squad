# ADR-0078: Keep delegated review connected to the original task and conversation

Status: accepted

## Context and evidence

The documented reply-mention flow starts a receiving teammate immediately and
returns its result to the source, with a two-hop limit. A real browser/bridge
probe using controlled SDK output reproduced a broken second hop:
implementation handed to QA, QA handed to review, but the browser persisted
two independent tasks. The first task was already completed while the review
was still running. The implementation conversation received QA's initial ask,
not the awaited review verdict.

`node scripts/check-collaboration-cycle.mjs` recorded `2 !== 1` and retained
the two task records in `.codex-artifacts/reliability/`. The partial-output
provider-error case already passed; it was not an additional reproduced
product defect. Initial probe setup used the wrong message-storage key and a
temporary workspace outside the allowed user directory. Correcting the probe
to the existing contract preceded interpreting the product failure.
The probe also records the SDK's actual `{ message }` argument, rather than
assuming a string. A later random test port made Vite's default `port + 100`
exceed 65535; isolated bridges now pass a separately allocated HMR port using
the existing CLI option. These were harness corrections, not delegation fixes.

## Decision

Retain the existing mention parser, permission/break boundaries, adapters and
two-hop limit. Continue delegated review on the incoming parent task. Keep the
original user request, selected workspace and bounded earlier handoff evidence
in recipient context, rather than relabel every sender reply the user request.

Await delegated recipients after the sender's actual stream finishes. A
recipient returns its own result plus awaited child results to the source, so
the review verdict reaches the initiating conversation. Record each handoff
separately; the parent completes only when its accepted/pending handoffs finish
and none failed. Return completed ownership to the origin. Errors and stopped
recipients remain failed even when partial text exists.

Append new handoffs to current task state with functional updates so a stale
branch snapshot cannot discard a sibling's result. Use UUID identities for
new tasks/handoffs and derive creation timeline IDs from the handoff, avoiding
collisions for multiple mentions in one turn. Older record IDs stay valid.

## Consequences and limits

The initiating send call remains pending while its delegated work finishes,
although its own streamed reply is already visible. Results keep attribution
in the existing handoff messages; there is no new manager agent or dashboard.
Context is bounded and can omit older details; recipients must inspect the
assigned project rather than treat summaries as complete evidence.

Execution coordination remains owned by the open browser, while task/history
records persist in the existing local storage. Closing a browser does not
persist a JavaScript promise or guarantee automatic continuation. Restart,
busy/refusal and retry acceptance remain separate reliability work until
their end-to-end checks pass. Stable handoff IDs do not make arbitrary model
tool side effects idempotent. Controlled SDK output validates orchestration,
not actual implementation quality or live-provider compliance.
