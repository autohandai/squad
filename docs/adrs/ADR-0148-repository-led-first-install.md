# ADR-0148: Repository-led first install with one coordinator

Date: 2026-10-27
Status: Accepted

## Context and evidence

A new user reported seeing an existing team before creating anyone. The first
hypothesis was that packaging copied the developer's preferences. The repeatable
source regression instead printed four default members (Eva, Noah, Iris, Kai)
and two channels (general, release-reviews) from `src/data.js`, then failed the
assertion that fresh defaults contain no demo specialists. `mergeSeedAgents`
also filled missing defaults on reload. These were product source defaults,
not evidence of copied local preferences. Existing installations can legitimately
have additional members and channels, so deleting names from their saved roster
would erase user choices.

The old FirstRun accepted one folder, offered a role to create, and allowed
signed-in users to skip. The browser was the authority for completion and the
bridge roster hydration only patched known local members: an empty browser
could not recover an existing coordinator. Folder profiles already read bounded
project metadata and Git context, and role recruiting already ranked needs.

The fresh-window browser regression then exposed a second assumption: `/`
rendered a Conversation before redirect and roster hydration, dereferencing
`agent.launch` on an empty roster. Keeping a fake seed would conceal it. Empty
and recovering conversation/profile routes now render a quiet waiting/empty
surface until a real member is available.

## Decision

Ship empty roster/channel/history defaults. First run requires one or more
Git repositories, validated again by the bridge at completion. Collapse aliases
and subfolders to canonical Git roots and observe the configured project limit.
Analyze project metadata deterministically, aggregate needs across repositories,
and name the repositories and responsibilities behind each suggested role.
Analysis performs no provisioning, channel creation, model turn or schedule.

The explicit Start action provisions one neutral **Chief of Staff** on the
Autohand harness, assigns every selected repository, and creates one public
`#general` channel with that member as lead. No personal memories or past work
are supplied. Use the existing profile provisioner and member-access store.
The bridge's `onboarding.json` saves a preparation identity before provisioning
and a completion receipt after the coordinator and channel are durable. Serialize
finish requests in the single-instance bridge. Retries return the same receipt;
they never resurrect a removed coordinator or channel. Hydrate saved roster
members as well as patches in a new browser, excluding the internal designer.

The setup guide retains recommendations after completion. Review opens the
normal editable member form with that role and repository. Only Save member
creates it; the recommended role has a separate recoverable creation draft.
Creating a team through the existing explicitly requested New team/channel-goal
operations remains a distinct user action, outside automatic onboarding.

Preserve existing saved squads, deleted-member decisions and appearance
preferences. Existing completed/skipped onboarding is not made mandatory again.
An installation with canonical team/channel state is recognized as existing,
even when this version has no setup receipt. Never reset an operator's data to
simulate a new installation.

## Validation

`node scripts/check-fresh-install.mjs` uses actual disposable Git repositories,
an isolated bridge/account fixture, real profile provisioning and clean Chrome
profiles. It covers project types, multiple roots, invalid selection, no implicit
creation, required setup, saved choices, recovery, concurrent finish, canonical
roster restoration and explicit specialist creation. Evidence is written under
`.codex-artifacts/fresh-install/`. No live model-provider execution is claimed.
Confirmed passes for this change:

- `node scripts/verify-onboarding-flow.mjs`: neutral defaults and durable
  failure/retry/deletion/corruption/existing-squad cases.
- `node scripts/verify-onboarding-browser.mjs`: account/provider readiness,
  Settings resume, existing roster/memory/appearance preservation, and the
  complete clean-install browser journey.
- `node scripts/check-fresh-install.mjs --runtime=src-tauri/runtime`: the same
  actual provisioning/restart/explicit-creation journey against the staged
  desktop server and built frontend, including narrow layout and System/Light.
- `node scripts/check-runtime-bootstrap.mjs --browser`: no global/bundled CLI,
  checksum refusal, visible retry, installation, restart and offline bundle use.
- `node scripts/check-member-creation.mjs`: five cases covering normal,
  recommended and custom member creation, authored drafts and lost responses.
- `node scripts/check-member-profiles.mjs`: six cases covering all 17 built-in
  contracts plus saved custom/external profiles, using a controlled SDK.
- Recruiting, member-roster, agent-channel-action, bridge-import and JSX checks,
  and `bun run build`.

These are local source/staged-runtime checks, not a newly installed native app,
published updater artifact, notarized release, or live-provider session. The
operator's running app and saved data were not replaced to run these checks.

The 0.1.10 release preflight subsequently found a portable-archive assertion
fixed at 16 role templates; adding the coordinator made the actual count 17.
The assertion now compares the full extracted catalog with the source contracts,
so it proves preservation without making future role additions a packaging error.

CI on that release attempt then caught a second duplicate catalog: telemetry's
static allowlist did not include Chief of Staff, so the role was classified as
custom. Its built-in IDs now come from the shipped role catalog; user-authored
roles and imported presets cannot expand it, and private names are still dropped.
The unpublished 0.1.10 build was canceled rather than publishing against failed
CI. The correction uses a new 0.1.11 tag; the old tag was not moved.
All 25 web-check/build commands from `.github/workflows/ci.yml` were then rerun
locally and passed, including product telemetry and release packaging. The local
command/results receipt is `.codex-artifacts/release-web-checks.json`.

## Consequences

- Repository selection is required for new installs; a non-Git folder must be
  tracked separately or replaced with a repository before continuing.
- Recommendations are bounded metadata heuristics, not an LLM assessment of
  source quality. Unknown projects can have no specialist suggestions.
- Startup shows setup without any pretend live member. The coordinator becomes
  a real member when Start successfully prepares it, not while picking repos.
- Existing demo-named members are intentionally not deleted: their names do not
  prove they are disposable. This fixes future installs without a destructive
  cleanup migration for existing users.
- The completion marker assumes the existing single-instance bridge owns the
  data directory. It is not a distributed lock for multiple independent servers
  writing the same directory. Browser tabs use the same serialized service.
- Clearing browser storage is now a recovery exercise, not a fresh-install test;
  the bridge restores canonical state. Clean-install verification must isolate
  both browser storage and the runtime's data directories.
