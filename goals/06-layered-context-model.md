# Goal 06: Layered Context Model

## Outcome

Assemble agent input from explicit, inspectable layers so users can see what the agent knew before it acted.

## Context Layers

1. System contract
2. Team operating rules
3. Agent role profile
4. Project memory
5. Task-specific context pack
6. Current user request
7. Tool/result transcript

## Why This Matters

LLM quality depends on context. Layering makes the prompt easier to debug, evaluate, and improve without mixing durable rules with task-specific evidence.

## Scope

- Define a context assembly contract with named layers.
- Show the layers before or after a run.
- Keep role profile, project memory, task context, and user request separable.
- Record which layers were included in each run.
- Avoid hidden assumptions by making omissions visible.

## Acceptance Criteria

- Every run records its ordered context layers.
- Users can inspect included layers from a run detail view.
- Context layers can be summarized without losing their source links.
- Layer assembly works for chat, prompt, auto, and goal modes.
- Unsupported or missing layers are shown as absent rather than silently skipped.

## Evidence To Capture

- Screenshot of a context layer inspector.
- Example run payload showing ordered layers.
- Example omitted layer with explanation.

## Dependencies

- Role Depth Brain Cards
- Memory Inbox
- Context Packs
- Existing launch payload construction

## Decisions

- Persistence: persist the effective run context manifest, layer order, source references, app version, and snapshots or hashes for mutable layers such as role profile, project memory, context pack, user request, and transcript. Reconstruct static product layers such as system contract and default team rules from versioned app code when possible.
- Editing: users can edit task-specific layers before launch, including the current request, context pack inclusions, and selected memories. System contract and team operating rules are read-only in normal use. Role profiles and memory should be edited through their dedicated settings/inbox flows.
- Export evidence: include the context layer manifest and summaries in task evidence exports. Full raw layer content should be opt-in when it may include private workspace data.
