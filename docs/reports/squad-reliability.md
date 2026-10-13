# Squad reliability checkpoint evidence

The attached reliability brief remains the scope. Existing documentation is the
baseline; this report records defects and proof, not a replacement feature list.

## Checkpoint 1 — baseline and targeted investigation

Status: complete for targeted investigation and baseline. Implementation and
end-to-end acceptance remain separate checkpoints below.

Documentation read: README, DESIGN, integration CONTRACT, ADRs 0013, 0014, 0015,
0029, 0041, 0050 and 0051; the competitor audit records its additional sources.
The checkout started with substantial unrelated/uncommitted work, preserved.

Commands and actual baseline results:

- `bun run ci`: passed, including production Vite build, daemon formatting,
  tests and binary build. Initial sandbox execution stopped at local socket
  creation (`check:otel`, exit 13); rerunning with local-server permission passed.
  Full output: `.codex-artifacts/reliability-baseline-ci.log`.
- `bun run check:onboarding`: failed seven stale source checks expecting the
  former checklist/account-menu flow. ADR-0013 and DESIGN describe FirstRun and
  Settings setup instead. This is a baseline verifier failure, not proof of
  the new onboarding runtime working.
- `node scripts/check-channel-lifecycle.mjs`: four failures before edits.
  Real backend drops project path, retains 2 of 12 concurrently created
  channels, rejects identical creation retries, and the rendered sidebar
  cannot reopen its create dialog after the first channel.

Reproduction: use a fresh browser profile, sign in, create a channel from the
sidebar, then press the sidebar Create channel again. The dialog stays hidden.
Relevant code: ChannelCreateDialog in `src/App.jsx`; channel normalization and
read-modify-write functions in `server.mjs`. The check above reproduces these
against isolated state; no user data or provider requests are required.

`node scripts/check-onboarding-recovery.mjs` additionally reproduces three
onboarding defects from disposable browser/bridge state:

- A nonexistent folder produces a profile failure, yet Start is enabled.
- Refresh after choosing a role and typing a name loses both fields.
- Injecting a 503 only at `/api/agents/provision` fails to show the error;
  setup instead moves away from `/welcome` and records completion.

Relevant seams: `FirstRun.start`, `normalizeOnboardingState`,
`startFirstConversation` (completes state before awaiting creation), and
`createAgent` (publishes/navigates before provision and catches its failure).
The original three assertions now pass and remain in the expanded recovery
suite. No provider request was made by this reproduction.

`node scripts/check-member-profiles.mjs` reproduced the runtime profile gap:
agent-only warm/restart calls erased a custom role and a built-in frontend
member received generic purpose context. Expanded regressions additionally
caught deselected skills remaining discoverable and saved Codex warming through
Autohand. The existing sixteen templates were present; the bridge's profile
resolution and runtime context were the failing seams (ADR-0076).

## Checkpoint 2 — competitor audit

Status: complete. [Audit](squad-competitor-audit.md) inspects pinned source for
all three projects, compares relevant capabilities against existing Squad docs,
records proof limits, and provides acceptance backlog A1–A8 and deferrals.

## Checkpoint 3 — channel lifecycle

Status: complete for the documented local channel lifecycle. Changes implement confirmed CRUD/membership calls,
reopenable creation, retained error drafts, atomic serialized channel writes,
projects/section persistence, idempotent retries, duplicate name errors, additive
cache sync and deletion tombstones. ADR-0072 records the choice and limits.

The real regression check and backend lifecycle/restart/error coverage pass.
Agent permission/proposal management now runs in shared chat and background
completion paths (ADR-0075). Evidence separates controlled adapters from the
real-provider journey below.

Verified after changes:

- `node scripts/check-channel-lifecycle.mjs`: **7 checks passed**. Real bridge
  plus rendered Chrome cover saved projects/sections, concurrent creation,
  identical retry and duplicate rejection, edits and concurrent memberships,
  stored threads/messages after bridge restart, stale snapshot conflict,
  additive sync, deletion tombstones, legacy migration, damaged JSON refusal,
  repeated sidebar creation, retained duplicate-error draft, settings rename,
  sidebar section change and reopening after restart.
- `bun run ci`: **passed** after changes, including the new backend lifecycle
  check, existing git/relay/permission/runtime tests, JSX import validation,
  production Vite build and daemon formatting/tests/build. Output:
  `.codex-artifacts/reliability-regression-ci.log`. An intermediate run caught
  the new component's single-quoted import declarations, which the repository's
  JSX scanner did not recognize; they were corrected to repo style before the
  passing rerun. Cargo's existing cache cleanup permission warning remains.
- `git diff --check` and Node syntax checks passed.
- Rendered screenshot inspected: `.codex-artifacts/reliability/channels.png`.
  Shows the reopened `browser-renamed` channel under Engineering. This is
  browser proof, not an installed-app or live-provider check.
