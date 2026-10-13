# Squad competitor audit

Date: 2026-10-13. Scope: the reliability brief's channel, profile, collaboration,
onboarding, persistence, permission and recovery requirements. This is a decision
input for the existing implementation, not another Squad feature catalogue.

## Evidence and boundaries

Squad's starting point was [README](../../README.md),
[the integration contract](../integration/CONTRACT.md),
[channel workflows](../integration/workflows.md),
[activity](../integration/activity.md), and ADRs
[0013](../adrs/ADR-0013-first-conversation-onboarding.md),
[0015](../adrs/ADR-0015-folder-profiles-and-squad-recruiting.md),
[0034](../adrs/ADR-0034-member-introduction.md),
[0036](../adrs/ADR-0036-member-designer-cold-start.md),
[0041](../adrs/ADR-0041-permissions-survive-the-bridge.md),
[0042](../adrs/ADR-0042-permission-policy-module.md),
[0057](../adrs/ADR-0057-one-memory-shape-reaches-every-reader.md),
[0061](../adrs/ADR-0061-a-failed-turn-says-why.md) and
[0066](../adrs/ADR-0066-durable-goals-and-reported-task-progress.md).
Source and test inspection below concerns only seams needed to evaluate gaps.

GitHub's default-branch head was resolved through `gh api repos/<owner>/<repo>/commits`,
then its source archive was downloaded and inspected at these immutable commits:

| Reference | Inspected commit | Primary sources |
| --- | --- | --- |
| OpenMausBot | `83c10b3908f29c60a49b7e3c5d76f2db7529db45` | [README][omb-readme], [channel verification][omb-channels], [coordination verification][omb-coordination], [onboarding verification][omb-onboarding] |
| Bloks | `fbe515b204bb3aa4baf32c5a91454cf5ad36db5e` | [README][bloks-readme], [room store][bloks-rooms], [agent templates][bloks-profiles], [restart tests][bloks-restart] |
| Rakazo | `2d666c4e98db201c1f7988e09e76a52db20cea69` | [README][rakazo-readme], [group repository][rakazo-groups], [onboarding implementation][rakazo-onboarding], [runtime tools][rakazo-tools] |

"Source verified" means the code and relevant assertions were read. It does
not mean that the competitor's whole app, installation, hosted service or
live-model behavior was tested. Focused execution in disposable source copies:

- Bloks: `node --experimental-strip-types --test test/teams.test.ts test/room-patch.test.ts`
  passed **12 tests**, covering bounded team-plan parsing and restoring the
  server's room list after a rejected optimistic mutation. Node emitted a
  `localStorage` availability warning; no tests failed.
- OpenMausBot: a direct import of `server/resume-recovery.ts` asserted that
  proven pre-accept session rejection permits replay, whereas post-accept
  and unknown acceptance do not. All three assertions passed. This was a
  focused function check, not its integration suite.
- Rakazo: source and test inspection only; its database, worker and browser
  suites were not executed during this audit.

Squad findings describe the inspected baseline before the reliability fixes;
they are acceptance inputs, not a claim about a subsequently changed worktree.
Final verification must record the fixes and their actual results separately.

## Capability comparison and recommended changes

Effort is a qualitative estimate for extending Squad: **S** = one existing
seam; **M** = coordinated browser/bridge/runtime changes and integration tests;
**L** = a new service or trust boundary. These are estimates, not measured days.

