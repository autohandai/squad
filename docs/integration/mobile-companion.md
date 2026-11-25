# Squad for iPhone and iPad

The native project is `~/Developer/autohand/squad-mobile/SquadMobile.xcodeproj`
(iOS/iPadOS 17 or later). This source integration has not yet been published in
a desktop or App Store release.

## Connect a computer

1. Open Squad on the computer, sign in, and choose the personal or team Squad.
2. In **Settings → Computers**, choose **Reach from anywhere** for Autohand's
   relay, **On this network**, or **My secure tunnel** for your own tunnel.
   Save the connection and enable **Connect phones**. Wait for confirmation.
3. Choose **Connect a phone**. Scan the private QR code in Squad for iOS, or
   explicitly copy and paste its pairing link. The offer expires in ten minutes.
4. Compare the six-digit code on both devices and approve on the computer.
5. Open an existing agent on the phone. Its saved workspace, harness, model,
   fallbacks and permissions remain controlled by the computer.

The computer needs to be awake with Squad running. Revoke a phone using its
**Disconnect** action. Disabling phone connections stops the transport and keeps
pairings; it does not stop agents or revoke their work permissions.

## Tunnel configuration

The default port is 29323. **On this network** listens on local interfaces and
puts the private LAN address in the QR code. Both devices need network reachability.
**My secure tunnel** listens on `127.0.0.1` and advertises the address you supply.
Configure your existing HTTPS reverse proxy/tunnel to forward `/v1/mobile` and,
optionally, `/v1/health` to that port. Do not forward the main desktop API port.
HTTPS addresses have no credentials, query, fragment or path prefix. Plain HTTP
is accepted only for local addresses. Saving a URL does not create a tunnel or
prove external connectivity.

**Reach from anywhere** opens an outbound authenticated WebSocket to
`https://squad.autohand.ai`, without an inbound listener or a port field. It
requires the relay-enabled desktop, mobile client and deployed Squad API.
The status is connected only after a relay acknowledgement and while the
heartbeat and current-owner lease are valid. Offline configuration stays
saved and reconnects; it never changes to a different connection mode.

All phone commands are AES-GCM encrypted end to end. A proxy sees encrypted
packets and routing metadata, not message bodies. Pairing links contain a private
temporary key; never publish one in an issue, log or screenshot.

## Client contract (phone protocol 1)

`POST /v1/mobile` accepts a JSON packet:

```json
{"version":1,"kind":"device","computerID":"…","peerID":"…","requestID":"…","sealed":"…"}
```

The sealed value is base64 of nonce (12 bytes), ciphertext, and GCM tag (16 bytes).
Authenticated data is
`autohand-squad.mobile/1/<request|response>/<pair|device>/<computerID>/<peerID>/<requestID>`.
The plaintext request has `issuedAt` (Unix seconds), `command`, and `parameters`.
The response is encrypted with the same routing fields and the response direction:
`{ok:true,data:…}` or `{ok:false,error:…}`. Pairing packets use the QR's temporary
256-bit key; approved device packets use the device's 256-bit key.

Relay offers add `relayToken` (64 lowercase hex characters) and a canonical
`https://squad.autohand.ai/mobile/<64-hex-roomID>` endpoint. The phone posts
`{relayToken,packet}` to `<endpoint>/v1/mobile`; the response is the original
encrypted packet. The capability belongs in the body, never a URL query or
authorization credential for the desktop API. Old direct offers omit it and
keep posting the bare packet. Keep this capability with the paired key in
Keychain. A relay forwards pairing packets only until offer expiry, then
allows device packets only after explicit computer approval. It never
receives a decryption key. See [ADR-0212](../adrs/ADR-0212-outbound-encrypted-phone-relay.md)
for access checks, resource limits, leases and metadata retained by the relay.

