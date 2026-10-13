# ADR-0071: Idle observation of assigned projects

Date: 2026-10-02
Status: Accepted

## Context and evidence

The user requested that idle members inspect their assigned project folders,
identify concrete software improvements and send a useful DM without waiting
for an explicit prompt. The existing chief-of-staff self-improvement loop is
browser-owned and proposes memory/skill changes from activity; it does not
observe project files. The bridge's web-status registry also drops project,
profile and harness configuration, so it cannot independently resume this
requested work when a browser closes.

An initial SDK assumption was corrected: the installed Autohand SDK 1.0.5 has
no Blueprint answer API. The vendored CLI 0.9.7 does expose answer-only RPC.
Running its actual binary with an isolated temporary configuration and only
`autohand.runtimeInspect` returned answerOnly=true, restricted permissions,
Blueprint context and disabled tools, hooks, MCP, memory and session
persistence. No answer or provider call was made in that probe. The empty
configuration reported unknown authentication; a signed-in selected provider
must still be configured before review.

Installed live observation later disproved an important assumption: the
tool-free runtime acknowledgement does **not** imply that Blueprint permits
the selected provider. Eva produced a notice, while Kai's hosted Autohand
review returned `inference_destination_blocked`. Reading the actual pinned
`cli-3` tag `v0.9.7`, `src/modes/rpc/blueprintAnswer.ts:863` shows a hard gate:
only `in_process` and `local_subprocess` destinations are accepted. Hosted,
opaque and even loopback `local_service` providers are rejected before
provider completion. Copying broader member permissions cannot authorize
this request, and selecting local Ollama/MLX is not a verified remedy.
The original isolated runtime probe checked tool isolation only; treating it
as provider compatibility was mistaken.

The normal RPC path in that tag constructs `AutohandAgent` and its ToolManager
(`src/modes/rpc/index.ts:482`,
`src/core/agent/AgentDependencyComposer.ts:1186`). Its restricted context still
allows read/git/meta tools. `src/core/toolFilter.ts:340` only applies an explicit
allowlist when nonempty; an empty list is not a deny-all configuration, and
blocked-tool checks are exact names rather than wildcard matches. No supported
normal hosted RPC/configuration path was found that also attests absent tools,
hooks, MCP, memory and session persistence. We therefore do not substitute a
direct provider request, weaken Blueprint policy or claim hosted model parity.

Local Codex help exposes ephemeral execution, read-only sandbox and ignored
user configuration under `exec --help`. Local Claude help exposes empty builtin
tools, safe mode, strict empty MCP configuration and disabled session
persistence. Claude safe mode retains account sign-in; bare mode can remove
OAuth/keychain discovery, so it is not the selected isolation mechanism.

## Decision

The local bridge owns a persistent project observer, independent of the
chief-of-staff loop. The main window registers full members, profiles,
assigned folders, selected harnesses and model assignments. Observation is
on by default for this explicitly requested product behavior and can be
switched off in Settings.

Only signed-in local members with an existing assigned project folder and no
break, offline status, foreground chat, busy SDK session, live run, running
goal, queued daemon job or pending browser task/handoff are eligible.
Foreground work interrupts an active observation for that member. Break,
sign-out and bridge shutdown stop active observation; no cached observation
configuration grants independent authority after sign-out.

Filesystem/git observations use bounded metadata and source excerpts, exclude
credential/generated paths and member-sensitive paths, and do not follow
nested symlinks. Git discovery reads at most 500 candidate files; the non-git
fallback additionally caps depth at four, directories at 100 and examined
entries at 5,000. Directory enumeration is streamed: a file-count limit alone
would still permit unbounded traversal of empty folders. Evidence declares
its actual discovery method and coverage limits.

Cheap scans run every 30 minutes, with debounced filesystem hints and a
periodic fallback. Only an initial or changed fingerprint can request a
provider review. Each member has at least a one-hour review cooldown, at most
four review attempts per UTC day, and the whole bridge has at most twelve.
There is one provider attempt per scheduler cycle, including failures.
Failures back off persistently; foreground cancellation still consumes the
attempt to avoid cancel/resume quota churn. Provider reviews have a bounded
timeout and do not share member conversation sessions.

Autohand uses a separate minimal configuration under the observer directory,
with the assigned provider/model and current authentication. It uses raw
Blueprint RPC and validates the actual tool-free runtime acknowledgement
and an accepted inference destination **before sending any excerpt**. Unsupported
destinations retain their error kind/retryability and show a concrete explanation
instead of entering repeated provider-failure backoff. For an unsupported
Autohand configuration, the same bounded, redacted local sample can identify
one meaningful TODO/FIXME comment or Markdown note. A generated member DM
quotes its actual file and line, explicitly calls it a **local check**, says it
is neither a verified defect nor model review, and asks the human to choose an
investigation. With no safe marker there is no DM. No snippet is sent to a
provider for this fallback. The observer remains visibly unsupported for model
review while local checks continue under the same eligibility, cooldown, daily
attempt caps and deduplication. Its unsupported capability and checked state
persist; changing the registered harness/model/profile invalidates the cached
capability. Moving an unchanged note does not repeat a suggestion.

