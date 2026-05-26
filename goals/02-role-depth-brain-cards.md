# Goal 02: Role Depth Brain Cards

## Outcome

Replace shallow role labels with configurable brain cards that define how each squad member thinks, works, escalates, reviews, and remembers.

## Brain Card Fields

- Purpose
- Default workflow
- Allowed tools
- Escalation rules
- Definition of done
- Review style
- Memory policy

## Why This Matters

Agents feel useful when their behavior is configured, inspectable, and repeatable. A role name alone does not tell the model or the user what standards the agent should follow.

## Scope

- Add a structured brain-card model to each agent profile.
- Render the brain card on the member profile.
- Include brain-card fields in the profile context passed into Autohand.
- Support a compact agent ID card that can be shared or exported.
- Add "why this agent?" recommendation text when selecting a squad member for a task.

## Acceptance Criteria

- Every built-in role has a complete default brain card.
- Custom roles can define or edit every brain-card field.
- Launch context includes the relevant brain-card fields.
- Users can inspect the active brain card before launching a run.
- The generated profile files stay readable and scoped.

## Evidence To Capture

- Screenshot of a member profile with the brain card expanded.
- Sample generated profile Markdown for one built-in role and one custom role.
- Run transcript showing brain-card context included in the launch payload.

## Dependencies

- Current role templates
- Agent profile file generation
- Context pack or launch context assembly

## Decisions

- Storage: use both structured JSON and generated Markdown. JSON is the source of truth for the app, daemon, validation, and editing. Markdown is generated for agent profile context and human review.
- Memory policy: enforce it in the app for save, scope, promotion, and rejection decisions, and also express it to the agent so the model proposes memory in the right shape. The agent should not directly promote durable memory.
- Exported ID cards: include a permission summary, capability level, tool categories, connector readiness, and memory policy. Do not include secrets, raw config paths that are not useful to the recipient, or private local file contents.
