# ADR-0079: Reconcile accepted handoffs with the current bridge process

Status: accepted

## Context and evidence

Ordinary chat recovery already repairs loading messages when the bridge
restarts. Accepted handoff tasks were separate records, so repairing the
recipient's transcript left the parent claiming active work.

`node scripts/check-collaboration-cycle.mjs --case=interrupted` reproduces this
with the real browser and bridge: accept a controlled review, navigate away to
destroy the browser's coordination promises, restart the bridge, then reopen.
The recipient message becomes an interrupted error, but the same parent task
remains `running` instead of `blocked`. The red observation is retained in
`.codex-artifacts/reliability/collaboration-recovery-red.log`.

## Decision

Use the same runtime `serverStartedAt` boundary as ordinary chat recovery.
Accepted browser-owned handoffs from before that process cannot represent
confirmed active execution. Mark those handoffs and their linked assignments
failed, record an interruption event and block the parent, retaining identity,
request context, earlier evidence and history. An accepted legacy record with
no valid execution time also cannot claim confirmed active work.

Preserve handoffs accepted in the current process, unaccepted pending choices,
completed/cancelled tasks and separately managed durable goals. Apply the repair
idempotently with functional state updates. Do not send another model request
merely because state was restored.

## Consequences and limits

Needs you can show the actual blocked checkpoint instead of stale activity.
Context and partial transcripts survive for inspection, but they do not prove
which arbitrary tool side effects completed before interruption. Explicit
retry execution, completed-effect receipt reuse and busy-target handling remain
separate end-to-end acceptance work; a repaired state is not a resumed model.
Recovery remains within the existing device-local task store, not a new bridge
delegation journal or cross-window task conflict protocol. No automatic replay
policy or durable goal behavior changes.