| Capability | Evidence in the reference projects | Squad support and verified gap | User value / effort / action |
| --- | --- | --- | --- |
| User channel lifecycle | OpenMausBot has server-owned room setup, roster and transcript controls, with a repeatable create/send/wait/read path [O1][omb-channels]. Bloks validates room membership, broadcasts committed changes and refuses changing a folder already pinned to an engine session [B1][bloks-room-api]. Rakazo creates group, members and thread within one transaction, scoped to the owner [R1][rakazo-groups]. | Creation, edits, membership, threads, projects and UI routes already exist. Baseline `createChannel` in `src/App.jsx` changes local state and navigates before persistence. Its whole-snapshot mirror catches and discards errors. Backend `normalizeChannel` omits `projects`. The gap is confirmed persistence/error/concurrency behavior, not missing screens. | Critical / M / use operation APIs for normal mutations, persist projects, serialize atomic state writes and report failures before claiming success. |
| Agent channel management | OpenMausBot's mounted Chief tools expose `create_room` and `manage_room`; the server requires an active Chief turn, allowed own-section peers, membership and current permission state, and limits creation [O2][omb-chief-api]. Its integration fixture creates/renames/changes membership, rejects foreign peers and revokes the proxy after Stop [O3][omb-chief-test]. Bloks permits agent-attributed room creation and automatically includes the caller [B1][bloks-room-api]; separately, hiring a new team requires an approved proposal [B2][bloks-teams]. Rakazo exposes `create_space` as a confirmed boundary change and `spawn_bot` as persistent agent creation [R2][rakazo-tools]. No agent group-creation tool was found in that inspected built-in catalogue. | README already promises `SQUAD_ACTION` creation; `applySquadActions` parses it only after a direct reply. It immediately announces creation and schedules the first prompt, without an acknowledged backend write or an explicit permission decision at that action seam. Channel replies do not use the same action path. | Critical / M / keep the legacy action protocol compatible, but execute through a common authorized bridge operation, with allow/ask/block, idempotency, validated roster and truthful receipt. |
| Default roles and personality | OpenMausBot ships concrete standing instructions for assistant, inbox, researcher, coder, community and operations [O4][omb-roles]. Imported presets carry role content, skills and starter notes through an allowlist; they cannot import authority or credentials [O5][omb-presets]. Bloks supplies role-specific persona, named capabilities, greeting and setup question [B3][bloks-profiles]. Rakazo stores editable bot instructions and supplies a built-in review skill [R3][rakazo-skill]; a comparable packaged role library was not established in the inspected sources. | `src/data.js` already contains specialized role templates, instructions and brain cards. Browser normalization supplies template defaults; bridge normalization falls back to a generic role card. The bridge writes profile files and injects profile context. This is partial implementation whose consistency and execution proof need strengthening, not a reason to replace agent configuration. | High / M / share deterministic default-profile resolution between UI and bridge; preserve custom fields and permissions; prove actual harness receives role/style/workflow/memory boundaries and configured skills. |
| Skill availability and consent | OpenMausBot presets distinguish reviewed organization content from file-imported skills, with the latter off until enabled [O5][omb-presets]. Bloks makes procedures inspectable and team proposals include bounded skills [B2][bloks-teams]. Rakazo has a real built-in `SKILL.md` recipe and tool catalogue for managing user skills [R3][rakazo-skill], [R2][rakazo-tools]. | Squad's skill registry, local profile skill files and permission ladder are already documented. ADR-0041 records the prior warm-call permission erasure; ADR-0039 records local skill reachability. A skill label alone does not establish a successfully installed skill or runtime access. | High / S–M / retain the registry and policy, verify installed/missing/failed states and role defaults through provision + runtime tests; do not turn imported content into permission grants. |
| Collaboration and responder selection | OpenMausBot distinguishes provider execution from waiting for peers, queues busy recipients, returns results to the source conversation and rechecks access [O6][omb-coordination]. Bloks orders juniors first and senior lead last, with optional lead-only unmentioned requests [B4][bloks-speaking]. Rakazo provides `message_bot` and bounded short-lived `run_subagent`, clearly separated from lasting `spawn_bot` [R2][rakazo-tools]. | Squad already has bounded @mention handoffs, shared channels and tracked work. `dispatchChannelMemberReply` can fan out multiple writers; the direct handoff/action orchestration lives in the browser. There is no independently established durable parent-to-child receipt/restart guarantee in this audit. | High / M / first prove accepted handoffs have one owner and return one result; add explicit channel responder rules only if needed. Preserve existing fan-out as a choice. Do not impose a chain of command on every conversation. |
| Persistent conversations and concurrency | OpenMausBot retains per-task native resume cursors, canonical transcripts and atomic file stores [O7][omb-store]. Bloks persists rooms separately from transcripts through atomic writes [B5][bloks-rooms]. Rakazo enforces unique `(threadId, seq)` and `(threadId, clientNonce)` messages, with database transaction retry [R4][rakazo-schema], [R5][rakazo-messages]. | Channels/threads/messages have a bridge store plus browser fallback. Baseline channel operations independently read, mutate and overwrite one JSON file; snapshots can replace newer server state. Existing shared-conversation logic handles main/quick-chat message races (ADR-0066), but that does not prove channel snapshot safety. | Critical / M / establish one channel mutation owner, use stable operation/message IDs and revisions where needed, reject stale destructive snapshots and preserve legacy documents. No Postgres migration is required for these guarantees. |
| Onboarding and first successful session | OpenMausBot's fake-engine renderer fixture covers failed saves, retry, inventory retention, new provider discovery and first send [O8][omb-onboarding]. Rakazo gates setup on a usable model catalogue [R6][rakazo-model-test] and serializes focus-card insertion/selection so retries cannot duplicate onboarding messages [R7][rakazo-onboarding]. Bloks supplies guided role setup and engine installation diagnostics [B3][bloks-profiles], [B6][bloks-engine-test]. | The documented folder → teammate → conversation flow already exists. Baseline `FirstRun.start` has a `finally` but no visible start-failure catch, and picker cancellation/failure are conflated. Role/name choices are component state, while only the folder/step are persisted. `onStart`/provisioning/first-send behavior must be verified from a clean state. | Critical / M / preserve successful steps and form input, distinguish cancellation from unavailable picker, validate prerequisites, surface provision/session failures and retry without duplicate members or premature completion. |
| Activity and useful failure states | OpenMausBot shows peer-wait status separately from active work and retains actionable provider recovery notices [O6][omb-coordination], [O9][omb-recovery]. Bloks tests stale approval cards after restart [B7][bloks-restart]. Rakazo retains durable ordered events/messages and tests exact approved-effect replay rather than treating approval as a generic retry [R4][rakazo-schema], [R8][rakazo-approval]. | Semantic activity, availability, work attention, task progress and explicit SDK errors are already implemented/documented. ADR-0061 deliberately makes failures legible; it does not repair the underlying provider cause. New channel/onboarding flows must reach those truthful failure surfaces. | High / S–M / use existing activity/status UI, persist operation errors and distinguish waiting, blocked, interrupted, failed and completed. Never mark completion merely because a process exited. |
| Interrupted work and safe retry | OpenMausBot classifies replay from whether the provider accepted a prompt, rather than error prose [O9][omb-recovery], and documents bounded handoff restart behavior [O6][omb-coordination]. Bloks records in-flight turns as they start, resumes eligible work once, respects Stop and asks after long downtime [B8][bloks-cutoff], with crash tests [B7][bloks-restart]. Rakazo fences competing computer replacement and preserves live work [R9][rakazo-recovery]. | ADR-0066 already defines durable goals with restart-paused explicit Resume, and interrupted ordinary chat with Retry. That is a deliberate authority boundary. The remaining acceptance gap is safe orchestration and state repair when an operation or handoff was partly accepted. | High / M / keep explicit Resume on restart; retain task evidence and partial replies, never blindly replay a side-effecting prompt, and test late success after Stop/retry. Do not copy competitors' automatic restart policy wholesale. |
| Reusable teams and recovery of local data | OpenMausBot exports reviewed team packages with presets, roles and rooms while excluding credentials and authority [O5][omb-presets], [O10][omb-sharing]. Bloks has reusable team definitions and verified backups whose restore preserves replaced state [B9][bloks-library], [B10][bloks-backup]. | Squad has role templates, recipes and saved automations; a portable whole-team package and whole-workspace backup/restore were not established by the inspected docs/code. Local state is split between browser and bridge, so a backup limited to `channels.json` would be incomplete. | Medium / M–L / defer import/export and workspace restore until core flows pass; if selected later, inventory every store and exclude credentials/permission elevation by default. |

