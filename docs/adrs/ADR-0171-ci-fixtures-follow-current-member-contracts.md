# ADR-0171: Keep CI fixtures isolated and faithful to current member contracts

Date: 2026-11-03. Status: Accepted.

## Context and evidence

After the update change passed all 12 hosted CI jobs at `e9ffefd`, the complete
local audit still failed three checks. Each was rerun independently before
changing it: `check:member-profiles`, `check:agent-channel-actions`, and
`check:member-by-chat:browser`.

The profile check edited a copied skill after its complete-package revision
had been pinned, then expected those different bytes to restore. Preserving
frontmatter did not fix it: the package revision still changed. It also expected
the older unavailable-skill prompt, instead of ADR-0157's bounded count and
explicit instruction not to claim those skills loaded.

The channel check's controlled SDK matched the first `REQUEST:` anywhere in
its prompt. The real bridge now includes recent squad context, which contained
an older, truncated `REQUEST:` from the preceding allowed-channel case. That
produced invalid JSON before the blocked-permission path could be exercised.
Once fixed, the check reached its removed-member scenario: the current handoff
guard refused the request before calling the engine, while the test expected
a receipt from a turn that should never execute.

The browser's blank-member creation used the packaged bridge's personal default
workspace. On this machine that was a legacy Documents symlink, which the
skill identity reader correctly refused. It therefore timed out waiting for a
member to be saved. This was dependence on the person's filesystem, not a
reason to increase the timeout or relax workspace validation.

## Decision

Author the fixture skill before its first snapshot, then assert byte-for-byte
restoration and unchanged revision after deselecting/reselecting it. Check the
structured failed skill identity and the current bounded warning independently.

The controlled SDK reads the last complete request line, anchored at the start
of a line, so quoted history cannot supply its next action. A removed-member
case verifies the visible pre-handoff refusal and zero additional engine calls,
as well as the absence of a created channel.

The browser supplies only its known checkout as `defaultWorkspace` in the real
runtime response. All other runtime fields, provisioning, channel access,
engine execution and profile receipts remain real. Add these three checks to
both hosted CI and release gates after building the browser assets.

## Consequences and limits

- These changes repair fixture inputs and expectations; production permission,
  immutable-revision and workspace checks are unchanged.
- The browser scenario no longer tests personal default-workspace discovery.
  It proves member creation and shaping in its explicitly selected checkout.
- The controlled engines do not prove live vendor execution. The update
  Playwright cases and native installation evidence retain their own boundaries.
- Hosted runs must pass on the new source before claiming these added gates
  green. Passing the previous 12-job run does not prove the added checks.
