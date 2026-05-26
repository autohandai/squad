# Goal 07: Evaluation Hooks

## Outcome

Evaluate runs against trust checks: file citations, verification, scoped changes, user-facing evidence, and unsupported claims.

## Checks

- Did the agent cite files when making code claims?
- Did it run verification when verification was available?
- Did it change only intended files?
- Did it produce user-facing evidence?
- Did it avoid unsupported claims?

## Why This Matters

The app should not only launch agents. It should help users decide whether the result is credible.

## Scope

- Add evaluation hooks to completed runs.
- Show pass, fail, skipped, and unknown states.
- Attach failed checks to unresolved risk.
- Filter Mission Control by evaluation state.
- Keep evaluations explainable and source-backed.

## Acceptance Criteria

- Each completed run records evaluation results.
- Failed checks are visible on the task timeline and run summary.
- Skipped checks include a reason.
- Users can inspect the evidence behind a pass/fail state.
- Evaluation does not claim certainty when evidence is missing.

## Evidence To Capture

- Screenshot of a run with evaluation checks.
- Example failed unsupported-claim check.
- Example skipped verification check with reason.

## Dependencies

- Task Evidence Timeline
- File-change detection
- Run transcript parsing

## Decisions

- Check types: make citations, verification command presence, changed-file scope, status transitions, and artifact existence deterministic where possible. Use model-assisted judgment for unsupported claims, evidence adequacy, and whether the final answer matches the requested outcome, with visible rationale.
- Timing: run evaluation automatically when a run completes, then allow manual re-run after new evidence, changed settings, or user correction.
- Blocking behavior: low-trust results should block automatic completion, autonomous handoff, and recipe success. They should not block manual user action; instead they should require review or explicit override.
