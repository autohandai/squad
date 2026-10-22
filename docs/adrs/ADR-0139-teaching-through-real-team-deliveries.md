# ADR-0139: Teaching saves knowledge and delivers it to teammates

Date: 2026-10-21. Status: Accepted.

## Context and evidence

The person wants “teach others in the team” to cause communication. Existing
`squad_remember` saves shared memory; `squad_message` sends one message. A
model can promise to share without using either operation, or store a fact
without any teammate receiving a turn. These are different outcomes.

An added `squad_teach` case in `node scripts/check-team-operations.mjs` first
failed with “This team tool is not available through Squad.” The existing
service was the right seam: it already binds identity, persists messages,
queues each recipient and recovers interrupted deliveries.

Passing service and controlled Codex transport checks was insufficient. The
first real Autohand/fantail run rejected a selected-recipient teaching call:
it required a string path for authorization. The initial collision/hook
hypotheses were wrong. The CLI's generic authorization code treats `path`,
`file_path`, `from` and `to` as path aliases, even on MCP calls; the new
`to` array never reached Squad. The unreleased tool now uses `recipients`.
The next live run saved the shared lesson and received both real replies.
Evidence is retained in `.codex-artifacts/natural-workflows/live-autohand-initial.json`
and `live-autohand-teaching.json`.

That live run also showed a recipient sending its acknowledgement back
through `squad_message` while its sender was waiting. The new cycle case
first accepted that extra delivery. Bound ancestry now rejects such a wait
before mutation; the recipient's final answer is its return delivery.

## Decision

Expose `squad_teach` on the same managed MCP surface for every engine. It
validates the lesson and all recipients first, saves a shared memory, and
records one real delivery per selected teammate (everyone else by default).
Use the existing per-recipient queues, delegation depth and delivery history.
Each recipient gets a self-contained lesson and is asked to explain what it
changes for their role, without rebroadcasting. Retry ids deduplicate each
recipient independently. `squad_replies` collects the answers.

Use `recipients` for a list of teammate names or ids; omit it for everyone
else. Each delivery is a fresh work scope rather than the recipient's main
person-to-member conversation. Carry its ancestor identities through the
bridge, never model-supplied tool arguments. A recipient returns its final
answer (or clarification) automatically; it cannot queue a new message or
broadcast back to an ancestor waiting for that answer. Independent recipients
and ordinary non-nested communication remain available.

Instructions explicitly associate natural teaching/sharing requests with
this tool. The receipt distinguishes saved knowledge, queued/running work
and answers. A queued delivery never means “the team learned it”.

## Consequences and tradeoffs

- This composes existing operations instead of introducing another agent
  runtime or message database. Different engines can receive the lesson.
- Fan-out is not a transaction across model executions. A later failure can
  leave some recipients delivered and others pending; receipts remain
  visible and retry ids prevent starting the same recipient twice.
- Shared memory is limited to the existing 500-character gist and refuses
  credential-like content. Longer material should live in a referenced file.
- Delivery can wait behind a busy teammate. It does not interrupt their
  current work or promise that an unavailable engine has learned anything.
- Recursive conversations cannot synchronously ask an ancestor to answer
  again. Return the question first; further discussion needs a new turn.
  This trades arbitrary nested dialogue for terminating deliveries.
- Service checks establish persistence and framing; controlled managed
  Codex transport and real Autohand/fantail runs add separate evidence. They
  do not establish that every offered model will choose the same tool.
