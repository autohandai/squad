# Goal 11: Skill Health Panel

## Outcome

Show installed skills as operational capabilities with usage count, last success, stale status, required tools, and conflicts.

## Why This Matters

Skills should feel like working capabilities, not static tags. Users need to know whether a skill is installed, usable, stale, or blocked by missing tools.

## Scope

- Add a skill health view per agent.
- Show install state, usage count, last success, stale status, required tool availability, and conflicts.
- Warn during agent creation when selected skills require unavailable tools.
- Surface skill health before launching a run.
- Link skill failures to task evidence when relevant.

## Acceptance Criteria

- Every skill row shows current health.
- Missing MCP/tool dependencies are visible.
- Conflicts are shown with a concise explanation.
- Skill usage updates after a run uses that skill.
- Stale skills are visually distinct from healthy skills.

## Evidence To Capture

- Screenshot of skill health table.
- Example unavailable tool warning.
- Example stale or failed skill state.

## Dependencies

- Current skill install results
- Tool/MCP availability checks
- Run transcript or launch metadata

## Decisions

- Usage detection: start with explicit launch metadata, recipe requirements, selected profile skills, skill install records, and transcript markers. Longer term, the CLI should emit `skill.used` events so the panel is not forced to infer usage from text.
- Staleness: a skill is stale when a newer registry version exists, required tools are unavailable, the last health check failed, the skill has not passed validation within the configured freshness window, or its install source cannot be resolved.
- Scope: provide both. A team-wide skill catalog shows aggregate availability and conflicts. Each agent profile shows install state, configuration, usage, last success, and health for that agent.
