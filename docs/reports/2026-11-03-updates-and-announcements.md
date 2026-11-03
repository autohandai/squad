# Updates and announcements verification

Date: 2026-11-03. Source baseline: Squad `837ec2f`, site `0fe5507b`, API `f0721f7`.

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
| Aggregate local CI | `bun run ci` stopped at `check:memory`: `spawnSync cargo ENOENT` | Not a passing aggregate run; preceding SDK/harness/model routing stages passed |
| Existing hosted CI | Main run 41571476517 passed all 12 jobs at `837ec2f` | Baseline only, not new changes |
| Installed native app | Computer Use opened account → Settings → Updates and clicked Check for updates. Installed UI still shows 0.1.16/public 0.1.14 and old controls | Baseline inspected; new build not installed |

## Remaining release evidence

Squad hosted checks on the final source and the new native installation check
remain required before calling the complete goal shipped. The API and editor
deployments below are verified. No production announcement was sent. The
existing app and its saved data have not yet been replaced. Website
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

Browser captures/traces live under `.codex-artifacts/updates-playwright/` and
the site's `test-results/squad-announcements/`. CI retains update test artifacts.

## Environment findings

The site's shell selected Homebrew Bun 1.2.22, which cannot parse its existing
lockfile version 2. An explicit `/Users/igorcosta/.bun/bin/bun` (1.4.0) completed
`install --frozen-lockfile` with no changes. This was an environment mismatch,
not a reason to regenerate the lockfile. The local aggregate also needs a Rust
toolchain on PATH; hosted Squad workflows explicitly install Rust.
