# ADR-0169: Project every committed member-profile field

Date: 2026-11-03. Status: Accepted.

## Evidence and correction

Hosted CI run 41590739539 failed `member tool receipt updates the editor`.
The bridge recorded revision 6 with fallback `codex-second`, while the window
held revision 6 with older `codex-recovery` and `claude-fixture` fallbacks.
The tool call and run had completed successfully. Increasing the wait could
not repair two inconsistent copies at the same revision.

The initial local suite, and a sixfold CPU-throttled replay, passed because
a roster refresh could arrive before the receipt. The receipt path called
`profilePatchFor`, which is a profile-form projection: it derives identity
files but omits model routing. It then stamped the receipt revision onto
that incomplete projection. `mergeMemberProfile` correctly refused to merge
the same revision later, leaving stale models permanently visible.

The regression now holds only the browser's roster responses at their prior
snapshot while a real bridge tool turn commits the routing change. Before
the fix it deterministically failed `committed receipt projects the fallback
model before a roster refresh`; the bridge still held the correct value.

## Decision and consequences

Use the form helper for derived identity fields, then project every explicitly
supplied `MEMBER_PROFILE_FIELDS` value from the validated bridge receipt.
Retain revision guards, so older receipts cannot overwrite later user edits.
This fixes the field-loss cause rather than making channel polling faster
or weakening the same-revision guard.

Explicit committed values win over form-derived values; omitted values keep
their existing form derivation. Legacy unversioned receipts retain their
existing write-through behavior. Cross-window data can still arrive later,
but a receipt no longer depends on a particular polling order to be complete.
The browser regression uses a fixture engine and real bridge, not vendor
inference or a native install.

The aggregate check also found `check:always-on` still asserting an older
approval-first schedule prompt with two examples. ADR-0138 already specifies
that requested work creates an automation and unsolicited suggestions stay
proposals. Update those stale prompt assertions to that standing contract;
the routine/always-on bridge behavior remains tested, not changed here.
