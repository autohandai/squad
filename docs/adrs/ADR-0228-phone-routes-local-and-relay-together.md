# ADR-0228: phone routes — local network and relay together

Status: accepted. Amends ADR-0211 and ADR-0212. Phone side: squad-mobile ADR-0005.

## Context and evidence

The phone host had one exclusive `mode` (`local | tunnel | relay`) in
`server/mobile/controller.mjs`. On the owner's Mac a phone paired in `local`
stored `http://10.10.10.138:29323`. Switching the Mac to `relay` closed the
local listener, so the phone had no route left until it scanned a new QR. The
owner wants the phone to work at home and away with no extra steps, through
Autohand's own relay, and wants already paired phones to upgrade without
pairing again wherever that is cryptographically possible.

How the relay authorises a phone decided what "possible" means. Reading
`services/squad-api/src/mobile-relay.ts`: `forward()` accepts a device packet
only when `sha256(relayToken)` matches a `capabilities` row whose `device_id`
equals the packet's peer ID. That row exists only when a phone paired through
a relay QR: the offer's token is promoted to the device at approval
(`approve()`); `devices/sync` only deletes rows, it never creates one. So a
phone first approved locally has no token and the relay answers 403, however
valid its AES key. Nothing in the old protocol could hand it one.

## Decision

1. **Independent routes.** The saved configuration becomes
   `{enabled, local, relay, tunnel, endpoint, port}`. One HTTP listener serves
   both direct routes: it binds `0.0.0.0` when Same Wi-Fi is on and loopback
   when only the tunnel is on. The relay runs beside it. Settings shows three
   switches instead of a select (DESIGN.md). API callers still sending
   `{mode}` get exactly that one route, so older scripts keep their meaning.

2. **Migration of saved files.** A saved `mode: local` or `mode: relay` becomes
   local **and** relay on; `mode: tunnel` stays tunnel only. Fresh installs
   default to local and relay. This is the judgement most open to argument:
   it turns on the Autohand relay for someone who had chosen local only, and
   reopens the LAN listener for someone who had chosen relay only. We chose it
   because either half alone leaves one group of already paired phones stranded
   (a local pairing cannot learn the relay unless the relay is on; a phone
   paired locally before the Mac switched to relay cannot reach the Mac unless
   the LAN listener is back). A tunnel user already operates their own way in,
   so their choice is left exactly as it was.

3. **Standing relay grants.** New control call
   `POST /v1/mobile-relays/<room>/devices/grants {grants:[{deviceID, hash}]}`
   (authenticated like every other control call, max 20). The computer mints a
   256-bit token per approved device, sends only its SHA-256, and stores the
   token beside that device's key, scoped to the relay room. The relay keeps
   one `grant:<deviceID>` row per device; `pairing_id` values with a colon can
   never match a packet peer ID and the row has no pairing expiry, so a grant
   cannot route a pairing packet. Grants are re-asserted (idempotently, same
   tokens) after every `devices/sync`, and after each approval. Grants and
   revocations run in one queue so a late grant cannot resurrect a revoked
   phone. Revocation and sync already delete every row for the device. The
   device limit now counts distinct devices, since a phone may hold both its
   pairing token and its grant.

4. **Routes inside the encrypted channel.** `snapshot` replies gain
   `routes: [{kind, endpoint, relayToken?}]` for the routes live right now;
   the relay entry carries that phone's own grant. It is sealed with that
   device's key like the rest of the reply. Old phones ignore the field. No
   account credential is in a route; the grant only routes ciphertext.

5. **QR with more than one route.** `endpoint` (with `relayToken`) stays the
   first route, and is the relay when it is connected, so phones that read
   only `endpoint` get the route that works away from home. `routes` adds only
   the other direct routes. Measured with `qrcode` at level M: a relay QR is
   598 characters (version 19); adding the local route as `routes` gives 687
   (version 21); listing every route again including the relay token would
   have been 965 (version 25, 117 modules in a 300 px canvas), which is why
   the relay is not repeated.

6. **Approval while the relay is down** no longer fails if the phone can reach
   the computer directly; the relay grant arrives when the relay reconnects.
   With no direct listener the old refusal stands, since the phone would have
   no route at all.

## Evidence (what was run, on this branch)

- `node scripts/check-mobile.mjs`, `node scripts/check-mobile-host.mjs`,
  `node scripts/check-mobile-relay.mjs`: all PASS. The host check now asserts
  the three migrations, a `{mode}` request staying single-route, local and
  tunnel served at once, `routes` in the encrypted snapshot, refusal of an
  enabled configuration with no route, and an installed 0.1 `config.json`
  migrated and rewritten across a real bridge restart. The relay check asserts
  sync-before-grant ordering, hashes-only on the wire, stable tokens on
  re-assert, and that a 404 from an older relay leaves the connection up.
- `npm test` in `services/squad-api`: 30 tests, 28 pass, 0 fail, 2 skipped
  (the native-simulator walkthrough and the Swift probe below, both gated on
  environment variables). Before this change the same command ran 26 tests,
  25 pass, 1 skipped. The new
  workerd tests reproduce the field failure (pair locally with the relay off,
  then turn it on) and show the same phone accepted through the relay with no
  new QR, the grant unchanged across a relay restart, a wrong token refused,
  and local revocation ending the relay route; a two-route QR pairing on the
  local route with its QR relay capability promoted; and grant limits and
  cross-actor refusal on the control route.
- With `SQUAD_MOBILE_PROJECT` set to the squad-mobile `phone-routes` checkout,
  the actual Swift CryptoKit client (`SquadMobileProbe --routes`) paired over
  the local route, learned `["local","relay"]` from a verified snapshot after
  the computer turned the relay on, and sent a message through the relay
  alone into the canonical queue. That run of the relay test file: 9 tests,
  8 pass, 1 skipped (native simulator). `node scripts/check-mobile-interop.mjs`
  against the same checkout: PASS.
- `npx playwright test --config playwright.mobile-companion.config.mjs`
  (after `npm run build`): desktop and compact both pass with the new
  switches.

The first run of the relay test file failed once on the two-route QR test,
at the approval step, before that assertion reported the host's error text.
It then passed in eleven further runs of the whole file and six runs of that
test alone; the cause was not identified. The approval assertion now
prints the host's error message so a recurrence is diagnosable.

## Consequences

- Enabling phones now normally means the computer holds an outbound relay
  socket and Autohand stores one more hash per phone. Someone who wants no
  cloud route must turn From anywhere off; that is a visible switch, not a
  hidden default, but it is a default.
- Upgrading reopens a LAN port on computers that had chosen relay only.
- A grant is a long-lived routing capability (no expiry; it ends on
  revocation, sync or a new relay room). It cannot decrypt or authorise work.
- The relay change must be deployed before locally paired phones gain the
  relay. Until then the host gets 404, advertises the relay route without a
  token, and relay-paired phones keep the token they already hold. Not
  deployed by this change; no production check was made.
- A phone paired locally while the computer was relay-only before this change
  only recovers once the computer runs this version (which reopens Same
  Wi-Fi) and the phone is on that network once. A phone that never meets
  either route again must re-pair. There is no way around this: the phone's
  only stored address is the local one.
- Not done: APNs, waking a sleeping computer, automatic grant rotation, and a
  per-route health line on the phone beyond the route last used.
