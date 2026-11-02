# ADR-0158: Learn versioned skills from independently verified outcomes

Status: Accepted · 3 November 2026

## Context and evidence

Current CLI activation events record succeeded, and capability scoring counts them as successful uses. This establishes activation, not user-task success. Research also documents no-op verification failures and learned procedures that do not transfer to held-out work. See the [learning evidence](../reports/skills-research-2026-11-02/learning.md).

## Decision

Keep load/application observations, verified outcomes, and demonstrated benefit distinct. Legacy activation counters remain labeled legacy observations. A verified nontrivial outcome may trigger one bounded extraction job when learning is enabled. Publish a versioned draft with lineage and evidence. Fresh-input independent checks can verify an exact revision for scope; predeclared held-out benefit can make it preferred for scope.

Persist the outcome before scheduling extraction. Deduplicate jobs by source outcome/revision and extractor version. Stage and atomically publish with compare-and-swap; never overwrite a user's intervening edit. The learner cannot weaken its independent approval checks. Preserve rollback and counterexamples.

## Tradeoffs and deliberate limits

Evidence requirements make promotion slower than saving every successful-looking trace, but prevent activation frequency from masquerading as usefulness. Local persistence does not imply local inference. Preserve existing learning preferences; add no implicit cloud work or sharing.

Learning does not automatically teach teammates, enroll cloud sync, or publish a registry package. Explicit teaching and sync continue through ADR-0139 and ADR-0152. A draft remains useful for deliberate inspection/invocation without earning an automatic ranking preference.

Details: [design](../superpowers/specs/2026-11-02-adaptive-skills-design.md), [evaluation](../superpowers/specs/2026-11-02-adaptive-skills-evaluation.md).

## Implementation boundary (3 November 2026)

The CLI adapter stores activation as an observation, separate from independently checked nontrivial outcomes. Its existing v1 memory wire format remains readable by older clients; new readers never award those records task-success credit. Automatic extraction is opt-in. Durable jobs publish private immutable drafts with lineage and compare-and-swap; exact independently maintained checks govern verification. A host must supply a predeclared held-out benefit evaluator before preference promotion succeeds; no built-in paid evaluator or demonstrated transfer is claimed. Project and user learning state, archived resources and revision stores are excluded from implicit sync. Squad's existing explicit teaching path remains separate.