The first installed upgrade exposed another gap: an existing observation had
already persisted the exact CLI error `Inference destination hosted is not
authorized for classified Ask evidence.` with a failure count and cooldown,
but no unsupported capability. Adding the new live classifier did not update
that old state. On load, only this exact denial for a registered Autohand
member is migrated to the current unsupported/local-marker classification.
The previous scan/review deadlines, attempt timestamps, daily quotas, notices
and dedupe keys remain intact. This neither retries inference nor authorizes
any destination. Other harnesses and other provider errors retain their
existing classification. Local checks become eligible when the existing
cooldown expires; the upgrade does not trigger an immediate suggestion burst.

Codex uses a fresh scratch working directory,
ephemeral read-only execution, ignored user configuration and no configured
MCP. Claude uses a fresh scratch directory, safe mode, no builtin tools,
strict empty MCP and no session persistence. Missing required safety flags or
an unsupported remote member remain visibly unsupported; the bridge never
silently changes harness or relaxes permissions. Observation never installs
skills or inherits Computer Use.

A strict structured response may name one opportunity with actual supplied
evidence IDs, a concise member-authored explanation and a next step for the
human to choose, or say that no useful opportunity was found. A TODO is a
lead, not proof of a defect. There is no freeform completion or defect
inference. Concrete opportunities are deduplicated across file changes and
service restarts, persisted with stable IDs, and imported into the member's
DM once. They carry suggested/observed status, never done. Subsequent
human-approved work uses the normal execution/goal lifecycle and reports its
actual done, partial or documentation-only outcome.

## Validation

`node scripts/check-project-observer.mjs` passed temporary real-file scans,
secret/symlink/sensitive-path exclusions, empty-directory bounds, evidence-ID
validation, eligibility, cooldown versus cheap scans, deduplication, persistent
budgets/backoff, interruption, one attempt per cycle and all three isolated
fake CLI transports.
Additional checks cover hosted/local-service/opaque/unknown runtime
acknowledgements never receiving `autohand.answer`, preserved RPC denial
kind/retryability, real local marker locations, non-comment identifiers and
secret markers remaining silent, unsupported status without failure backoff,
cached local-only checks, changed harness invalidation and restart deduplication.
The persisted-upgrade regression also passed: an old hosted denial is saved
as unsupported immediately, unchanged deadlines prevent an early scan, the
first eligible local check makes no review call, prior notice deduplication
and daily counts survive, and other-harness/other-error records remain intact.

`node scripts/check-project-observer-bridge.mjs` passed the actual HTTP bridge
with disposable state and fake CLI processes: route startup, sign-in/break,
pending handoff and daemon queue gates, assigned Autohand provider/model/auth,
separate restricted configuration without MCP, unchanged normal member
configuration, actual subprocess cancellation by foreground chat and restart
persistence. A hosted-destination fixture additionally produced an explicit
local-marker DM at its observed file/line, retained unsupported model-review
status after restart and never received an evidence-bearing answer RPC.
Native notifications were disabled in this fixture. These checks
establish controlled adapter and bridge behavior, not live provider quality,
computer permissions, installed observer behavior or OS notification delivery.

## Consequences

Observation uses provider quota, intentionally capped and disclosed. Bounded
samples can miss valid improvements; model claims remain suggestions supported
by excerpts rather than independent audits. The observer does not run tests,
web searches, fixes, memory writes or automatic handoffs. Permanent concrete
finding deduplication can suppress a worthwhile repeated suggestion; it is
preferred to recurring unsolicited DMs. History keeps the last 200 notices
and 2,000 dedupe keys, so deduplication is bounded rather than eternal.

A stale unfinished browser task or assignment is conservatively busy until
its state is cleared; observation must not assume that human work disappeared
when the browser disconnected. Remote-owned members and older harnesses
without the required isolation flags are deliberately unsupported. Unknown
provider authentication profiles can also remain unsupported rather than
silently relying on environmental credentials. The bridge must remain up for
observation to run; this is not an independent daemon or an always-running
service after Squad is stopped.

Autohand hosted model review is unavailable in the pinned release. Its local
TODO/FIXME fallback is intentionally much narrower than semantic model review
and cannot discover a missing test or infer whether a note remains relevant.
These leads require normal explicit chat work to investigate. Live installed
evidence establishes one notice and one provider-policy denial; fixture passes
do not establish model review for every configured member or provider.
