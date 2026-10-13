# ADR-0076: Preserve member profiles and load them in the runtime

Status: accepted

## Context and evidence

The reported absence of personalities initially suggested missing templates.
The existing catalog already defines sixteen roles, brain cards, personas and
default skills. The defect was between those definitions and execution.

`node scripts/check-member-profiles.mjs` reproduced three failures before the
fix: warming without an `agent` object replaced a custom role with an empty
role, a built-in frontend member acquired a generic purpose, and an agent-only
chat after restart lost the saved role. The browser supplied rich context, but
API callers and resumed sessions depended on absent browser fields. The older
warm permission regression protected config permissions, not profile contents.

Two additional regressions failed: deselecting a skill left its `SKILL.md`
discoverable, and warming a saved Codex member launched the Autohand SDK.
These were capability and harness-routing defects, not missing UI controls.

## Decision

Share the existing role definitions in `src/lib/member-profiles.js`; keep
`src/data.js` exports compatible. The bridge can import this module in the
existing portable package, which already includes `src/lib`. Fill absent
built-in defaults only. Preserve custom instructions, brain-card fields,
authored personas and explicit empty skill selections.

Load the saved profile before warm, chat and run routing. Serialize profile
and config preparation per member and atomically write their JSON records. A
damaged profile fails visibly without being replaced. Persist authored profile
content, and hydrate older profile documents from their own member directory.

Build the actual SDK, CLI and external-harness system context from the resolved
profile: identity, purpose, communication/review style, instructions, persona,
assigned workspace, profile paths, memory rules, installed skills, unavailable
skills, permissions, escalation and collaboration. Browser conversation context
is additional context rather than the sole source of personality. Warm calls
use the same member and stable conversation context as the first DM turn.
Agent-only calls retain the saved harness. External harness warm requests return
their identity without starting an Autohand session.

Remove deselected skills from the runtime's discovery directory by moving them
outside the member home into a per-member retained-skills directory. Restore
them when selected again; never delete authored skill content. Existing selected
skills remain usable when the registry is unavailable. Report installation
failures as unavailable instead of claiming their capabilities.

## Consequences and knowingly deferred work

The sixteen existing profiles remain one catalog, with no new role inventory or
personality editor. Defaults do not replace intentional customizations. A role
contract affects model instructions; it cannot guarantee model compliance.
Tool policies and the existing adapters remain the enforcement boundary.
Changing a skill selection cannot undo a tool's previous side effects.

Retained skill directories consume disk space until an explicit retention
policy is added. A conflicting retained copy fails instead of overwriting it.
Profile preparation is serialized in one bridge process, not locked across
independent processes sharing a state directory. Existing config-error handling
is now validated before profile preparation as described below. No native
release is implied.

## Verification and limits

The controlled SDK regression now passes six cases, including actual runtime
configuration for all sixteen roles, custom warm/restart preservation,
skill revocation/restoration, missing skills and damaged state, and a saved
Codex turn that executes a channel action through the external adapter. This
captures adapter inputs and real persistence; it does not contact a provider.
Existing permission, roster, prompt-stability, bridge-import and agent-channel
regressions also pass.

The first real-provider attempt completed Frontend Developer, then its
non-streaming QA request hit the HTTP headers timeout. SDK `timeoutMs` is an
inactivity window, deliberately reset by events; this was not proof of a
120-second total runtime limit failing. The explicit live check now uses the
normal streamed chat transport, records results incrementally, and has a
bounded observation deadline. Current outcomes and broader proof boundaries
belong in `docs/reports/squad-reliability.md`; live checks require credentials
and are intentionally separate from CI.

The focused QA retry passed the unchanged role/marker/memory/escalation checks.
Its saved-policy follow-up produced no file and reported the unavailable write
tool, without a write-call event in its trace. This distinguishes compliance and
configured exclusions from an observed runtime denial event. The clean live
Full Stack Developer onboarding purpose additionally activated installed
`testing-strategies` through the `skill` tool and read the assigned README.
The original failed observations remain in the report. All sixteen roles have
controlled runtime coverage; these three roles have provider observations.

## Config failure correction

The next focused reproduction confirmed a related false-success path:
malformed config JSON and a config path that was a directory both returned
successful provisioning while replacing authored personality files. The broad
config catch deferred errors to a later runtime that might never start.

Read existing member config, or missing-config user defaults, strictly before
skill installation or profile writes. Require a JSON object; preserve damaged
bytes and return an actionable error. Plan profile documents in memory and
write the runtime config before replacing authored documents. Propagate config
write failures instead of continuing. Keep unrelated valid config fields and
the existing permission-preservation rule for calls without member details.

`node scripts/check-member-config.mjs` passes seven real-bridge checks:
malformed JSON, null, array, string, unreadable path, actual directory-permission
write failure with recovery, and a valid custom-config permission update. Failed
config preparation preserves the confirmed profile, persona and config bytes.
The positive fixture initially expected excluded tools to be strings; the
actual contract is `{ kind }`, so the assertion was corrected to that contract.
That fixture mismatch was not another product defect.

These files remain individually atomic where JSON uses the persistence helper;
the complete config/profile/skill set is not one filesystem transaction. A
later profile-file error can leave an updated config and must still report
failure. Crash-wide rollback and cross-process locking remain deferred.
