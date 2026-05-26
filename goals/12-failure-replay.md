# Goal 12: Failure Replay

## Outcome

Make failed runs recoverable with "Replay with more context" and "Send to Debugger agent" actions.

## Why This Matters

LLM apps improve when failure is a first-class workflow. A failed run should become a useful starting point, not a dead end.

## Scope

- Add replay actions to failed run cards and task timelines.
- Replay can attach original prompt, logs, evidence, changed files, and a larger context pack.
- Send to Debugger agent creates a handoff with failure context.
- Link replay runs back to the original run.
- Show what changed between the original run and replay.

## Acceptance Criteria

- Failed runs expose replay actions.
- Replay preserves original context and logs.
- Users can choose more context or debugger handoff.
- Replayed runs are linked to the original failed run.
- Mission Control can group original and replay attempts.

## Evidence To Capture

- Screenshot of failed run replay actions.
- Linked original and replay run IDs.
- Debugger handoff showing failure context.

## Dependencies

- Task Evidence Timeline
- Context Packs
- Agent Handoffs
- Evaluation Hooks

## Decisions

- Default agent: first replay should default to the same agent with more context when the failure looks transient or under-contextualized. Route to a debugger agent by default after repeated failure, evaluation failure, tool/runtime failure, or unclear root cause.
- Permission changes: yes, replay requires approval when permissions, workspace scope, connector access, or autonomy level increase compared with the original run.
- Failure context size: include a structured failure summary, relevant final logs, key evidence, changed files, and links to raw artifacts. Do not dump full raw logs into the prompt by default. Context is too much when it crowds out source evidence, duplicates already summarized output, or includes secrets/noisy logs without clear relevance.
