# ADR-0255: Squad iCloud helper and the iCloud route for phones

Status: proposed — phase 1 code is built and tested against fakes; no
CloudKit request has run yet because the Apple Developer portal steps
(container, App IDs, profiles) are waiting for the owner's approval.
Design and Apple evidence: squad-mobile ADR-0007. Routes: ADR-0228 (desktop)
and squad-mobile ADR-0005. Signing pattern: ADR-0247, ADR-0248. Checks:
`scripts/check-mobile-icloud.mjs` (part of `bun run check:mobile`) and
`swift test --package-path native/icloud-helper`.

## Context

squad-mobile ADR-0007 chose CloudKit's private database, a custom zone and
native code on both ends as a second off-network transport next to the
Autohand relay, and set phase 1 as: a helper and a phone build that send
`snapshot` both ways, then measure. This record covers the Mac half: what
runs CloudKit, how the bridge talks to it, how it is packaged and signed, and
what stays off.

What the Mac already had, read before changing it:

- Every route ends in `service.packet(packet, via)` (`server/mobile/service.mjs`):
  `http.mjs` for local and tunnel, `relay.mjs` for the relay. Receipts make a
  retried request return its stored reply. `via` was `local | relay`.
- `controller.mjs` keeps independent route switches (`local`, `relay`,
  `tunnel`) in `config.json`, validated by a `.strict()` zod schema.
- The Computer Use host is pre-signed by its stager (ADR-0248) and copied in
  as a resource; Tauri then signs the outer app with
  `src-tauri/entitlements.plist` (JIT, unsigned executable memory, library
  validation off) and the hardened runtime.
- ADR-0007 evidence item 4: a bare binary claiming iCloud entitlements was
  SIGKILLed at launch (exit 137); without them CloudKit trapped (exit 133).
  So CloudKit needs a bundle with an embedded profile, and nothing may touch
  CloudKit in an unentitled process.

## Decision

### A nested helper app, not the main binary

`Squad iCloud.app` (`ai.autohand.squad.icloud`, `LSUIElement`, hardened
runtime) lives at `Autohand Squad.app/Contents/Helpers/`. Source:
`native/icloud-helper` (Swift package: `SquadICloudCore` library with the
record contract, retry policy and `HelperEngine`; `SquadICloud` executable
running an `NSApplication` loop so it can register for remote
notifications). Keeping it separate means the restricted iCloud entitlements
and their profile never touch the main Tauri binary, whose JIT and
library-validation exceptions stay as they are, and the main
`ai.autohand.squad` App ID does not change.

The helper checks its own entitlement
(`SecTaskCopyValueForEntitlement(... icloud-container-identifiers)`) before
anything imports a CloudKit object. Without it, it prints
`{"op":"status","state":"unentitled"}` and waits for `stop` or end of
input. Verified on this Mac with the ad-hoc build:
`printf '{"op":"start","computerID":"c1"}\n' | "Squad iCloud"` printed exactly
that line and exited 0 on `stop` and on EOF, instead of exit 133/137.

### Bridge ⇄ helper: newline-delimited JSON on stdio

`server/mobile/icloud.mjs` spawns the helper's executable
(`stdio: ['pipe', 'pipe', 'ignore']`) and exchanges one JSON object per line:

- bridge → helper: `start {computerID}`, `poll`,
  `packet.out {inReplyTo, peerID, packet | status}`, `offer.publish {offer}`,
  `offer.withdraw`, `revoke {peerID}`, `stats`, `stop`.
- helper → bridge: `status {state, detail}` (`starting | ready | noAccount |
  quotaExceeded | offline | rateLimited | unentitled | error`),
  `packet.in {id, packet, ageMs}`, `stats {...}`, `error {detail}`.

