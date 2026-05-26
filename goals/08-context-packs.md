# Goal 08: Context Packs

## Outcome

Before an agent starts, build a compact context pack with the repo summary, relevant files, recent diffs, prior failures, user preferences, active route, and screenshots.

## Why This Matters

Good context reduces hallucination and repeated discovery. It also gives the user a concrete preview of what the agent is starting from.

## Scope

- Generate a context pack before a run starts.
- Include selected files, recent diffs, prior failures, preferences, active route, and screenshots when available.
- Show what was included and what was omitted.
- Link context pack items back to their source.
- Reference the pack in the run timeline.

## Acceptance Criteria

- A run can be launched with a generated context pack.
- Users can inspect the pack before or after launch.
- Large packs are summarized but source links remain available.
- The pack is scoped to the selected workspace.
- The agent launch transcript names the context pack used.

## Evidence To Capture

- Screenshot of context pack preview.
- Example pack with included and omitted sections.
- Run transcript showing the pack reference.

## Dependencies

- Layered Context Model
- Workspace detection
- Diff and file scanning
- Screenshot capture

## Decisions

- Generation: generate context packs automatically for explicit Autohand runs, recipes, handoffs, and replays. For lightweight chat, generate a smaller pack only when the request clearly needs workspace context or when the user opts in.
- Size limits: keep the model-facing pack compact with a soft budget around 20k tokens, per-file excerpts instead of whole large files, summarized diffs, and source links for overflow. The stored manifest can keep richer metadata than the model prompt.
- Pinned items: allow users to pin files, routes, memories, screenshots, or prior failures per project and agent. Pinned items should bypass ranking but still count against the final context budget.
