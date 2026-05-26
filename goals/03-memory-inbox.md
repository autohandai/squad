# Goal 03: Memory Inbox

## Outcome

Create a review queue for proposed memories so the system learns curated, scoped, and source-backed facts instead of auto-saving everything.

## Why This Matters

LLM systems improve when memory is deliberate. Unreviewed memory can make agents overconfident, stale, or noisy.

## Scope

- Add a Memory Inbox surface for proposed memories.
- Each proposal includes source, confidence, scope, owner, and supporting evidence.
- Scopes include personal, project, and team.
- Actions include Accept, Edit, Reject, and Change scope.
- Accepted memories link back to the source conversation, task, or run.

## Acceptance Criteria

- Proposed memory is never silently promoted to durable memory.
- Users can accept, edit, reject, and rescope a memory item.
- Each accepted memory records source, confidence, timestamp, and scope.
- Rejected memories can be hidden but remain auditable for the current session.
- Mission Control shows a pending memory count.

## Evidence To Capture

- Screenshot of Memory Inbox with pending, accepted, and rejected proposals.
- Example accepted memory with source evidence.
- Example edited memory showing before and after content.

## Dependencies

- Task Evidence Timeline
- Agent profile memory storage
- Local persistence model

## Decisions

- Confidence: use a hybrid model. The agent proposes confidence with a short rationale, the app applies rule-based floors or warnings based on source quality, and the user can override during review.
- Rejected memories: persist lightweight local audit records for rejected proposals, including source, timestamp, scope, and reason when provided. Keep them out of active memory and provide a purge path.
- Project memory storage: store project-scoped memory in local Squad/daemon state keyed by the normalized workspace or repo identity. Mirror accepted relevant memory into agent launch context as needed. Do not write memory into the repository by default unless the user explicitly exports it.