The helper never opens a packet. It reads `Packet` records addressed
`mac:<computerID>`, refuses unread (deletes) any past `expiresAt`, and hands
each fresh one to the bridge once. The bridge calls
`service.packet(packet, 'icloud')`, so receipts, clock checks, device keys
and refusals are exactly those of the HTTP and relay routes. A refusal the
HTTP route would answer with 401/403/409/429/400 travels back as a `status`
record with no payload (anything else becomes 503), so the phone's "no longer
recognises this phone" works the same over iCloud. The helper writes the
reply addressed `phone:<peerID>` with `inReplyTo` = the request's record
name, then deletes the request; a lost delete is left to the hourly sweep and
a re-read request gets the stored receipt (checked: same reply bytes, one
execution). Pushes, wake from sleep and a 60-second timer all mean "fetch
zone changes now". `revoke` deletes the phone's records. A crash restarts
with backoff up to 60 s; `unentitled` is final until the next start.

The record contract (zone `squad-mobile`, types `Packet` / `PairingOffer`,
fields `to`, `expiresAt`, `inReplyTo`, `status`, `encryptedValues.packet`,
`asset` over 900 KB) is defined twice, in Swift on each side, and must stay
identical: `native/icloud-helper/Sources/SquadICloudCore/Records.swift` and
squad-mobile `Sources/SquadMobileCore/Cloud/CloudRecords.swift`.

### Off by default, at every layer

- `config.icloud` defaults to `false`; files saved before it parse unchanged
  (checked with 0.1 `{mode}` files and 0.1.22 route files).
- The controller starts the helper only when `icloud` is on **and** a helper
  exists (`resolveICloudHelper`: `AUTOHAND_SQUAD_ICLOUD_HELPER`, else
  `Contents/MacOS/../Helpers/…` beside the bundled node; never off macOS).
  Turning it on without a helper is refused with a sentence; a helper that
  fails never fails the other routes.
- `{kind: "icloud"}` (no endpoint) is added to a phone's encrypted
  `snapshot.routes` only while the helper reports `ready`. Older phones
  ignore unknown kinds (squad-mobile ADR-0005). It never appears in a QR,
  and iCloud alone cannot make a pairing offer (a QR needs an address).
- Settings › Computers shows a fourth switch, **Through iCloud**, only when
  `status.icloud.available`, i.e. in a build that carries the helper. Today's
  builds show exactly the three switches they showed before.
- `scripts/build-native-shell.mjs` nests the helper only with
  `AUTOHAND_SQUAD_ICLOUD=1`. The release workflow does not set it.

### Packaging and signing (the ADR-0248 order)

`scripts/build-icloud-helper.mjs` builds the Swift product for the target
arch, assembles the bundle in `src-tauri/helpers/`, and signs it with the
release identity resolver (`releaseSigningIdentity`) and `signMacCode`
before Tauri runs; `assertReleaseSignature` then requires the team, hardened
runtime and timestamp for a real identity. With a profile
(`AUTOHAND_SQUAD_ICLOUD_PROFILE` / `--profile`) it embeds it as
`Contents/embedded.provisionprofile` and derives the entitlements **from the
profile**: it refuses a profile for another App ID, one without the
container, or one without CloudKit, and sets
`com.apple.developer.icloud-container-environment` to `Production` unless
the profile allows debugging. Without a profile it signs with no iCloud
entitlements and the helper reports `unentitled`. `build-native-shell.mjs`
passes Tauri a `--config` merge adding
`bundle.macOS.files["Helpers/Squad iCloud.app"]`, so Tauri copies the signed
bundle and then signs the outer app around it.

## Evidence (what was run, 18 Nov 2026, Xcode 27.2, macOS 27.2)

- `swift test --package-path native/icloud-helper`: 13 tests, 0 failures
  (engine: only this computer's fresh requests, once; expired refused and
  deleted; reply addressing and request removal; refusal as status;
  `requestRateLimited` waits CloudKit's retry-after and is counted;
  account/quota errors become states; expired token and deleted zone
  recover; sweep and revoke stay within 400 per operation; one live offer;
  a push only fetches. Wire parsing, limits, retry policy).
- `node scripts/check-mobile-icloud.mjs`: PASS, including the real ad-hoc
  helper reporting `unentitled` when spawned by the bridge.
- `bun run check:mobile` (all five scripts): PASS. `check-mobile-host.mjs`
  now expects `icloud: false` in every saved and returned config.