- `node scripts/verify-channel-browser.mjs`: **passed**. This separate fixture
  suite verifies recovered transcript, targeted dispatch to one member,
  `@here` dispatch to both members, working presence, channel/profile/model/
  auto-mode request context, inline replies and participants, thread follow-up
  selection/cancellation with draft retained, Markdown export and missing-
  transcript fallback after reload. The former collapsed UI, forced CLI pin
  and inferred busy labels were stale expectations against DESIGN, ADR-0030
  and ADR-0016. The initial label-only fix was insufficient: mocked chats never
  informed the real bridge. The fixture now derives presence from held mocked
  requests and releases them after the working assertion. It remains mocked
  chat proof, not actual member/model execution.
- `node scripts/check-channel-transcript.mjs`: **passed**. The flat stream had
  dropped threads with metadata but no messages. ADR-0074's read-only projection
  retains those titles, discloses missing bodies/counts, preserves real replies,
  deduplicates records and filters other channels. It does not invent history.
  The rendered archive fallback assertion remains in the browser suite.
- `.codex-artifacts/channels-browser.png` was inspected. The final capture
  waits until the startup overlay disappears and labels recovery records Squad.

Added agent channel evidence:

- Before implementation, `node scripts/check-agent-channel-actions.mjs` failed
  at real `/api/chat` completion: ask permission returned no proposal receipt.
  Browser-only DM parsing skipped permissions and channel replies; delayed
  purpose delivery captured the pre-creation channel list (ADR-0075).
- `node scripts/check-agent-channel-actions.mjs --browser`: **11 checks passed**
  through isolated bridge APIs, the actual SDK adapter/session pool, persisted
  channel state and disposable Chrome. Controlled model output covers ask,
  allow, block, concurrent approval, retry, recipient adapter invocations and
  saved replies, in-flight revocation, forged fields, missing peers, workspace
  scope, breaks, rejection, expiry, removal, deletion, corrupt persistence,
  interrupted delivery and remote permission-save/token failure. DM once and
  channel streaming both return receipts; streaming emits one final done.
- The rendered journey refuses approval after revocation, retains a visible
  error, retries after a grant and opens the confirmed channel. Both screenshots
  were inspected: `.codex-artifacts/reliability/agent-channel-proposal.png` and
  `.codex-artifacts/reliability/agent-channel-approved.png`.
- `node scripts/check-permission-policy.mjs`: passed, including the assertion
  that every autonomy rung asks before shared channel creation.
- `node scripts/check-channel-lifecycle.mjs`: all **7 checks passed** after
  action integration, including normal sidebar/settings creation and restart.
- `node scripts/check-onboarding-recovery.mjs`: all **8 checks passed** after
  integration. An attempted `--filter duplicate` matched no case and correctly
  failed rather than reporting empty coverage; the complete rerun passed.
- `node scripts/verify-channel-browser.mjs`: passed again, with the same mocked
  chat proof boundary described above.
- `bun run ci`: **passed** with the new **10 backend action checks**, existing
  SDK/harness/goal/permission/git/relay checks, production build and daemon
  formatting, 75 unit tests, two binary tests and binary build. Output:
  `.codex-artifacts/reliability-agent-channels-ci.log`. Existing Vite chunk-size
  and Cargo global cache cleanup warnings do not fail these checks.
- `git diff --check` and new manager/route Node syntax checks passed. The JSX
  scanner required the new component's imports to use the repository's double-
  quoted style; correction preceded the passing build and CI.

Production purpose delivery uses the configured runtime; tests control model
output at its SDK boundary. They do not establish live provider, installed
native or deployment proof. Current permission writes and channel mutations
share one atomic queue; snapshot/sync cannot replace authority. Running purpose
deliveries become a visible error on restart and are not automatically replayed.
Review remote proposals on the owning bridge; settings revocation forwards
there, while cross-bridge proposal aggregation is deferred.

Documentation changed together: ADR-0075, DESIGN, CHANGELOG, README, integration
CONTRACT and this report. Action checks are part of CI; browser checks remain
separate because they require Chrome. Existing unrelated work is preserved.

Final verification:

- `node scripts/check-run-channel-actions.mjs`: **13 checks passed** through
  real tracked-run routes and controlled SDK, CLI and Codex processes. Covers
  ask/allow/block, duplicate requests, SDK failure, late output after Stop,
  in-flight revocation and restart receipts. The initial red run had nine
  missing receipts and an SDK error labeled completed. Logs:
  `.codex-artifacts/reliability/run-channel-actions-red.log` and
  `.codex-artifacts/reliability/run-channel-actions-final.log`.
- `node scripts/check-channel-lifecycle.mjs`: all **7 checks passed**, now also
  covering normal-UI private visibility, project add/remove/restore, member
  add/remove/restore, preservation after restart and confirmed settings deletion.
  An intermediate test clicked after only the backend acknowledgment, before
  the checkbox rendered the change. It now asserts rendered checked/unchecked
  state before the next click; no product assertion was removed.
- `node scripts/check-agent-channel-actions.mjs --browser`: all **11 checks
  passed** again. Purpose roots show the actual member; older roots recover
  identity from their receipt without replaying completed deliveries.
- The live FirstRun journey below verifies proposal, normal approval, actual
  purpose/skill execution and reopening. It uses one member; multi-member model
  collaboration remains Checkpoint 6 work.
