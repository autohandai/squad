# Updates and announcements verification

Date: 2026-11-03. Source baseline: Squad `837ec2f`, site `0fe5507b`, API `f0721f7`.

Follow-up: 2026-11-04. PR 45 merged at `15cfe4c`; immutable tag `v0.1.17`
targets that merge. Release workflow [41715030042](https://github.com/autohandai/squad/actions/runs/41715030042)
was canceled before publication when native preflight found the saved-workspace
alias regression described in ADR-0172. The compatibility fix ships in 0.1.18.

PR 46 merged as `b023c07e5023ea45d2144397c4ce2a2e07bc9944`; its tree is
identical to the checked head `1d49516`. All 12 jobs passed in
[CI 41721686084](https://github.com/autohandai/squad/actions/runs/41721686084),
including the four installer dry runs and combined manifest validation. The
merged commit then passed all 12 jobs again in
[main CI 41726498689](https://github.com/autohandai/squad/actions/runs/41726498689).
The immutable `v0.1.18` tag targets that merge. Its official release run is
[41726551313](https://github.com/autohandai/squad/actions/runs/41726551313).

All 117 local stages passed across the initial and resumed runs on this diff.
The first invocation stopped at stage 90 when the responder fixture bridge
failed to restart. A standalone responder replay passed, then stages 90–117
passed sequentially. The original failure log is retained. This is not a clean
single aggregate invocation, and no root cause or product fix is claimed for
the restart timeout. No production code changed after these checks.

Final screenshot review found the update fixture still pointed its news client
at the live service with test credentials. The test-only follow-up uses its
existing loopback server for an empty news feed and asserts that read occurs.
All six desktop/phone Playwright cases pass after this correction. ADR-0171
records the finding; the tagged release's installed runtime is unchanged.

## Requirements and current proof

| Requirement | Evidence | Boundary |
| --- | --- | --- |
| Discover a newer version and display it | Failing stale-completion regression reproduced, then passed; daemon/app mismatch covered | Fixture release discovery |
| Configurable automatic downloads, explicit install consent | `check:automatic-updates`; real flow/checksum/files, concurrent callers/restarts and cancellation; no automatic install | Fixture binary never executed |
| Preferences on Updates and saved across reload | Playwright desktop/phone, real bridge settings; concurrent patch preservation checked | Local rendered UI |
| Visible checks/errors and an accessible upgrade notice | Playwright checks failure recovery, Review/Later and sidebar-hidden behavior; existing `check:updates:browser` passes | Mocked installer actions |
| Squad admin authoring | Site Playwright: two passing desktop/phone cases for notice/modal and exact audience | Mocked admin endpoints; no published content |
| Feed/reading/dismissal | `check:announcements`; API focused suites: 58 passing tests, including real D1 targeting and per-user dismissal | API fixture auth in tests |
| Repeatable UI regressions | Eight passing Playwright runs (two repetitions of both scenarios at desktop/phone), followed by four passes after adding valid media fixtures and dark update mode | Chrome, not native WebKit |
| Additional interaction guards | Six passing desktop/phone cases cover failed preference saves and deferral of automatic announcement modals while another dialog is open | Isolated local bridge |
| Release-failure regression | `AUTOHAND_CHECK_CPU_THROTTLE=6 AUTOHAND_CHECK_WAIT_SCALE=3 node scripts/check-chat-attachments-browser.mjs` passed, including saved/reopened file history | Real bridge, fixture harness |
| Source/build integration | JSX imports, bridge imports, release workflow/packaging contracts, lifecycle checks and Squad build pass. Site build and frozen install with Bun 1.4.0 pass. API typecheck passes | Local |
| Aggregate local CI | Complete `bun run ci` exited 0 across 116 sequential stages on the diff committed as `4aa0d20`, using Node 22.23.2 and the installed Rust 1.97.1 toolchain on PATH | Fixture engines and local rendered checks; no live provider claim |
| Hosted CI | Run 41601101968 passed all 12 jobs at `ee40b5d`, including the new member-contract gates, all four release dry runs and combined manifest validation | The merged `15cfe4c` tree is identical to that checked tree |
| Main CI | Run 41714861612 passed at merged `15cfe4c` | Before the 0.1.18 compatibility fix |
| Compatibility fix CI | Run 41721686084 passed all 12 jobs at `1d49516` | Same tree as merged/tagged `b023c07`; final .18 source |
| Final merged CI | Run 41726498689 passed all 12 jobs at `b023c07` | Exact release source |
| Published release | Run 41726551313 passed all 12 jobs; stable `v0.1.18` published at 2026-11-03T22:37:36Z with 42 assets | Official installers; macOS uses ad-hoc signing, without notarization |
| Dedicated update feed | Live HTTP 200 returns 0.1.18 and the official 170769317-byte Apple Silicon DMG with checksum `dddc999c36831d93a5b8dbf64542b4e2db983b6d50f49e06ed5d56f0087bb4b6` | Feed readback after successful publication |
| Saved workspace compatibility | The real bridge regression failed with HTTP 400 before the fix and passes with alias identity, permission-key preservation and outside-home refusal; read-only preflight accepts all 16 existing saved workspace folders | Two other saved folders were already missing; no user project was modified |
| Installed native app | Computer Use opened account → Settings → Updates and clicked Check for updates. Installed UI still shows 0.1.16/public 0.1.14 and old controls | Baseline inspected; new build not installed |

## Remaining native evidence

The final hosted checks passed, including the three added member-contract gates.
The public release and dedicated feed are verified. The native installation
check remains required before calling the complete goal verified. Following
publication, native capture failed across apps; a read-only IORegistry check
reported `CGSSessionScreenIsLocked=true`. The user was asked to unlock the Mac.
This explains this capture failure, without assigning a cause to older errors.
The installed app remains 0.1.16 at `0c8940e`; it and the complete saved data
have been backed up and have not been replaced. The native flow will use the
official published installer after unlock, with another idle check and fresh
backup. The API and editor deployments below are verified. No production
announcement was sent.
The earlier merge-blocker diagnosis was incomplete: the rules list two reviews
and a Dependabot context, but GitHub reports `viewerCanMergeAsAdmin=true` for
the authenticated account. Using that existing permission merged PR 45 without
changing repository rules. ADR-0167 retains the correction and evidence. Website
`public/docs-manifest.json` was already modified and is excluded from the PR.

## Integrated and deployed announcements

- API PR 24 merged as `f0cf8c0ea2c524ad0550c8b144dcc1089d548f65`. Its final
  focused workflow 41590745120 passed. Production Worker version
  `77b3e62f-3591-47c1-abd9-030a5d0c47d3` serves 100% of traffic, confirmed by
  deployment readback. The normal read-only billing preflight verified 24
  accounts with zero missing anchors and zero writes. The entitlement canary
  passed after deployment. Authenticated live readback returned HTTP 200 for
  Squad announcements (empty feed) and the model catalogue (13 models).
- Site PR 78 merged as `50837565ac855a3860153748709c67a29b6dc068`; workflow
  41590525902 passed. Deployment `6861b88a-f66f-4835-b234-26580f77f07f` is the
  production Pages deployment at that source. The public
  `AnnouncementsManager-BREwLvAN.js` returned 200 and exactly matched the built
  bytes, SHA-256 `81eef2f8ec6342e25183eaa0467edc717f1b0d0de67df29297b1cd5e082706d4`.
- Both deployments used fresh main worktrees and the existing repository
  scripts/guards. Only the site's generated manifest timestamp differed after
  building, which the official production helper explicitly permits.
- A fresh production readback on 4 November confirmed API deployment
  `e6ad76c1-8dad-40b0-9e5d-895d9fd26b02` still routes 100% to Worker version
  `77b3e62f-3591-47c1-abd9-030a5d0c47d3`; Pages still serves production
  deployment `6861b88a-f66f-4835-b234-26580f77f07f` at source `5083756`.
- Broader API validation on merged main found 12 failures in pricing and
  team-memory tests; the same 12 failures reproduce on its exact pre-change
  parent `b93732e`. No new failure was introduced by the announcement diff.
  The complete API suite is therefore not reported green; focused announcement
  tests, typecheck and live deployment canary are separate evidence.

## CI findings corrected during final validation

- Rust was present at `.rustup/toolchains/1.97.1-aarch64-apple-darwin/bin`;
  only its usual command shims were missing. Using that existing explicit path
  resumed the aggregate without installing a toolchain or changing shell setup.
- A native candidate at source `55095c5` built and passed deep/strict code
  signature validation. It is locally ad-hoc signed and not notarized. Later
  CI fixes require rebuilding before installation.
- Hosted Squad CI 41590739539 passed all four runtime targets but failed
  browser member-routing receipt projection. ADR-0169 records the actual
  field-loss cause and a deterministic failing-then-passing regression.
- The full aggregate also found stale schedule-prompt assertions and a real
  agenda/admission integration bug (ADR-0170). After correction, always-on's
  61 checks and queue admission across all four harnesses passed. A work-plan
  check timed out once under parallel build/test load; its standalone replay
  passed all 76 checks. This observation is not called a proven timeout fix.
- The initial 60-check sweep failed `check:member-profiles` (two skill-discovery
  expectations, already recorded as outstanding in ADR-0157),
  `check:agent-channel-actions` (`failed` versus expected `blocked`), and
  `check:member-by-chat:browser` (new-member-save timeout). These checks are not
  part of the hosted release gate. ADR-0171 records their independently
  reproduced fixture causes and corrections. The three checks pass on their
  own and in the complete 116-stage aggregate; they are now added to hosted CI
  and release gates. Production validation rules were not relaxed.
- Browser release fixtures now derive the running version from package.json,
  with newer candidate/daemon versions. The immutable failed `v0.1.16` tag is
  preserved. The 0.1.17 release was canceled before publication; 0.1.18 carries
  the alias fix with matching package and Cargo versions.
- The member-by-chat fixture now supplies only its known checkout as the
  runtime default workspace. It keeps real provisioning and profile receipts;
  it no longer depends on the person's legacy Documents symlink. The channel
  fixture reads the current request instead of a truncated historical request,
  and verifies removed members never reach the engine. The skill fixture keeps
  authored bytes unchanged after pinning and verifies the restored revision.
- Native follow-up attempts encountered `cgWindowNotFound` and
  `AXError.cannotComplete`. These automation errors are not installation proof.
  The backed-up app, data and WebKit store remain intact.
- Hosted run `41600308306` at `4aa0d20` caught another profile-fixture
  dependency after the complete local pass: its fake Codex executable was
  installed but the fresh runner had no sign-in. The fixture now supplies an
  explicitly fake key to its controlled child, preserving real readiness
  checks without using personal credentials. Final hosted run 41601101968
  passed at that correction. ADR-0171 retains this correction rather than treating the
  local aggregate as proof of a fresh unsigned-in machine.

Browser captures/traces live under `.codex-artifacts/updates-playwright/` and
the site's `test-results/squad-announcements/`. CI retains update test artifacts.

## Environment findings

The site's shell selected Homebrew Bun 1.2.22, which cannot parse its existing
lockfile version 2. An explicit `/Users/igorcosta/.bun/bin/bun` (1.4.0) completed
`install --frozen-lockfile` with no changes. This was an environment mismatch,
not a reason to regenerate the lockfile. The local aggregate also needs a Rust
toolchain on PATH; hosted Squad workflows explicitly install Rust.
