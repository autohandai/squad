# ADR-0206: One member Computer Use switch, backed by native consent

## Context and evidence

The owner requested a per-agent Computer Use on/off control alongside ordered
engine fallbacks, including disabling Computer Use instructions. Existing
Permissions offered Observe/Control/Revoke but Model settings had no switch.
An owned browser check first failed to find it. The real HTTP/mock-harness
check also demonstrated that revoking tools still supplied the old “Squad
has built-in Computer Use” instruction on later work.

Team isolation required a correction too. Team datasets are shared across
human actors; their old `computer-use-grants.json` did not identify who gave
consent. An actual broker-worker test reproduced an unattributed Control
grant appearing for the next actor. It now covers Alice/Bob/Alice preferences,
feeds and separate confirmed grant scopes, preserving the original file bytes.

## Decision

Use the existing grant as the sole enabled state. Model settings and
Permissions compose the same control and change function. On invokes native
confirmation for Control; Observe remains available in Permissions. Only an
acknowledged grant changes the UI. Cancellation/failure retains the saved
state, errors remain readable and Retry is the same explicit toggle action.

Off revokes the grant through the existing service. It stops recording,
existing connected tools recheck scope, and later work receives neither its
MCP server nor Computer Use instructions. Work preparation now reads through
the service rather than hard-coding a second grant-file path. Model fallback
does not change the saved grant or expand permissions.

Personal datasets retain their existing file. Team datasets use the existing
verified actor-key digest (issuer plus immutable subject) in the filename.
Old unattributed team grants are preserved but not assigned to a new actor.
Native and OS consent remain separate; neither a browser nor managed agent
can self-grant. An operator may read or revoke through the new 2.3.0 MCP tools.

## Consequences and limits

There is no competing profile enabled flag to drift from native permissions.
Turning off also removes the old hint asking an agent to request access, as
the owner explicitly requested instruction disablement. Historical chat can
still mention earlier Computer Use, and already issued native actions cannot
be undone; per-call checks prevent subsequent actions after revocation.

Team grants without human attribution require new confirmation after upgrade.
This deliberate permission reset preserves the old file but adds no recovery
UI or automatic import. Evidence remains part of the selected Squad's work;
grant isolation does not invent a separate history or delete old screenshots.

The compact Model row polls readiness only while mounted, using the existing
permission controller. Advanced OS setup stays in Permissions. No extra
provider prompts, OS grant, paid fallback, installed-app replacement or
automatic client tool refresh is introduced.

Evidence lives at public owned HTTP/MCP/browser seams: native dialog and OS
readiness are simulated, the grant persistence and broker workers are real.
The controlled harness observes actual launch configuration and instructions.
Native UI, live provider and signed release acceptance remain separate.

Review found a same-member status race: a pre-revoke read could arrive after
the successful revoke and reset the displayed switch. A rendered regression
holds that earlier response until Off is acknowledged, then releases it.
Refresh requests now carry a sequence; starting a change retires older reads
and stale failures as well as stale success responses. Each member's control
also has its own React identity when changing the selected member.
