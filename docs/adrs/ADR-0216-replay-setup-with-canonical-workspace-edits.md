# ADR-0216: Replay setup by editing a saved member's work folders

## Context and evidence

The owner reported that Run the setup guide opened a saved-squad summary with a
missing folder, Retry and Open your squad. `FirstRun` treated a completed/existing
server receipt or completed/skipped browser state as `complete`, hid folder
selection/removal and disabled Start. Retrying the same missing path could not
repair it. Clearing the receipt would also risk another starter team.

The operator MCP could add/remove extra folders but could not change the primary.
`MEMBER_PROFILE_FIELDS` protected projects and other fields against stale windows,
but omitted workspace. The public profile preferred the most recent run's folder
over its saved default, so a new default could be reported incorrectly.

## Decision

Keep the first-install receipt immutable and idempotent. For an existing Squad,
reopen the editable guide using current member folders. Prefer the original local
coordinator or the sole local member; otherwise require selection. Missing folders
stay removable. Empty selection uses the existing consent flow before creating
`~/Documents/autohand-desktop/`. Initial creation still requires account, runtime
and provider readiness. Metadata-only repair does not require a ready model;
runtime preparation during review is an explicit action.

Save one member's primary and explicit complete additional-folder list through
`PATCH /api/control-plane/members/:id/workspace`. Validate all existing directories,
physical containment and limits before one revision-checked profile mutation.
Physical duplicates coalesce and existing project metadata follows the physical
folder. Workspace validation disables the existing managed-worker auto-creation
option: an existing legacy locator may normalize to a missing owned-worker path,
so checking the input path alone would not establish the no-creation contract.
The browser check also verifies that such a mapped path stays absent. No missing
directory is created by validation. Include workspace among
authoritative profile fields, and report the saved default before a recent run's
ad-hoc context. Other profiles and permissions remain intact; active work keeps
its captured context and later turns use the saved assignment.

Expose the same operation as operator `set_member_workspace` and managed
`squad_set_member_workspace`, with MCP contract 2.4. Additional folders must be
explicit, including an empty list to clear extras. Managed policy defaults to Ask;
all requested folders must already be assigned to both acting and target members,
even with Allow once or Allow mode. An actor with read-only folder access must not
be able to grant that folder to a more powerful coworker. An operator can make broader assignments within the
existing physical-home boundary. A remote binding refuses the edit on this
computer rather than saving local paths for another machine; registry errors
fail closed for this operation.

## Verification and what we learned

- `check:setup-guide:browser` passes at desktop and phone widths against a real
  owned bridge and production bundle. A saved member starts with a missing path;
  the guide removes it, waits for explicit Create folder consent, saves the
  replacement and reads it after reload. It verifies unchanged roster/channels,
  authored instructions, memories, skills, harness/fallbacks and permissions,
  no Git initialization, no engine prompt, and remote-computer refusal.
- The first browser failure after consent looked like broken folder access. The
  isolated macOS home used `/var`, while physical repository analysis returned
  `/private/var`. Canonicalizing the fixture's fake home fixed the mismatch;
  production home/private-data security checks were not weakened.
- `check:control-plane` passes 278 checks through actual stdio MCP, including the
  new operation, saved-primary reporting, stale revision refusal, missing and
  escaping-folder refusal without a revision change, and stale-window protection.
- The real managed stdio scenario also updates its saved child through the shared
  workspace route without launching a child engine. The management check verifies
  bounded consent and every additional folder's
  actor and recipient scope. The permission-policy check requires Ask at each supported rank.
- The shared fixture change also passes phone protocol/relay and desktop/phone
  pairing/queue checks; first-install state/provisioning checks remain separate.

## Consequences and limits

Review no longer provisions another Chief of Staff or recreates #general. A
removed coordinator is not resurrected, and an empty existing Squad must add a
member deliberately. An initial receipt remains historical, so it is not a
current workspace inventory; the guide reads canonical member state instead.
Replacing the complete list is more explicit than a partial patch and can revoke
extra-folder grants for later work. Stale writes require a reread and deliberate
retry rather than silently adopting a newer revision.

Remote folders must be chosen on the execution computer. Managed agents cannot
use this operation to grant themselves arbitrary home folders; the operator/app
owns that choice. MCP processes still require reconnecting to discover the new
catalog/version. These fixture/browser/stdio checks are not installed-client,
live-provider, physical-phone or notarized-release proof for contract 2.4.