- `bun run check:jsx`, `bun run check:server`, `bun run build`: pass.
- `node scripts/check-mobile-interop.mjs <squad-mobile lane checkout>`:
  PASS (the phone's CryptoKit client against this host, unchanged routes).
- Signing order, outside Tauri: a minimal outer app with the helper nested at
  `Contents/Helpers/`, the helper signed first with the Developer ID
  (hardened runtime, timestamp, iCloud entitlements, never launched), then the
  outer app signed without `--deep` using `src-tauri/entitlements.plist`
  exactly as Tauri's arguments do (`--force --options runtime --entitlements`).
  `codesign --verify --deep --strict` passed and the nested helper still
  carried `iCloud.ai.autohand.squad`, team J59GX2DRN2 and its timestamp.
- **What was not shown: Tauri itself.** The Tauri CLI binary lists
  `Frameworks`, `Helpers`, `XPCServices` and `Libraries` together, which
  suggests it signs code it finds under `Contents/Helpers` on its own. If it
  does, it may re-sign the helper without its entitlements. The full signed
  build (`AUTOHAND_SQUAD_ICLOUD=1`, the lane's recipe) was started and failed
  in `desktop:stage` with `No space left on device (os error 28)` while
  compiling the daemon: the disk had 230 MB free. So
  `build-native-shell.mjs` now checks the built app after Tauri and fails
  the build when the nested helper lost its iCloud entitlements or the app
  does not verify; that check has not yet run against a real Tauri build.
- Portal and profile state on this Mac, read-only: no profile of any kind
  includes `com.apple.developer.icloud-*`; there is no macOS or Developer ID
  profile at all. The Developer ID Application identity
  (`9E688D5A…`, J59GX2DRN2) is present.

Not run, because each needs the portal steps that are waiting for approval:
an entitled helper, a CloudKit round trip, push delivery, notarization of the
nested helper, and every phase 1 number in ADR-0007. This ADR's phase 1
measurements section is deliberately empty until they exist.

## Consequences

- A Mac running a helper-carrying build, with the switch on, can answer a
  paired phone with no Autohand server in the path, through the person's own
  iCloud, using the same receipts and refusals as the other routes.
- **Traded away / left undone:**
  - No CloudKit request has run. Latency, push arrival with the app
    backgrounded and the display asleep, `requestRateLimited` frequency in a
    50-message burst and 24-hour quota use are unmeasured. The bridge exposes
    `GET /api/mobile/icloud/measurements` (helper counters plus p50/p95 of
    request age on arrival) for that run; nothing in the UI promises speed.
  - The record contract is duplicated in two Swift packages in two repos;
    a change on one side without the other breaks the route silently.
    Nothing checks them against each other yet.
  - The Mac polls every 60 s as the floor. If pushes do not reach a nested
    helper started by Node rather than LaunchServices, phone requests could
    wait up to a minute. Whether they do is a phase 1 question.
  - The helper is built for one arch per build (`--arch`), matching the
    per-arch DMGs; no universal build.
  - `encryptedValues` is used unconditionally. ADR-0007's fallback for people
    without iCloud Keychain (plain bytes, AES-GCM only) is not implemented;
    what CloudKit does in that case has not been observed.
  - Pairing without a QR is half done: the Mac publishes the `PairingOffer`
    on Connect a phone and withdraws it on approve/decline, and the phone can
    read and validate offers, but no phone screen offers "Pair with <Mac>".
    An offer left after expiry is replaced by the next one, not swept.
  - "Apple only" (relay off, iCloud as the only away route) is not offered;
    the existing rule that one of Same Wi-Fi, relay or tunnel must be on
    still applies.
  - Tauri's handling of `Contents/Helpers` is unverified (see Evidence). If it
    strips the entitlements, the fix is to sign the helper again after Tauri
    and re-sign the outer app, or to nest it as a resource as the Computer Use
    host is; neither is built.
  - The release workflow, notarization and `verify-macos-signature.mjs` do
    not know about the helper yet; a release build with
    `AUTOHAND_SQUAD_ICLOUD=1` would nest it but nothing verifies its
    signature after Tauri signs the outer app.
  - Windows and Linux are unaffected and cannot use this route.
