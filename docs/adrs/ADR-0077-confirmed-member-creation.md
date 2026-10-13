# ADR-0077: Confirm every member creation and retain the unfinished draft

Status: accepted

## Context and evidence

FirstRun already awaited provisioning, but its alternate “Create someone else”
route and the normal New member form still used optimistic creation. The form
called `onCreate` without awaiting it; App published and navigated before the
bridge response. This was a second entry into the same failing creation seam,
not a missing onboarding wizard.

`node scripts/check-member-creation.mjs` initially failed three real-browser
cases. An injected provisioning 503 navigated away and published the member;
three rapid submissions produced three requests; alternate first-run creation
left setup active while navigating to the unprepared member. The original
red observations are in `.codex-artifacts/reliability/member-creation-red.log`.
The checks use the real bridge and provisioning with controlled skills/runtime.

## Decision

All creation paths await the bridge before publishing a member or navigating.
The form prevents simultaneous submissions, disables editing during preparation,
and displays preparation or storage errors inline. Empty required fields cannot
start preparation. Keep the existing role picker, handwritten templates,
designer, profile controls and shadcn primitives.

Keep an unfinished form draft and its stable member ID in a versioned local
storage entry scoped to the chosen folder. Retain role, name, instructions,
brain, persona, skills and harness across refresh and retry. Restoring a draft
must not reapply a role template over authored changes. Save the preparing state
before dispatch; a refreshed pending attempt explains the interruption. Reuse
the ID when a successful bridge response was lost rather than create a second
member. Clear the draft on confirmed success or explicit Cancel; never reuse
an already published member's cached creation identity.

The alternate first-run route records completion only after provisioning and
opens the normal conversation with a role-specific first prompt drafted, using
the same completion boundary as suggested-role setup.

## Consequences and limits

Preparation feels synchronous: the member appears only when its runtime files
are ready. Partial skill installation remains disclosed through the existing
installed/unavailable status; provisioning is not proof of a provider reply.
Drafts contain authored profile content in the existing device-local browser
storage, survive until Cancel or success, and have no new retention policy.
Storage failure warns the person to keep the page open; it cannot promise
refresh recovery. Independent windows do not merge edits to the same draft.

Stable provisioning identity prevents another member after retry; it does not
promise a filesystem transaction across every skill and profile file. Config
failure preservation is recorded in ADR-0076. No native packaging or new-account
login change is implied by these browser checks.