- `bun run ci`: **passed** with **13 run checks**, **6 profile checks**, existing
  **10 backend action checks**, production build and daemon formatting/tests/
  binary build. Output: `.codex-artifacts/reliability-run-channels-ci.log`.
  Existing Vite and Cargo warnings remain non-failing. `git diff --check` passed.
- Updated screenshots were inspected: `reliability/channels.png` and
  `reliability/live-onboarding-channel.png` under `.codex-artifacts/`.

External-harness evidence is controlled Codex adapter execution, not a real
Codex account/provider. No native installation or release is claimed. Remote
proposal aggregation remains the explicit ADR-0075 deferral. Local lifecycle
acceptance has automated evidence; multi-member provider cooperation is separate.

## Checkpoint 4 — onboarding recovery

Status: complete for the documented local setup flow. Suggested-role first
session/channel and alternate normal/custom creation pass, with native,
new-account login and provider coverage boundaries stated below.

Implemented in FirstRun and App without replacing the existing setup layout:
saved folder/role/name and edited-name flag; stable provisioning ID; full
account/runtime/provider/folder/name/role readiness; bounded cancellable folder
validation; inline folder and provisioning retry; synchronous duplicate-start
guard; and publication/completion/navigation only after successful provision.
The onboarding creation path no longer catches failure as success. The general
member-creation path retains its previous optimistic behavior for later work.

An additional invalid-saved-state regression failed before its fix: a removed
role ID led to no active form. The step now uses valid template selection and
offers replacement while preserving the typed name; invalid saved IDs are
discarded before provisioning. ADR-0073 records the causes and tradeoffs.

Verified:

- `node scripts/check-onboarding-recovery.mjs`: **8 checks passed**. The original
  three failure assertions remain. It exercises invalid folders,
  saved role/name after refresh, visible provisioning failure, retrying folder
  checks, runtime/provider readiness recovery, rapid clicks/Enter, stable-ID
  retry after refresh, real provisioning, installed skill fixtures, generated
  profile.json/AGENTS.md, exactly one member, drafted first prompt and bridge
  restart. Invalid saved role/identity coverage is included in the final rerun.
  This uses real bridge/browser and real provisioning with a fixture skill
  catalog; only failures/readiness are injected. No provider executes.
- `node scripts/verify-onboarding-browser.mjs`: **2 journeys passed**, using
  real isolated APIs: mandatory signed-out gate and terminal alternative;
  signed-in clean root → FirstRun → skip → saved skip → Settings resume →
  provider controls/deep link. Direct protected paths retain their URL while
  showing the gate; root redirects to `/welcome`. No live login is claimed.
- `node scripts/verify-onboarding-flow.mjs`: **15 checks passed**, adapted to
  FirstRun and Settings while keeping account delegation, root/state, member
  creation, provider navigation, public account data and documentation coverage.
- `bun run ci`: **passed**, now including onboarding wiring and channel
  transcript checks, production Vite build, daemon formatting, 75 unit tests,
  two integration tests and binary build. Output:
  `.codex-artifacts/reliability-onboarding-ci.log`. Cargo still reports its
  existing global cache cleanup permission warning without failing a check.
- Final author-label/readiness edits also received focused transcript/import/
  onboarding/browser checks and a production build. `git diff --check` passed.
- `.codex-artifacts/reliability/onboarding-confirmed.png` was inspected: the
  confirmed member's role-specific introduction and drafted first prompt render
  in its real conversation. This does not constitute a model-generated reply.
- `node scripts/check-onboarding-live.mjs`: **passed** twice, with the final
  run also asserting actual skill activation and member attribution. Fresh
  Chrome and bridge state use the configured real Autohand AI account and
  `grok-4.7`, without local-storage seeds or replaced API responses. Normal
  offered folder → suggested Full Stack Developer → Start → Send → Approve
  produces a real reply, durable channel and purpose reply. Its trace activates
  installed `testing-strategies` with `skill`, then reads the disposable README.
  The marker, named skill and concrete next step render after bridge restart.
  Evidence: `.codex-artifacts/reliability/live-onboarding.json`, log and inspected
  channel screenshot. This uses existing credentials; it is not new-account
  device-login or packaged-native proof. Four existing demo members remain;
  the check verifies one newly provisioned member by its saved identity.
- `node scripts/check-onboarding-recovery.mjs`: all **8 checks passed** again
  after profile/background/action changes. Output:
  `.codex-artifacts/reliability/onboarding-recovery-final.log`.
- `node scripts/check-member-creation.mjs`: **5 real-browser/bridge checks
  passed** after three reproduced failures (ADR-0077). Failed saves remain
  editable without publishing; rapid submissions send one request; retry after
  refresh reuses identity and instructions; alternate setup completes only
  after preparation and drafts the first message; handwritten personality and
  brain edits reach the saved profile. A response held after actual preparation
  is recovered after refresh without another member. Required empty names do
  not dispatch and confirmed drafts clear before the next creation. Skills and
  runtime output are controlled fixtures; no provider is executed here.
  Evidence: `.codex-artifacts/reliability/member-creation-red.log` and
  `member-creation-final.log`. One intermediate run failed before the third
  browser case at CDP initialization; the subsequent complete suite passes.
  The handwritten tab check was corrected to use actual mouse input before
  interpreting product behavior.