## Corrections to apparent gaps

1. **Profiles, delegation, goals, activity and skills already have implementation.**
   The requested work should make their real runtime paths consistent and
   reliable. A new product-wide inventory or framework rewrite would hide the
   failures that matter.
2. **Schedules and webhooks are not simply absent from this checkout.**
   README's "Available today" boundary says they are absent, but
   `server/routes/workflows.route.mjs` implements cron ticks in `init`,
   `POST /api/webhooks/:token`, persisted runs and pending browser dispatch;
   its integration note describes that behavior. Some steps dispatch through
   the bridge, others need the open app. Verify registration, packaging and
   closed-app dispatch before changing the product claim. Treat this as a
   documentation/verification gap, not a request to add a second scheduler.
3. **A public/private label is not multi-human access control.**
   Squad's README explicitly limits the current workspace to one local user.
   The stronger organization/space/shared-room boundaries in the reference
   products are useful future requirements, not permission semantics Squad
   can claim through its current visibility label.
4. **Role content does not confer tool authority.** Presets, imported skills
   and model-produced channel actions must remain below the explicit effective
   permission policy. Defaults should make an agent useful without expanding
   privileges on legacy agents.

## Prioritized acceptance backlog

This backlog identifies work to verify or select; it does not report it as
shipped. Items A1–A4 implement the explicit brief first. A5–A8 are the highest
value candidate gaps after those core paths pass. Suggested priority and effort
must be revisited against reproduced failures and the final baseline.

