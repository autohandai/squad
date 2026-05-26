# Goal 01: Agent Mission Control

## Outcome

Create a command-center view for operating the whole squad: every member, current task, repository, run state, blocker, last evidence, and next action.

## Why This Matters

The app should feel like managing an AI software team, not opening disconnected chats. Mission Control becomes the operational source of truth for who is doing what and whether the work is trustworthy.

## Scope

- Show each squad member with role, workspace, status, current run, and active task.
- Show blockers and unresolved risks near the relevant task.
- Show last evidence collected: command, file change, screenshot, test result, or review note.
- Show the next action: continue, review, replay, hand off, approve, or archive.
- Add sidebar counts for Tasks, Memory pending, and Permission warnings.

## Acceptance Criteria

- A user can see all active and recent squad work without opening individual chats.
- Each row links to the relevant member profile, task record, run output, and workspace.
- Running, blocked, failed, and completed states are visually distinct.
- The view has empty, loading, failed, and no-runtime states.
- The view works on desktop and mobile without clipping task names or evidence labels.

## Evidence To Capture

- Screenshot of the dashboard with at least one running, blocked, failed, and completed item.
- Example state matrix showing how each status maps to UI treatment.
- Manual validation notes for navigation into task detail and member profile.

## Dependencies

- Task Evidence Timeline
- Permission Ladder
- Memory Inbox
- Existing run/task state in the local bridge

## Decisions

- Route: make Mission Control a top-level operating route, not a member-profile subpage. It can become the default post-launch home once the dashboard is useful, while member home remains focused on one agent.
- Completed work: keep completed work visible in recent activity, then collapse it into an archive after a default retention window. Users should still be able to pin or dismiss important completed records.
- State ownership: the daemon/local bridge should persist durable run and task events, timestamps, logs, blockers, and final statuses. The UI should compute derived rollups such as sidebar counts, "next action", grouped status, and dashboard filters from that persisted source.
