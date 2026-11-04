# ADR-0173: Public macOS releases require signing and notarization

Date: 2026-11-04
Status: Accepted

## Context and evidence

The v0.1.18 release run [41726551313](https://github.com/autohandai/squad/actions/runs/41726551313) passed while publishing an ad-hoc-signed Mac app. Its macOS ARM64 job 126235198920 reported that APPLE_CERTIFICATE was absent, selected `-` as its identity, and later printed Gatekeeper rejection. The smoke test converted that rejection into a warning. A successful workflow therefore did not establish macOS distribution readiness. The earlier claim that the release checks were sufficient was wrong.

The existing local Developer ID Application identity belongs to Autohand AI Limited, team J59GX2DRN2. The certificate and selected private key match. A macOS-compatible PKCS12 export imports as one valid Developer ID identity in a temporary keychain. The approved existing App Store Connect API key authenticates to `notarytool history`. The actual new preparer was run with these credentials locally and passed identity import, Apple authentication and temporary-keychain cleanup. GitHub Actions secret metadata confirms the six Apple entries exist; secret values cannot be read back.

## Decision

Stable and nightly public release workflows fail closed. An early macOS job imports the real signing identity and authenticates notarization before downstream release builds. Every macOS desktop build repeats that preparation on its own runner. Missing, incomplete or invalid credentials block publication. A signed bundle must pass strict signature verification, `stapler validate`, and `spctl --assess` inside the actual DMG smoke test.

The GitHub APPLE_API_KEY secret holds the approved raw private key. Preparation writes it to a private temporary file and exports Tauri's APPLE_API_KEY as the key ID plus APPLE_API_KEY_PATH and APPLE_API_ISSUER. Certificate bytes, passwords and private keys never enter logs or checked-in files. Temporary keychains and files are removed. Apple ID notarization remains supported for installations already using that complete credential set; partial API credentials are an error, not a reason to fall back.

This is Developer ID distribution for direct downloads. Mac App Store submission is a separate distribution path.

## Consequences

Public Mac downloads can no longer silently downgrade to ad-hoc signatures. Invalid credentials or Apple's service being unavailable stop releases early, at the cost of an extra macOS runner and authentication request. Local previews may still use ad-hoc signing; their success does not prove public release readiness. Certificate expiration, revocation and API-key rotation remain operational responsibilities. Credential setup and local validation alone are not evidence that a published artifact is notarized: the new CI run and its actual artifact must establish that.

## Verification

`node scripts/check-apple-signing.mjs` exercises missing and malformed configuration and asserts the public workflow has no ad-hoc or ignored-Gatekeeper fallback. `scripts/prepare-apple-signing.mjs` was also exercised with the selected real local identity and approved notarization key. Public release smoke tests supply the artifact-level proof.