| ID / priority / effort | Scope and acceptance criteria | Required proof |
| --- | --- | --- |
| A1 / P0 / M | Complete normal-UI channel lifecycle against the real backend: create, edit name/visibility/projects/defaults, add/remove members, message, navigate away/reopen, refresh and restart. Duplicate submit is one operation; concurrent creates/updates retain both results; invalid/failed writes preserve prior state and expose retry. Migrate legacy channel arrays/documents without losing threads/messages. | Disposable real bridge integration suite plus browser UI lifecycle using that bridge; restart reads persisted state. Assertions cover concurrent submissions, error responses, failed storage, stale snapshots and member/thread invariants. |
| A2 / P0 / M | One agent-channel operation path for direct and channel execution. Agent identity comes from execution context; allow commits, ask persists a proposal, block refuses. Validate current permissions, members and project scope; include user and creator defaults. Repeating an accepted action cannot create another channel or another purpose prompt. No success receipt before commit. | Actual harness/tool/action execution fixture calls the real operation, persists and reopens the channel; denies forged actor IDs, blocked/revoked policies, invalid members and expired work. UI can approve/reject proposals and displays refusal/retry. |
| A3 / P0 / M | Onboarding resumes after failed provisioning, unavailable runtime/provider, rejected folder and refresh. Folder, selected profile, name and completed steps survive. One member is provisioned despite double click/retry; setup completes only after required writes succeed, and the first conversation/session can run. Cancellation is distinct from picker failure. | Clean-state browser + disposable bridge journeys for success, invalid input, interruption, retry and recovery. Provider execution proves a first real session; fake-provider tests are labeled separately from live-provider verification. |
| A4 / P1 / M | Default profiles use the existing role library and define role/purpose, communication style, system instructions, workflow, skills/tools, memory/context rules, collaboration and escalation boundaries. Every new-agent path receives a valid deterministic default; custom fields and legacy agents remain compatible. Profile content never silently grants a blocked tool. | Provisioning and actual selected-harness execution verify the prompt/config/skill files used; real execution demonstrates role-specific behavior and a denied capability. Cover missing skill, failed install, warming/reload and custom override preservation. |
| A5 / P1 / M | Accepted delegation records source/recipient/thread/workspace/request ID; one accepted request yields one recipient execution and one returned receipt. Busy targets queue or explicitly refuse; breaks/revocation are rechecked at dispatch. A browser disconnect or restart does not falsely complete accepted work. | Controlled actual adapters + bridge persistence/restart tests, followed by a live implement → independent test/review → returned result journey with actual file/test evidence. No claim of named reviewer participation without its execution receipt. |
| A6 / P1 / M | Safe interrupted-turn recovery: retain partial answer, tasks and error; reconcile loading state with the current bridge process; explicit Resume/Retry cannot revive stopped/deleted work or duplicate previously committed channel actions. Keep restart-paused goals as documented. | Crash/restart, Stop-vs-late-result, retry-vs-old-result and stale approval tests. Verify accepted side effects through operation IDs and saved state, not matching provider error text. |
| A7 / P2 / S–M | Clarify channel responder rules using existing dispatch: explicit mentions select recipients; an optional named lead handles unmentioned requests and reports/reviews delegated work. Preserve current all-member behavior as an available setting. Validate lead membership after removal. | Runtime tests prove chosen recipients and ordered dependencies; browser settings survive reopen; token-saving claims require measured request counts. Defer automatic model routing. |
| A8 / P2 / S–M | Reconcile workflow documentation with implemented scheduling/webhooks; verify route loading and packaged imports, restart semantics, idempotent triggers, review gates and which steps require the app. | Existing workflow checks plus a real bridge route/start/restart scenario and packaged module check. Update README/integration docs to match established limits. |

