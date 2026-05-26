# Goal 05: Task Evidence Timeline

## Outcome

Every task produces an auditable timeline: prompt, plan, commands, files changed, tests, screenshots, final result, and unresolved risk.

## Why This Matters

Trust comes from evidence. Users should not have to infer whether an agent inspected the right files, ran verification, or made unsupported claims.

## Scope

- Add typed timeline events for prompts, plans, commands, file reads, file edits, tests, screenshots, handoffs, approvals, and final summaries.
- Show raw command output and summarized evidence separately.
- Track unresolved risks as first-class timeline entries.
- Filter timeline by event type.
- Link timeline events to run logs and changed files.

## Acceptance Criteria

- Every Autohand run creates a task timeline.
- Final result separates confirmed evidence from unresolved risk.
- Users can open raw logs for command/test events.
- Screenshots and file changes appear as evidence events.
- Timeline survives navigation away from the conversation.

## Evidence To Capture

- Screenshot of a full timeline with command, file, test, screenshot, and final-result events.
- Example final summary with unresolved risk.
- Manual validation that timeline links open the correct run output.

## Dependencies

- Local run polling
- Run log storage
- File-change detection
- Screenshot capture path

## Decisions

- Event generation: both. The CLI or daemon should emit authoritative low-level run, command, file, and status events. The app should enrich them with UI events, screenshots, summaries, handoffs, approvals, and user-facing labels.
- Raw output retention: persist bounded raw logs locally per run, plus structured summaries for long-term scanning. Keep enough raw output to audit failures, but cap storage and avoid syncing raw logs without explicit user intent.
- File-read evidence: capture changed files exactly, and capture read-only file evidence as references or summaries when the agent cites files or relies on them. Do not record every incidental file read as a timeline event.