- The existing **8 onboarding recovery checks**, **15 onboarding wiring
  checks**, member-draft and permission checks pass after general creation
  changes. Full `bun run ci` passes, including the **7 new config checks**,
  production build, daemon formatting, 75 unit tests, two binary tests and
  binary build: `.codex-artifacts/reliability-member-creation-ci.log`.
  Existing Vite chunk-size and Cargo cache-cleanup warnings remain non-failing.

Documentation changed together: ADR-0073, ADR-0074, ADR-0077, DESIGN, CHANGELOG, README,
SETUP_GUIDE and this report. Browser processes and temporary state are closed
and removed by the harness; unrelated checkout work is preserved.

## Checkpoint 5 — runtime profiles and capabilities

Status: complete for the existing role/profile contract, subject to the
adapter/provider proof boundaries below.

ADR-0076 records five reproduced failures and their fixes. The existing sixteen
profiles now share one catalog used by the browser and bridge. Saved custom
profiles survive agent-only warm/chat/run routing; authored legacy personas are
hydrated and kept. Runtime prompts receive role, purpose, brain/personality,
memory/collaboration rules, installed/unavailable skills and actual permission
boundaries. Deselected skills move outside runtime discovery with files retained
for restoration. Saved external harnesses no longer warm an Autohand session.

Evidence:

- `node scripts/check-member-profiles.mjs`: **6 checks passed**, including all
  **16 built-in profiles** at the real SDK configuration boundary, custom
  warm/restart preservation, skill revocation/restoration with authored bytes
  retained, unavailable skills, corrupt-profile refusal, and saved Codex
  execution with an actual channel-action receipt. The SDK and Codex output
  are controlled fixtures, not provider proof.
- Existing `check-permissions`, `check-member-roster`, `check-prompt-stability`,
  `check-bridge-imports` and the **10 backend agent-channel checks** passed.
- `node scripts/check-member-config.mjs`: **7 checks passed** after malformed
  JSON and an unreadable config path initially returned success. Config shape
  validation, an actual write failure followed by recovery, preserved profile/
  persona/config bytes and retained valid custom settings now pass. Parse errors
  do not quote damaged config contents. The original positive fixture confused
  `{ kind }` tool exclusions with strings; it was corrected to the existing
  contract. Evidence: `member-config-red.log` and `member-config-final.log` in
  `.codex-artifacts/reliability/`. These checks execute the real bridge/disk,
  without a provider. ADR-0076 records the partial filesystem transaction limit.
  The existing **6 profile checks** pass again after this correction, including
  all sixteen built-in runtime configurations, and config checks are now in CI.
- `bun run ci`: **passed** after profile changes, including the new profile
  checks, production Vite build and daemon formatting/tests/binary build.
  Output: `.codex-artifacts/reliability-member-profiles-ci.log`. Existing Vite
  chunk-size and Cargo cache-cleanup warnings remain non-failing.
- `git diff --check` passed.
- `node scripts/check-member-profiles-live.mjs`: **failed**, with partial real
  provider proof. Frontend Developer read the disposable README and returned
  its exact marker, role, a keyboard-focus/API-error-state check, durable-memory
  rules and an assess-only escalation. The QA turn returned the text "The model
  did not provide a clear response. Please try rephrasing your question."
  instead of the requested role result. The denied-write probe was not reached.
  Evidence: `.codex-artifacts/reliability/live-member-profiles.json` and log.
  The earlier non-streaming attempt hit the HTTP header timeout; the streamed
  rerun corrected that observation method and exposed this actual response.
- Focused retry `node scripts/check-member-profiles-live.mjs
  --role=common-qa-engineer`: **passed** with the same role, marker, concrete
  check, memory and escalation assertions. QA read the project and described
  reproducing the false-success/focus defects. An agent-only follow-up reported
  the blocked write capability and created no `denied-proof.txt`. Its trace has
  no write tool call: this is unavailable-capability/compliance proof, not a
  recorded denial event. Controlled runtime checks separately verify configured
  exclusion. Evidence: `live-member-profiles-common-qa-engineer.json` and
  `live-member-profiles-qa.log` in `.codex-artifacts/reliability/`.
- Final live onboarding purpose activated its actually installed selected
  `testing-strategies` skill and named it in a role-specific reply. Frontend
  Developer, QA Engineer and Full Stack Developer have observed provider
  behavior; all sixteen catalog entries have controlled configuration coverage.
  This does not imply live proof of every role/provider/harness combination.

Live checks use the configured account only in disposable state, with MCP/hooks
disabled, and do not change the user's provider configuration. Failed attempts
are retained alongside the successful focused retry. Documentation
changed together: ADR-0076, DESIGN, CHANGELOG, README, integration CONTRACT and
this report. Profile checks are in CI; live checks require credentials and are
explicit opt-in commands.

## Checkpoint 6 — connected delegation and selected gaps