## Explicit deferrals

- **Whole-team import/export and preset sharing:** useful repeatability, but
  core profile/provision/channel reliability comes first. Later packages must
  use bounded validated schemas, preview content, preserve custom edits and
  exclude credentials, conversations and permission grants. OpenMausBot's
  allowlisted package/preset boundary is the useful precedent.
- **Whole-workspace backup/restore and per-turn Undo/rehearsal:** valuable for
  a local-first product, but requires complete coverage of browser, bridge,
  agent-profile and daemon stores plus race-safe restore. A partial backup
  marketed as whole-workspace recovery would be a new reliability defect.
- **Mobile/remote clients, federation and multi-human collaboration:** new
  identity, transport, isolation and data-sharing boundaries; outside the
  local single-user repair. Labels alone cannot supply those guarantees.
- **Large managed connector catalogues, cloud computers and new sandbox
  providers:** add service/account/security dependencies. Preserve and verify
  Squad's existing local project and Computer Use seams first; readiness-only
  connector pages must retain their stated boundary.
- **Voice calls, spoken personas, mascot customization and automatic routing
  models:** lower value than dependable creation, setup and collaboration.
  Role personality can work through text/system instructions now.
- **Automatic replay after application restart:** not selected. Squad already
  chose explicit goal resume; acceptance of a prior turn can be ambiguous and
  remote or filesystem effects may have happened. Recovery should preserve
  evidence and allow an explicit informed continuation.
- **Porting competitor implementations wholesale:** not selected. Patterns
  should extend Squad's existing bridge/harness/state seams. Bloks declares
  FSL-1.1-MIT in its [license][bloks-license]; this audit imports no code.

## Handover

The immediate implementation decisions are acknowledged channel operations,
serialized durable mutation, permitted agent actions, recoverable clean-state
onboarding, and one profile-resolution contract used by the actual runtime.
Existing activity/goals/skills/recipes should be reused. Parent engineering
reports must attach test results and rendered/runtime evidence to A1–A4 before
calling those checkpoints complete, and record the selected/deferred status of
A5–A8 against the final worktree.

