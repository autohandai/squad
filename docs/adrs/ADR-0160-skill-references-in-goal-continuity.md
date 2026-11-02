# ADR-0160: Restore goal checkpoints with pinned skill references

Status: Accepted · 3 November 2026

## Context and evidence

The user wants reusable skills and unfinished approved goals to survive sessions and crashes. Workspace relocation has disrupted absolute historical paths. ADR-0066 already makes the bridge-owned goal manager authoritative, pauses recovered goals, and requires explicit resume. ADR-0156 keeps original stores authoritative over rebuildable retrieval indexes.

## Decision

Extend existing checkpoints with compact approved intent, next step, check/artifact references, pinned skill identity/revision/resource references, and uncertain-effect state. Keep the library independent from conversations. Resolve current authorized locators at runtime, rather than copying all historical instructions into startup context.

Restore metadata in a paused state. Resume checks existing ownership/lease, workspace identity, current permissions/provider, checkpoint freshness, and exact skill availability. Missing revisions require an explicit replacement decision. Unknown external effects must be observed before retrying. An upgrade creates a new checkpoint without rewriting historical evidence.

## Tradeoffs and deliberate limits

Pins require retained revisions or an honest missing-reference state, but prevent silent procedural drift. Rehydrating complete transcripts would consume context and still not establish current ownership or authority.

There is no new global goal store, automatic post-crash execution, cross-engine permission-grant migration, or assumption that a memory summary can complete/resume a goal. Existing live-owner rejection and explicit teaching/sharing boundaries remain intact. Recovery must not manufacture a second learning outcome or replay side effects.

Details: [design](../superpowers/specs/2026-11-02-adaptive-skills-design.md), [evaluation](../superpowers/specs/2026-11-02-adaptive-skills-evaluation.md).

## Implementation boundary (3 November 2026)

Both adapters extend their existing goal stores rather than introducing another owner. The CLI pauses recovered owned goals before bootstrap, binds resumed workspaces without creating an identity, restores exact authorized archived packages, and validates required package revisions at each request. Checkpoints store a digest of current effective permissions, never historical grants. Resume establishes the currently permitted execution mode before preflight and rolls it back on refusal. Unknown external effects remain a blocking unknown. Older snapshots remain readable; older writers that do not preserve additive continuity fields cannot provide the new guarantees.
