# ADR-0172: Preserve saved workspace aliases across upgrades

Date: 2026-11-04
Status: Accepted

## Context and evidence

The native release preflight found that saved project locators can be symbolic
links to another folder inside the user's home. The workspace picker admitted
these paths, but the new skill identity reader refused a symbolic-link root.
An isolated bridge reproduced the resulting regression: provisioning an
existing in-home alias returned HTTP 400, "The skill workspace is unavailable".
This was a product compatibility failure, separate from the earlier test
fixture's dependency on a particular machine's workspace (ADR-0171).

A read-only pass over the backed-up 18 saved profiles found 16 existing
workspace folders accepted by the corrected resolver and two previously
missing folders. No existing folder was rejected, moved, or recreated. Thirteen
profiles use an alias locator. The pass called `canonicalWorkspaceRoot` and
the read-only skill identity reader; it did not run a member or write an
identity into a user's project.

## Decision

Retain the saved locator in project assignments and permission override keys.
Resolve a workspace to its physical directory before reading or creating its
skill identity. Both the selected directory and its physical target must be
inside the user's home; the home itself remains blocked. Check physical
containment even when only an ancestor is a link.

Keep skill package and package-resource symlink rejection unchanged. A user's
workspace alias and a skill package claiming authority are different trust
boundaries. Two locators for one physical workspace share its identity and
skill authority without rewriting the member's saved choices.

`check:workspace-aliases` exercises the real bridge with a controlled SDK. It
provisions and runs an aliased workspace, verifies the installed skill,
identity, revision, saved locator and permission override, rejects an
outside-home ancestor alias without creating an identity, and still refuses
a symlinked skill package. It failed before the change and passes after it.
Run this check in the local aggregate, hosted CI and release gate.

Cancel release run 41715030042 before publication and preserve its immutable
`v0.1.17` tag at `15cfe4c`. Ship the compatibility fix with matching 0.1.18
versions through the normal release workflow. The installed app remains
0.1.16 until an actual published update is available.

## Consequences

- Saved in-home aliases remain usable without broadening package trust or
  changing permission keys.
- Aliases whose physical target is outside home are now explicitly rejected;
  lexical containment alone was insufficient. This intentionally does not
  introduce support for external workspace roots.
- Missing legacy folders remain missing. No migration guesses a replacement,
  recreates an old checkout, or edits a person's project assignments.
- Physical resolution adds filesystem reads. It is a preflight boundary, not
  an atomic filesystem capability; it does not eliminate races caused by
  another process replacing directories during execution.
- The regression uses an isolated SDK and proves bridge behavior, not a live
  provider reply or a completed native installation. Those release and native
  checks remain separate requirements.