Status: complete for selected local core capabilities, with configured-provider core execution verified under the explicit proof bounds below. A5/A6 local
orchestration and explicit recovery now have executed browser coverage. A8's
workflow/packaged-runtime verification and documentation corrections are complete
within the bounds below. Optional lead/team conventions (A7) remain deferred.

ADRs 0078–0080 record the causes and decisions: detached second-hop parents,
premature parent completion, lost sibling results, stale accepted work after
restart, a Retry checkpoint control that never executed, and immediate root
mentions creating separate parents. Replies now retain one parent, workspace,
original request, bounded earlier evidence and saved successful ancestor output.
Explicit retries guard rapid clicks, retain the receiving request ID and return
child results through saved QA output without rerunning completed source work.
Busy recipients decline in both the browser and bridge, with no hidden queue.

Executed evidence:

- `node scripts/check-collaboration-cycle.mjs`: **11 checks passed** in
  `collaboration-checkpoints-final-current.log`. Real browser/bridge with
  controlled SDK
  covers ordered implementation → QA → review → returned verdict, partial failure,
  rapid retry, concurrent sibling results, break refusal, parallel root mentions,
  busy refusal including a competing real API request, receiving/source-message
  Retry, and abrupt browser closure
  plus bridge restart followed by explicit review retry. Completed implementation
  and QA execute once; interrupted review executes twice. This is orchestration
  proof, not provider code quality. The source-conversation Retry regression
  reproduced a second parent and repeated implementation; the final 11-case run
  verifies the fix and explains historical completed checkpoints without replay.
- `node scripts/check-chat-recovery.mjs`: **passed** for old/unknown accepted work,
  retained context, idempotence, saved ancestor result reconstruction, unresolved
  children, failed own executions and malformed missing-ID records.
- `node scripts/check-workflow-recovery.mjs`: **passed** against actual bridge/disk
  across three restarts. Webhook payload and approval gate survive, approval
  exposes one pending app dispatch, repeated approval is refused, and controlled
  completion is retained without becoming pending again. This does not prove
  running-step crash resume or provider execution.
- `node scripts/check-computer-use-portable.mjs`: **passed** after an extracted
  actual workflow import reproduced missing `src/lib/workflows.js`. Portable
  archives now include shared modules, and extracted workflow/profile imports
  succeed with all 16 profiles. Native bytes/signatures remain fixtures;
  installation/publication are outside this proof. ADR-0081 records the decision.
- Aggregate CI after accepted-handoff recovery **passed** in
  `reliability-handoff-recovery-ci.log`. The newer retry CI attempt stopped at a
  ten-second project-observer fixture deadline; its focused rerun passed in
  `project-observer-focused.log`. The final current `bun run ci` passed in `reliability-final-ci.log`, including the observer check, workflow recovery, archive imports, production build and daemon checks.
- The browser driver now allocates a separate HMR port, cleans up failed Chrome
  initialization, bounds API requests, and handles signalled child termination
  without waiting for a second exit event. A real child SIGTERM/repeated-cleanup
  probe passed in 2 ms. These driver corrections are distinguished from product
  fixes; no failing assertions or test bodies were removed.

Configured-provider collaboration evidence is kept separately:

- The first attempt failed its observation deadline after a provider throughput
  refusal. Its initial disabled Send click was corrected by waiting for the actual
  enabled control. The first failure snapshot did not retain its earlier rich
  observation; the log and tool transcript retain the provider notice.
- The second attempt did real Builder file/tool work, but a future Reviewer
  mention started review before QA and split the root into separate tasks.
  Reviewer explicitly reported missing tests; the attempt failed its deadline.
- The third attempt reached QA and received the provider's uncached input-token
  per-minute refusal. No billing/provider/user configuration was changed.
- The fourth recovery probe failed to find its retry control. Its opening user
  prompt inadvertently contained the literal Verifier mention, invoking the UI's
  immediate manual handoff before implementation. The captured failure and
  startup screenshot are retained. This was a driver setup error, not evidence
  of an ordered journey succeeding.
- The fifth probe used plain names in the opening user prompt and completed
  real Builder (7 tool calls), QA (11) and Reviewer (2) on one two-hop parent,
  returning REVIEW_VERDICT to Builder. It then failed an overly specific probe
  assertion requiring `read_file`: Reviewer actually read both files using
  `cat README.md clamp.mjs clamp.test.mjs` and independently ran the tests.
  The original failed result is retained. Corrected validation requires actual
  reads of both files through either authorised path, not a generic tool call.
  `node scripts/verify-collaboration-live-evidence.mjs` passed on those retained
  receipts, independently running the generated suite (**7 tests passed**) and
  four contract assertions. Evidence: `live-collaboration-verified.{log,json}`.
  This artifact validation did not reopen the live browser after restart;
  controlled restart/receipt evidence remains separate.

Artifacts are in `.codex-artifacts/reliability/`, including
`live-collaboration-first` through `live-collaboration-fourth` logs/JSON and the
current `live-collaboration.json`. Source role provisioning uses the real runtime,
configured account/provider, selected disposable project, and no response fixtures.
The prepared test roster is seeded; this is separate from clean onboarding proof.

