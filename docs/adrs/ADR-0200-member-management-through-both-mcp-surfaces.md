# ADR-0200: Persist member management through the shared MCP routes

Date: 2026-11-12
Status: Implemented; release delivery pending review

## Context and evidence

The operator MCP advertised `create_member` but always returned
`not_available_from_bridge`. Managed agents could edit their own profiles,
write scoped memories and schedule their own work. Other member creation
was a proposal for the person to import. Those were different capabilities,
not a complete agent-management interface.

The owned registry introduced in ADR-0193 supplies a canonical member store
independent of the browser. Existing operator routes already validate profile
revisions, catalog skills and routines. Reusing them avoids a second set of
agent records or a Claude/Codex process being mistaken for a saved Squad member.

The actual operator stdio check passes 237 assertions after replacing the
creation-placeholder expectation with persisted creation and retry checks.
The real managed stdio test performs nine member-management calls: creation,
the same creation again, profile/skill/memory editing, profile retrieval,
routine creation/update and listing. The retry returns the same ID without
creating another member. Separate acceptance checks cover saved Block, Ask and
Allow rules, workspace overrides, ended turns, revocation before writes and
expired consent. The production browser check observes the new member and a
live rename in the existing Backups roster, restarts browser/service, then
reads the same saved responsibilities and exact profile memory.

## Decision

Make operator `create_member` real, requiring a stable `request_id`, name and
role. Save into the current owner/dataset registry using an atomic creation
fingerprint. A matching retry returns the existing record, preserving later
edits; a conflicting request or removed record is refused. Creation markers
survive ordinary profile updates. Apply the existing collision-name rule.

Expose managed creation, target profile reading/editing, skill assignment,
profile-memory replacement and routine listing/creation/editing through the
same operator routes. The active turn binds the acting member and owner.
Current saved tool rules and workspace overrides are checked around transport.
Ask uses the existing question card for that exact operation, with a 15-second
expiry; Block refuses; Allow permits it. The engine lets these gated requests
reach Squad so permission is not asked twice. A stopped turn or a changed
policy cannot reuse an earlier unchecked operation.

Bound the complete management operation to 24 seconds, including consent and
all profile/routine reads before a write. Per-request eight-second limits alone
could add up beyond Autohand's 30-second MCP deadline after a 15-second consent
wait. Propagate the shared deadline into transport and check it before later
writes; a timed-out read must not proceed to mutation. A lost write acknowledgement
still requires inspecting the saved record rather than claiming a rollback.

Creation saves restrictive execution permissions and starts no work. Managed
creation inherits an assigned work folder, or saves without one when the actor
has none; an unassigned runtime fallback is not an access grant. An explicitly
named folder must already belong to the actor. Routine folder changes use a folder assigned to
their target. Operator clients retain their existing explicit folder authority.
No default folder, Git repository, credential or arbitrary executable is created
or supplied by this tool. A selected engine must exist in the harness catalog;
skill package IDs are validated and assignment is not installation proof.

Treat `responsibilities` as an alias of the existing description, rejecting
ambiguous requests that specify both. `set_member_memories` replaces only the
profile's saved texts, with a revision check and the existing secret-text
validator. Shared/project memory, collected files and conversations retain
their existing independent contracts.

Advertise MCP tool-contract version `2.0.0` on both initialize responses. The
app release number and portable schema version are separate contracts.

## Consequences

- Clients can build and manage real saved specialists without importing a
  proposed team or relying on a particular engine's in-process team feature.
- Default Ask requires an observed person. Unattended management needs an
  explicit saved Allow rule; a timeout performs no mutation. The short consent
  window fits the smallest supported transport and can require a retry.
- A complete specialist setup is several independently acknowledged operations,
  not a transaction spanning registry, skills and scheduler. Partial progress
  remains saved and visible; callers must inspect receipts before retrying.
- Creation's idempotency is scoped to the selected dataset. Restore creates a
  new dataset and invalidates the old client's context instead of replaying it.
- This does not install a release, broaden OS permissions, create an agent's
  external credentials or implement the separately requested group-chat lifecycle.
