# ADR-0173: Public macOS releases require signing and notarization

Date: 2026-11-04
Status: Accepted

## Context and evidence

The v0.1.18 release run [41726551313](https://github.com/autohandai/squad/actions/runs/41726551313) passed while publishing an ad-hoc-signed Mac app. Its macOS ARM64 job 126235198920 reported that APPLE_CERTIFICATE was absent, selected `-` as its identity, and later printed Gatekeeper rejection. The smoke test converted that rejection into a warning. A successful workflow therefore did not establish macOS distribution readiness. The earlier claim that the release checks were sufficient was wrong.

The existing local Developer ID Application identity belongs to Autohand AI Limited, team J59GX2DRN2. The certificate and selected private key match. A macOS-compatible PKCS12 export imports as one valid Developer ID identity in a temporary keychain. The approved existing App Store Connect API key authenticates to `notarytool history`. The actual new preparer was run with these credentials locally and passed identity import, Apple authentication and temporary-keychain cleanup. GitHub Actions secret metadata confirms the six Apple entries exist; secret values cannot be read back.

The subsequent v0.1.19 run [41769294789](https://github.com/autohandai/squad/actions/runs/41769294789) passed credential preflight but Apple rejected the ARM64 submission 5f6789aa-9415-4ee0-b48b-e4ce6125b693. Its log identifies missing secure timestamps on the nested Computer Use host and four engine files, and an ad-hoc, unhardened Autohand CLI in Resources. Tauri signed the main app and declared sidecars, not every resource executable. The first change fixed missing credentials and unsafe publication, but was insufficient for notarization. Publication and the update feed were skipped; v0.1.19 remains an unpublished immutable tag.

## Decision

Stable and nightly public release workflows fail closed. An early macOS job imports the real signing identity and authenticates notarization before downstream release builds. Every macOS desktop build repeats that preparation on its own runner. Missing, incomplete or invalid credentials block publication. A signed bundle must pass strict signature verification, `stapler validate`, and `spctl --assess` inside the actual DMG smoke test.

The GitHub APPLE_API_KEY secret holds the approved raw private key. Preparation writes it to a private temporary file and exports Tauri's APPLE_API_KEY as the key ID plus APPLE_API_KEY_PATH and APPLE_API_ISSUER. Certificate bytes, passwords and private keys never enter logs or checked-in files. Temporary keychains and files are removed. Apple ID notarization remains supported for installations already using that complete credential set; partial API credentials are an error, not a reason to fall back.

This is Developer ID distribution for direct downloads. Mac App Store submission is a separate distribution path.

Sign nested resource executables explicitly before the outer app: Computer Use engine files, the copied host executable and its bundle, and the copied Autohand CLI. Developer ID signing requests a secure timestamp and fails if it cannot obtain one; local ad-hoc previews explicitly omit it. The Bun-based CLI uses the existing desktop JIT entitlements. Verify pinned upstream bytes first, mutate only staged copies, and record the signed bytes afterwards. The CLI manifest preserves upstream checksums separately from its final signed checksum. Reused host inputs are re-signed at staging, so an old valid-but-untimestamped signature cannot bypass this step.

## Consequences

Public Mac downloads can no longer silently downgrade to ad-hoc signatures. Invalid credentials or Apple's service being unavailable stop releases early, at the cost of an extra macOS runner and authentication request. Local previews may still use ad-hoc signing; their success does not prove public release readiness. Certificate expiration, revocation and API-key rotation remain operational responsibilities. Credential setup and local validation alone are not evidence that a published artifact is notarized: the new CI run and its actual artifact must establish that.

## Verification

`node scripts/check-apple-signing.mjs` exercises missing and malformed configuration, timestamp failure propagation and CLI entitlements, and asserts the public workflow has no ad-hoc or ignored-Gatekeeper fallback. The portable composition fixture checks all six nested Computer Use signing calls and their order on macOS. These fixture checks do not establish Apple's acceptance. `scripts/prepare-apple-signing.mjs` was also exercised with the selected real local identity and approved notarization key. Public release smoke tests supply the artifact-level proof.

After correcting nested signing, the actual helper signed copies of the pinned 0.9.9 CLI, all four bundled Computer Use engine files and the existing host. `codesign -dv --verbose=4` showed team J59GX2DRN2, a secure timestamp and hardened runtime for all six inspected targets. The signed CLI successfully returned `0.9.9 (ec2372d5eb13620c22161b96d0c601fe4b0112ee)` from `--version`. These are local signing and execution checks, not a published or notarized Squad release.

An isolated test bundle containing those same signed files and the local native shell was then submitted to Apple. Submission 149d232e-251b-4f3e-b91d-cd0b9e2ccc96 was Accepted; stapling, `stapler validate` and `spctl --assess --type execute` passed with `source=Notarized Developer ID`. This establishes Apple's acceptance of the nested-signing correction in a fixture, while the actual release still requires its own notarization and DMG smoke test. The fixture was never published or installed over Squad.

The actual v0.1.20 desktop jobs in run 41798463350 then passed on both Mac architectures, including Tauri notarization and the mounted-app signature, stapler, Gatekeeper and runtime checks. Publication was still blocked by the separate Intel runtime test/build failures recorded in ADRs 0174 and 0178. These successful installers were not distributed as a partial release.