| Command | Parameters | Result |
| --- | --- | --- |
| `pair.claim` | `deviceID`, `deviceName`, base64 `deviceKey` | pending/approved/rejected state |
| `pair.status` | `deviceID` | matching claim state |
| `snapshot` | none | computer version, member routes, display account, optional capabilities |
| `conversation` | `memberID` | saved user/agent turns |
| `message` | `memberID`, `text` | durable message ID and actual queue state |
| `delegate` | `memberID`, `title`, optional `detail` | canonical task ID, assignee and queue state |
| `tasks` | none | up to 50 canonical tasks with current execution states |
| `announcements` | optional `appVersion` | sanitized iOS-targeted announcements |
| `announcement.act` | `id`, `action` seen/dismiss, optional `step` | acknowledged action |
| `device.disconnect` | none | key revoked |
| `inbox` (0.6, capability `inbox`) | none | `decisions` (each with `memberID`, `memberName`, `at` and the same `card` a chat shows, answered with `card.act`) and `stopped` (failed or stopped replies from the last 48 hours, one per member and question) |
| `member.profile` (0.10, capability `profiles`) | `memberID` | `revision`, `name`, `role`, `description`, `instructions`, read-only `personality`, `skills`, `workspace`, `harness`, `voice`, the edit `limits` and `canEdit` |
| `member.update` (0.10, capability `profiles`) | `memberID`, `expectedRevision`, and any of `name`, `role`, `description`, `instructions` | the saved profile, as `member.profile`; refused when the profile changed since `expectedRevision` (re-read it), when a field is over its limit, or when this Squad is read-only here |
| `member.update` (0.11, capability `profileEdits`) | also `personality` (the text the person wrote, up to 600 characters; the computer stores it as PERSONALITY.md under a `# Personality` heading and a Role line) and `skills` (up to 32 skill package ids from `member.skills`; an empty list clears them) | as above; the profile now carries `avatar` (a cast bird path or a picture key, as the snapshot), `skillIDs` and `maxSkills` |
| `member.skills` (0.11, `profileEdits`) | `memberID`, optional `query`, `offset` | `{ skills: [{ id, name, category, description, local }], total, hasMore }`: the skill packages available in the member's workspace, 40 a page, those already on this computer first |
| `member.avatar.set` (0.11, `profileEdits`) | `memberID`, `bird` (a cast bird id, as `avatar`), `expectedRevision` | the saved profile; only one of Squad's birds, never a URL or picture; refused when stale or read-only |
| `feedback.send` (0.6, capability `feedback`) | `kind` bug/feedback, `summary` (8–200), optional `detail`, `automatic`, `appVersion`, `device` | the computer's feedback receipt; sent to Autohand labelled "from Squad for iPhone", 10 an hour from a person and 5 automatic, duplicates dropped for an hour |

The confirmation code is the first big-endian uint32 of
HMAC-SHA256(pair key, `computerID:pairingID:deviceID:<base64 device key>`), modulo
one million and padded to six digits. Approval is exclusively computer-side.

Discover optional commands from `snapshot.capabilities`: `delegate`, `tasks`,
`announcements`. Missing capability means the computer needs an update. The
computer's app version is `snapshot.computer.version`; this protocol is separate
from MCP's server/tool contract version. Existing MCP tools and phone tasks share
the canonical records and execution operation, not independent bot copies.

Persist `requestID` before `message` or `delegate` and reuse it when a response is
lost. Never make a new ID automatically to retry uncertain delivery. Repeated
contents under one ID return the saved receipt; changed contents fail. An
unconfirmed intent requires checking the conversation/task on the computer.
Queue acknowledgement is not completion. A remote-assigned member currently
requires pairing its actual execution computer; the phone refuses a local fallback.

Phone pairing does not grant Computer Use, arbitrary HTTP/API access, automatic
folder creation or Git initialization. APNs is notification transport, not a
substitute for an awake computer or a message tunnel. APNs and per-agent VM
provisioning are not delivered by this integration.

## Verification

Run `bun run check:mobile`, `bun run check:mobile:browser`, and (on a Mac with
Swift) `node scripts/check-mobile-interop.mjs <mobile-project-directory>`. Native
acceptance uses `node Scripts/native-smoke.mjs <squad-checkout> [simulator-UDID]`
from the iOS project. These create isolated homes/owners and use an offline engine.
They do not change the installed app, grant OS permissions, or call a live model.

The API package's `npm test` includes the actual laptop relay client and desktop
controller with a local workerd runtime and canonical queue. On macOS, run
`SQUAD_MOBILE_PROJECT=<mobile-project> npx tsx --test test/mobile-relay.test.ts`
from `services/squad-api` to include the real Swift CryptoKit client. Add
`SQUAD_MOBILE_NATIVE_DEVICE=<your-verification-simulator-UDID>` to run native
pair/chat/revoke UI through that same local relay. Those checks do not prove
the public deployment or physical-device camera and cellular connectivity.
