# Goal 10: Agent Handoffs

## Outcome

Let one squad member pass work to another with preserved context, evidence, and expected output.

## Example Flow

QA finds a bug -> Frontend fixes it -> Reviewer reviews the diff -> DevOps validates the build.

## Why This Matters

The product becomes more than a single LLM interface when collaboration is structured. Handoffs let specialized roles do focused work without losing the trail.

## Scope

- Add a handoff action to tasks and failed/reviewable runs.
- Support `@` mentions in chat for handing off tasks or sessions to another online squad member.
- Capture next agent, reason, required context, expected output, and source evidence.
- Preserve the prior task timeline.
- Show ownership changes in Mission Control.
- Support recommended next agents.
- Let global settings control how failed handoffs retry.

## Acceptance Criteria

- A task can be handed from one agent to another.
- A chat mention can create a handoff to the mentioned squad member without starting a separate parent task.
- Handoff events appear in the task timeline.
- The receiving agent gets the relevant context and evidence.
- Mission Control shows current owner and blocked handoffs.
- Users can cancel or reroute a pending handoff.
- Failed handoff retry behavior follows the global policy from Settings or `AUTOHAND_SQUAD_HANDOFF_RETRY_MODE`.

## Evidence To Capture

- Screenshot of a QA to Frontend to Reviewer handoff chain.
- Timeline entry showing ownership change.
- Receiving-agent launch context with preserved evidence.

## Dependencies

- Task Evidence Timeline
- Context Packs
- Role Depth Brain Cards
- Mission Control

## Decisions

- Task model: continue the same parent task and create child assignments or runs for each agent. This keeps one evidence timeline while still showing ownership changes.
- Recommendations: agents may recommend handoffs automatically as proposals with reason, target role, required context, and expected output. User confirmation is not required by default; confirmation can be layered in later through a saved recipe, automation policy, or role-specific approval rule.
- Retry model: failed handoffs retry from the failed handoff checkpoint with the same preserved context, plus the failure reason, when the global retry policy is `checkpoint`. The global policy is configurable through `AUTOHAND_SQUAD_HANDOFF_RETRY_MODE` and the Web UI Settings sheet. Users can reroute to another agent or add context before retrying. Each attempt stays linked in the same parent task timeline.

## Configuration

- `checkpoint`: retry failed handoffs from the failed checkpoint with preserved context and failure reason.
- `manual`: keep the failed checkpoint but wait for a user to reroute, add context, or restart the retry.
- `disabled`: leave failed handoffs failed until a new handoff is created.