[omb-readme]: https://github.com/milind-soni/OpenMausBot/blob/83c10b3908f29c60a49b7e3c5d76f2db7529db45/README.md
[omb-channels]: https://github.com/milind-soni/OpenMausBot/blob/83c10b3908f29c60a49b7e3c5d76f2db7529db45/docs/verification/channels.md
[omb-chief-api]: https://github.com/milind-soni/OpenMausBot/blob/83c10b3908f29c60a49b7e3c5d76f2db7529db45/server/index.ts#L19583-L19669
[omb-chief-test]: https://github.com/milind-soni/OpenMausBot/blob/83c10b3908f29c60a49b7e3c5d76f2db7529db45/server/chief-rooms.e2e.test.ts
[omb-roles]: https://github.com/milind-soni/OpenMausBot/blob/83c10b3908f29c60a49b7e3c5d76f2db7529db45/src/lib/bot-roles.ts
[omb-presets]: https://github.com/milind-soni/OpenMausBot/blob/83c10b3908f29c60a49b7e3c5d76f2db7529db45/server/presets.ts
[omb-coordination]: https://github.com/milind-soni/OpenMausBot/blob/83c10b3908f29c60a49b7e3c5d76f2db7529db45/docs/verification/room-coordination.md
[omb-store]: https://github.com/milind-soni/OpenMausBot/blob/83c10b3908f29c60a49b7e3c5d76f2db7529db45/server/store.ts
[omb-onboarding]: https://github.com/milind-soni/OpenMausBot/blob/83c10b3908f29c60a49b7e3c5d76f2db7529db45/docs/verification/onboarding.md
[omb-recovery]: https://github.com/milind-soni/OpenMausBot/blob/83c10b3908f29c60a49b7e3c5d76f2db7529db45/server/resume-recovery.ts
[omb-sharing]: https://github.com/milind-soni/OpenMausBot/blob/83c10b3908f29c60a49b7e3c5d76f2db7529db45/docs/team-sharing.md
[bloks-readme]: https://github.com/hamedgitty/bloks/blob/fbe515b204bb3aa4baf32c5a91454cf5ad36db5e/README.md
[bloks-rooms]: https://github.com/hamedgitty/bloks/blob/fbe515b204bb3aa4baf32c5a91454cf5ad36db5e/server/bloks.ts
[bloks-room-api]: https://github.com/hamedgitty/bloks/blob/fbe515b204bb3aa4baf32c5a91454cf5ad36db5e/server/index.ts#L13485-L13543
[bloks-teams]: https://github.com/hamedgitty/bloks/blob/fbe515b204bb3aa4baf32c5a91454cf5ad36db5e/server/teams.ts
[bloks-profiles]: https://github.com/hamedgitty/bloks/blob/fbe515b204bb3aa4baf32c5a91454cf5ad36db5e/src/lib/agentTemplates.ts
[bloks-speaking]: https://github.com/hamedgitty/bloks/blob/fbe515b204bb3aa4baf32c5a91454cf5ad36db5e/server/index.ts#L6061-L6090
[bloks-engine-test]: https://github.com/hamedgitty/bloks/blob/fbe515b204bb3aa4baf32c5a91454cf5ad36db5e/test/engine-setup.test.ts
[bloks-restart]: https://github.com/hamedgitty/bloks/blob/fbe515b204bb3aa4baf32c5a91454cf5ad36db5e/test/restart-recovery.test.ts
[bloks-cutoff]: https://github.com/hamedgitty/bloks/blob/fbe515b204bb3aa4baf32c5a91454cf5ad36db5e/server/cut-off.ts
[bloks-library]: https://github.com/hamedgitty/bloks/blob/fbe515b204bb3aa4baf32c5a91454cf5ad36db5e/src/lib/teamLibrary.ts
[bloks-backup]: https://github.com/hamedgitty/bloks/blob/fbe515b204bb3aa4baf32c5a91454cf5ad36db5e/server/backup.ts
[bloks-license]: https://github.com/hamedgitty/bloks/blob/fbe515b204bb3aa4baf32c5a91454cf5ad36db5e/LICENSE
[rakazo-readme]: https://github.com/elie222/rakazo/blob/2d666c4e98db201c1f7988e09e76a52db20cea69/README.md
[rakazo-groups]: https://github.com/elie222/rakazo/blob/2d666c4e98db201c1f7988e09e76a52db20cea69/packages/db/src/groups.ts#L343-L415
[rakazo-tools]: https://github.com/elie222/rakazo/blob/2d666c4e98db201c1f7988e09e76a52db20cea69/packages/adapters/src/builtin-tools.ts#L985-L1151
[rakazo-skill]: https://github.com/elie222/rakazo/blob/2d666c4e98db201c1f7988e09e76a52db20cea69/packages/adapters/src/builtin-skills.ts
[rakazo-schema]: https://github.com/elie222/rakazo/blob/2d666c4e98db201c1f7988e09e76a52db20cea69/packages/db/prisma/schema.prisma#L474-L588
[rakazo-messages]: https://github.com/elie222/rakazo/blob/2d666c4e98db201c1f7988e09e76a52db20cea69/packages/db/src/messages.ts
[rakazo-model-test]: https://github.com/elie222/rakazo/blob/2d666c4e98db201c1f7988e09e76a52db20cea69/apps/web/e2e/onboarding-model-required.spec.ts
[rakazo-onboarding]: https://github.com/elie222/rakazo/blob/2d666c4e98db201c1f7988e09e76a52db20cea69/apps/api/src/onboarding.ts
[rakazo-approval]: https://github.com/elie222/rakazo/blob/2d666c4e98db201c1f7988e09e76a52db20cea69/packages/adapters/src/executor-approval-replay.test.ts
[rakazo-recovery]: https://github.com/elie222/rakazo/blob/2d666c4e98db201c1f7988e09e76a52db20cea69/packages/adapters/src/computer-recovery.test.ts