The real browser confirmed QA-created channel, committed receipt and completed purpose execution remain unchanged when a source-conversation Retry resumes only its failed review after restart. Focused evidence is `collaboration-source-child-retry-final.log`; source-error Retry regression/fix evidence is `collaboration-source-retry-{red,final}.log`.

Channel-action receipt reuse, current permission rechecks, stopped deliveries and
channel deletion/tombstones already have backend and browser evidence in
checkpoint 3. Arbitrary file/command side effects are inspect-before-retry, not
transactionally deduplicated. Browser coordination still requires an open app;
legacy handoffs lack dependency links, and task conflict resolution across windows
is deferred. README/CONTRACT/DESIGN/CHANGELOG and ADRs 0079–0081 carry these bounds.

## Checkpoint 7 — final regression

Status: complete for the documented local/runtime scope. The final current `bun run ci` passed (exit 0), the full 11-case browser suite passed, and qualified real-provider collaboration evidence passed. Earlier failures are retained above. Existing tests are retained; no critical regression is
accepted merely to obtain green output.

## Checkpoint 8 — engineering handover

Status: complete. The preceding sections are the
reviewable engineering report: baseline, causes, changes, competitor dispositions,
commands/results, documentation and proof limits. Major components changed are
`server.mjs`, channel persistence/action routes, shared member profiles, onboarding
and member creation, `src/App.jsx`, chat/handoff recovery, runtime packaging and
the associated regression scripts. Unrelated work in the original dirty checkout
has been preserved. No commit, push, deployment or publication was performed.

Remaining issues and recommended actions:

| Priority | Impact and evidence | Next action |
| --- | --- | --- |
| Verified boundary | Eleven current collaboration/retry/receipt cases pass. Real-provider implementation, QA and review return pass corrected receipt validation; live post-restart execution was not run in that probe. | Keep local restart proof distinct from live execution; an optional future live cold-reopen probe can extend it. |
| Resolved verification | An earlier aggregate stopped at an observer fixture deadline. The focused rerun and final full aggregate passed. | Retain the failed log; use bounded setup waits when cold-starting isolated browsers. |
| Medium | One earlier real QA turn returned a generic unclear response; an identical focused retry passed. Root cause remains unestablished. | Investigate recurrence without claiming a Squad code fix. |
| Deferred | Arbitrary tool effects and in-flight workflow crash resume lack exactly-once recovery. Legacy delegation records lack dependency links. | Inspect saved evidence before explicit retry; design a bridge-owned journal only if durable background orchestration becomes required. |
| Deferred | Optional lead/team templates, multi-human ACLs, cross-bridge proposal aggregation and native release verification. | Preserve the existing local product contract; prioritise separately from core reliability. |

The attached reliability brief is complete within the explicitly verified local/runtime scope. Changes are ready for review. The original pass did not certify a native release, deployment, or every provider and platform. The subsequent local installation review is recorded below.

## Local 0.1.6 candidate review, 2026-10-13

The user requested replacement of the installed 0.1.5 app and local inspection
before any GitHub publication. The source version was advanced consistently to
0.1.6 in the web package, desktop crate, runtime crate and local lock entries.
The prior native app, Squad state and native WebKit storage were retained in a
private rollback directory; unrelated working-tree changes were preserved.

The first installed candidate opened the real saved workspace but exposed two
channel failures that smaller fixtures had missed. The complete browser history
exceeded the generic one-MiB request limit, while the pre-installation saved file
contained an extra closing brace after its complete JSON document. The original
and pre-installation backup hashes matched. The verified document was recovered
without changing its six channels, 19 threads or 83 messages; the malformed
original remains backed up. ADR-0082 records the evidence, the bounded 16-MiB
history request budget, and why arbitrary malformed files still refuse writes.

The user also reported a GTM APAC leadership brief becoming Data Engineer.
The offline draft used the incidental word `pipeline` as a technical role hint.
Explicit commercial intent now takes precedence, the designer instruction
supports business roles, and the custom title can be corrected before creation.
The generated `Act as` identity line follows that edit while authored personality
text remains intact. ADR-0083 records this decision and the heuristic's limits.

Current focused evidence:

- `channel-history-red.log`: reproduces the original 413 on a real history PUT.
- `channel-history-browser.log`: all eight real bridge/browser lifecycle checks
  pass, including larger history, restart, bounded rejection, preserved files,
  and normal create/edit/member/delete controls.
- `gtm-draft-red.log`: reproduces Data Engineer for the commercial brief.
- `check-member-draft` and `check-member-introduction`: pass after the fix.
- `member-creation-final.log`: all five real bridge/browser checks pass; a custom
  GTM APAC title and instructions survive failed preparation and refresh and
  reach the saved runtime profile. Runtime/skill fixtures are explicit.

Artifacts above are under `.codex-artifacts/local-0.1.6/`. GitHub publication is
pending the user's confirmation. This adds local macOS installation evidence;
it does not certify a public release, notarization, other platforms, or live
execution of every feature.


Final command results (current source):

