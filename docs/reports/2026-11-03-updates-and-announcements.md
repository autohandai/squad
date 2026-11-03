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
| Release-failure regression | `AUTOHAND_CHECK_CPU_THROTTLE=6 AUTOHAND_CHECK_WAIT_SCALE=3 node scripts/check-chat-attachments-browser.mjs` passed, including saved/reopened file history | Real bridge, fixture harness |
| Source/build integration | JSX imports, bridge imports, release workflow/packaging contracts, lifecycle checks and Squad build pass. Site build and frozen install with Bun 1.4.0 pass. API typecheck passes | Local |
| Aggregate local CI | `bun run ci` stopped at `check:memory`: `spawnSync cargo ENOENT` | Not a passing aggregate run; preceding SDK/harness/model routing stages passed |
| Existing hosted CI | Main run 41571476517 passed all 12 jobs at `837ec2f` | Baseline only, not new changes |
| Installed native app | Computer Use opened account → Settings → Updates and clicked Check for updates. Installed UI still shows 0.1.16/public 0.1.14 and old controls | Baseline inspected; new build not installed |

## Remaining release evidence

Hosted checks on the submitted changes, coordinated API/site deployment,
and a new native build/install check remain required before calling this shipped.
No production announcement was sent. The existing app and its saved data were
not replaced. Website `public/docs-manifest.json` was already modified and is
excluded from these changes.

Browser captures/traces live under `.codex-artifacts/updates-playwright/` and
the site's `test-results/squad-announcements/`. CI retains update test artifacts.

## Environment findings

The site's shell selected Homebrew Bun 1.2.22, which cannot parse its existing
lockfile version 2. An explicit `/Users/igorcosta/.bun/bin/bun` (1.4.0) completed
`install --frozen-lockfile` with no changes. This was an environment mismatch,
not a reason to regenerate the lockfile. The local aggregate also needs a Rust
toolchain on PATH; hosted Squad workflows explicitly install Rust.
