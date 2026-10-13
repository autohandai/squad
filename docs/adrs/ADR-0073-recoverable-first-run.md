# ADR-0073: Keep first-run setup recoverable until provisioning succeeds

Status: accepted

## Context and evidence

ADR-0013 already defines the three-moment FirstRun surface. The reliability
investigation found defects in that flow, rather than evidence for replacing it.
`node scripts/check-onboarding-recovery.mjs` reproduced three failures against
disposable real bridge/browser state before this change:

- A nonexistent folder failed profiling but left Start enabled.
- Choosing a role and typing a name, then refreshing, lost both choices.
- A 503 injected only at `/api/agents/provision` did not reach the form. Setup
  recorded completion and navigated away before provisioning finished.

The causes were separate: Start checked only sign-in and name; the saved-state
normalizer discarded role/name; and `startFirstConversation` completed setup
before `createAgent`, whose optimistic publication and caught error concealed
failure. The initial hypothesis of a provider failure was insufficient: these
failures reproduce without executing a provider.

An additional focused regression (`--filter 'invalid saved'`) reproduced a
blank current moment when a saved role no longer existed: the step calculation
checked only a nonempty role ID, while the talk form required a valid template.
Unknown saved roles now return to selection with the edited name preserved;
invalid saved provisioning IDs are discarded rather than sent to the bridge.

## Decision

Preserve FirstRun and add backward-compatible saved fields for role, name,
whether the name was edited, and a stable member ID. Validate the chosen folder
with a bounded, cancellable profile request. Start requires successful folder
validation, account, runtime, provider, role, and name. Failed folder checks and
provisioning show their error in place with retry while preserving inputs.

The onboarding creation path waits for real provisioning before publishing the
member, completing setup, or navigating to its drafted first message. Retries
reuse the saved ID and isolated runtime directory; a synchronous submission
guard prevents rapid duplicate starts. Provisioning has a two-minute client
deadline, with an actionable retry if it expires. The general member-creation
path retains its existing optimistic behavior for now; changing it is a separate
decision and requires its own error-flow verification.

## Consequences and limits

Legacy completed/skipped state remains compatible. Progress remains local to
this installation, not an account-wide draft. A lost acknowledgement may leave
a runtime directory without a published member; retry reconciles using the same
ID. Aborting the client request does not roll back server-side provisioning.
Skill installation can produce a partial result, which stays visible on the
member's Skills page; it is not represented as complete skill availability.
Passing these failure checks proves setup recovery, not a successful provider
session. Clean setup through execution remains a separate acceptance gate in
the reliability report. No server or provider failures are converted to success.

## Verification

The regression script keeps the three original failure assertions and is
expanded alongside implementation for retry, prerequisite, successful
provisioning, and refresh coverage. Actual command results are recorded in
`docs/reports/squad-reliability.md`; pending checks are not passing evidence.

The former source/browser verifiers still targeted the retired checklist and
account-menu placement. Their account gating, root routing, skip persistence,
resumption and provider navigation checks now exercise FirstRun and Settings.
Signed-out direct product URLs retain their path but render SignInGate with no
product controls; the test verifies that gate rather than requiring a redirect
that the current authentication implementation does not perform. The initial
assumption that all protected URLs redirected was corrected after running the
real bridge/browser check. This does not relax authentication or change it.