| Command | Actual result and boundary |
| --- | --- |
| `bun run ci` | Exit 0; JS/JSX and bridge guards, domain/API/runtime/permissions checks, production Vite build, daemon format, 75 unit tests, two binary tests and binary build. `reliability-final-ci.log`. |
| `node scripts/check-collaboration-cycle.mjs` | Exit 0; all 11 real-browser/bridge cases, controlled SDK. `collaboration-checkpoints-final-current.log`. |
| `node scripts/verify-collaboration-live-evidence.mjs` | Exit 0; retained real-provider receipts, final source return, generated tests 7/7 and four independent contract assertions. Original fifth live-driver read-tool assertion failure remains retained; live restart not run by this validator. |
| `node scripts/check-member-creation.mjs` | Five normal browser creation/recovery cases passed before final aggregate; separate from live first-role onboarding proof. `member-creation-final.log`. |
| `node scripts/check-member-config.mjs` | Seven damaged/non-object/unwritable config preservation cases passed; included again in final CI. |
| `node scripts/check-workflow-recovery.mjs` | Real API/disk across three restarts passed; controlled step completion. Included again in final CI. |
| `node scripts/check-computer-use-portable.mjs` | Actual archive/extracted route and 16-profile imports passed; native bytes/signatures remain fixtures. Included again in final CI. |
| `git diff --check` | Passed; no commit, push, deployment or publication. |

Documentation changed in the same working change: DESIGN, CHANGELOG, README,
SETUP_GUIDE, integration CONTRACT/workflows, competitor audit and this report;
ADRs 0072–0081 explain the persistence, recovery, runtime, creation, delegation
and packaging decisions and knowingly retained limits. The compiler emits its
existing chunk-size warning; Cargo reports an existing cache-clean permission
warning but finishes successfully. These warnings are not test failures.

Recommended next priorities are optional live cold-reopen/platform/provider
coverage, a bridge-owned delegation journal if background continuation becomes
a product requirement, and team/lead conventions only after the proven core
flows. They are explicit follow-on scope, not hidden unfinished implementations.

## Independent re-verification, 2026-10-13 (later)

A second pass checked the candidate against the running installed app rather
than the report's own logs. Findings, in order of what the user actually saw:

- The two channel errors in the screenshot came from the first installed
  bridge. `~/.autohand/squad/web-server.log` at 15:36 shows
  `route plug-in agent-channels.route.mjs failed to load` with the
  `line 11113 column 1` parser error: the damaged file made `init()` throw,
  and the loader drops a plug-in whose `init` throws, so that process had no
  channel event stream or proposal routes at all. The repaired file and the
  rebuilt bundle were in place by 15:52, but the bridge process from 15:36
  kept running the old code until the stack restarted at 15:55. The user's
  screenshot was therefore accurate for the process they had open.
- The origin of the stray brace is now established (ADR-0082 amendment):
  0.1.5 wrote `channels.json` with plain `writeFile` from both the snapshot
  PUT and the git route's per-poll mirror. Two truncating writers leave the
  longer document's tail behind the shorter one. The 3 surplus bytes are the
  `\n}\n` tail of a pretty-printed document.
- Three defects were fixed with tests written first (red, then green):
  the store now recovers that exact shape automatically, keeping the original
  as `channels.json.damaged-<timestamp>`; the agent-channels plug-in keeps its
  routes loaded when startup recovery fails and logs it; and the daemon's
  channel structs carry unknown fields through so a daemon write cannot erase
  messages, revision, tombstones or receipts. Running the user's actual
  damaged backup through the new store yields six channels, 19 threads and 83
  messages with the backup byte-identical to the original.

Browser checks that are not part of `ci` were also run, sequentially. Eight
pass. Two failed on the first pass and were investigated rather than rerun
blindly:

- `check:collaboration:browser` failed once with "first parallel verdict
  timed out" while another session's `cargo build` had the machine at a load
  average above 60. A rerun on a quieter machine passed all 11 cases. This
  is recorded as load, not product behaviour.
- `check:goals:browser` failed identically twice, so it was instrumented.
  Two defects were found and fixed with tests first (ADR-0068 and ADR-0066
  amendments): completed checklist items' `sr-only` labels escaped the Quick
  Chat scroll area and stretched the 380x520 window to 1293px, hiding the
  goal controls; and a goal rehydrated from the bridge was appended below
  newer replies without a timestamp, so Needs you previewed stale text.
  `node scripts/check-member-goals.mjs` is new and in `ci`; the full goals
  browser journey now passes with 22 screenshots.

Commands run on current source (all exit 0):

| Command | Result |
| --- | --- |
| 61 `check:*` scripts from `ci` except `check:web`/`check:runtime` | all pass; sequential run, logs retained in the session scratchpad |
| `node scripts/check-channel-lifecycle.mjs --api-only` | 8 checks (new torn-tail case red before the fix, green after) |
| `cd daemon && cargo fmt -- --check && cargo test -j1 -- --test-threads=1` | 76 unit tests (one new) and two binary tests pass |
| `bun run build` | production bundle builds |
| `git diff --check` | clean |
| 9 browser checks outside `ci` (channel lifecycle, agent channel actions, onboarding recovery/browser, channels, member creation, collaboration, goals, work profile) | all pass after the two fixes above; collaboration passed on rerun without load |

Installed candidate after these fixes:

- `bun run ci` exit 0 on the final source
  (`.codex-artifacts/local-0.1.6/recovery-final-ci.log`): the new member-goal
  check, 76 daemon unit tests, two binary tests, production build and binary
  build included.
- The web bundle, staged runtime and native shell were rebuilt
  (`web-build-recovery.log`, `stage-desktop-recovery.log`,
  `native-build-recovery.log`). The previously installed app was kept at
  `private-backup/Autohand Squad 0.1.6-first.app`, the stack was stopped,
  the bundle copied to `/Applications`, and `verify-installed.py` rewrote
  `installed-receipt.json` with 341 runtime files matching current source.
- Launching by name with `open -a` silently started nothing after the bundle
  was replaced in place; `lsregister -f` on the bundle followed by `open` with
  the full path started the shell under launchd, with the bridge answering in
  six seconds. The live bridge serves the real workspace (eight channels, 22
  threads, 93 messages, revision 6), `/api/channel-actions` answers 200 and
  the plug-in line in `web-server.log` includes `agent-channels`.
- Stopping the stack ended two running member processes; the daemon binary
  has no `stop` subcommand (that belongs to the `squad` CLI sidecar), so the
  processes were terminated directly.

Still not verified here: a notarized public release, other platforms, and
live provider execution of every feature. Those bounds are unchanged.


### Final local workspace review, 2026-10-13

The locally installed 0.1.6 candidate now has one member workspace picker,
with assigned-folder search, direct native-folder application and path entry.
Selection validates the folder and saves the primary workspace before the next
request. The rendered workspace check passed all three scenarios, including
picker dismissal, reopen persistence, invalid/cancelled choices, failed saves
and the folder carried by a controlled next chat request. It did not invoke a
provider. Logs: `member-workspace-browser.log` and
`member-workspace-dismissal.log` under `.codex-artifacts/local-0.1.6/`.

Alex’s prepared GTM profile survived the old browser roster quota failure.
After preserving a SQLite backup and stopping the app/runtime, a targeted local
repair restored Alex’s existing ID. The other eight roster records were
unchanged. Native inspection and a full quit/runtime-stop/reopen confirmed
nine members, Alex as GTM APAC Leader, and the selected valid dark-web-cli
folder. The old app and original saved state remain available for rollback.

The member-creation run passed four cases but its first case hit a Chrome
DevTools setup timeout. Rerunning that case alone passed. These are controlled
bridge/browser checks with fixture skills/runtime, not new live-provider proof.
The local-cache check now also verifies that an initially quota-blocked roster
write succeeds without losing history. JSX imports (120 files), bridge imports
(64 files), member drafting/introduction, the production web build, full native
build, strict whole-bundle signature and 341 packaged runtime file comparisons
passed. All original six channels, 19 threads and 83 message IDs remain in the
running bridge (now eight channels, 22 threads and 93 messages).

The installed candidate was built at `2026-10-13T03:36:33.630Z`; its executable
SHA-256 is `65f54a584ba20e77c17ba2ee6af1f1362a7887eb2d879bc8d43fcde2b25d29b5`.
The running app-info endpoint matches the installed receipt after restart.
This is an ad-hoc-signed local review build; no GitHub version was published.

### Reply timing and timeout review, 2026-10-13

The current local candidate supersedes the workspace-review build above.
Long durations use named units, including `1 hour 35 min`. Oversized final
diagnostics preserve the final answer or failure and its duration, retaining
received work details with a visible limitation. Late progress cannot reopen
a terminal timer. Claude Code and Codex chats renew a five-minute silence
window while parsed activity continues, with a separate 45-minute ceiling;
background job deadlines and goal pursuit boundaries remain independent.

Focused duration, shared-conversation, real subprocess timeout, adapter,
JSX-import, bridge-import and chat-recovery checks passed. The rendered browser
check consumed an oversized controlled error stream, verified a frozen
five-minute failure and Retry, then retried into a new completed reply showing
hours. Both replies survived reopening. This used an isolated bridge and no
vendor provider. Logs and browser screenshots are under
`.codex-artifacts/local-0.1.6/timeout-review/`.

The runtime had recorded Alex’s failure five minutes after startup while the
browser kept its row loading. After backing up the current SQLite state, a
targeted repair applied that failure receipt to the exact stale reply, preserving
its original partial text and received work details. The installed native app
now shows `5 min`, “Could not answer”, the timeout cause and Retry, with no active
timer. All nine member identities, roles and workspaces, every saved message ID,
and the complete channel-history file survived replacement. Alex remains the
GTM APAC Leader in the user-selected `leads` folder.

The installed 0.1.6 candidate was built at `2026-10-13T06:32:28.980Z`; its
executable SHA-256 is
`b6356aa2633a5d86372b17c9c6875956e325493a95390330c414eae7013008d0`.
Strict signature verification and comparison of 343 packaged runtime files
passed; the running app-info receipt matches. The app is open on Alex’s chat.
The previous bundle and pre-repair SQLite state are retained for rollback.
This is an ad-hoc-signed local review build. A live long-running provider turn,
notarization, other platforms and a GitHub release were not performed here.
