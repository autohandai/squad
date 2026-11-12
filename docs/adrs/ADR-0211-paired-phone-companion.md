# ADR-0211: Pair phones to an owner-bound Squad computer

## Context and evidence

The owner requested a native iOS companion that scans a QR code, chats with
existing agents over a local network or a tunnel, and distinguishes separate
computers/VMs from multiple workspaces on one laptop. Autohand's existing mobile
API relays CLI session actions with account authentication. Squad's existing
relay synchronizes channels. Neither is an opaque transport for the phone
pairing protocol; reusing their names would not establish interoperability.

The mobile app is a separate SwiftUI project at `~/Developer/autohand/squad-mobile`.
Its CryptoKit client and this Node service interoperate over actual HTTP; there
is no web UI wrapper or example squad substituted for a missing connection.

## Decision

Use a separate, disabled-by-default encrypted phone listener. Settings → Computers
enables it, shows the computer's reachable address, generates a ten-minute QR
offer, and requires explicit approval of a matching six-digit code. The phone
stores its device key in Keychain. The computer stores device keys and replay
receipts in its private actor/owner/dataset scope. Generating or claiming an offer
does not authorize work; revoked or changed-owner connections cannot use it.

AES-256-GCM authenticates packet direction, protocol version, computer, peer and
request identity. Pairing uses a temporary random key from the QR offer, then an
approved per-device key. Request timestamps have a two-minute skew allowance.
The listener exposes only encrypted protocol commands and a public service-health
name. It does not expose the desktop HTTP API or native OS grants.

Direct messages use the canonical member roster, saved workspace, durable member
queue and saved transcript. Task delegation calls the same `assignMemberTask`
operation as managed MCP's `squad_assign_task`; it identifies the person instead
of impersonating a bot. The current owner must still have write access. Snapshot
capabilities advertise actual optional task/announcement support; account output
contains display identity only. Announcement targeting uses iOS and the phone's
version while the account credential stays on the computer.

Persist an intent before dispatching a mutation, and retain its result under a
stable device/request key. Replays return that receipt; changed contents fail.
The member queue also deduplicates client receipt keys across restart. An intent
interrupted without a recorded result stays unconfirmed and is not blindly
executed again. The receipt store is bounded and refuses new mutations when full
instead of silently forgetting deduplication records.

## Evidence

- `bun run check:mobile`: approval/code rejection, authenticated packets,
  idempotency, owner change and revocation; real owner-bound bridge and offline
  fixture engine for task dispatch, restart replay and remote-routing refusal.
- `bun run check:mobile:browser`: production desktop and compact Settings,
  rendered QR, actual approval/revocation, real queue completion and transcript.
- `node scripts/check-mobile-interop.mjs <mobile-project>`: actual CryptoKit and
  Node encrypted HTTP exchange, matching confirmation code and duplicate send.
- The iOS project's `Scripts/native-smoke.mjs` passed native simulator pairing,
  Keychain storage, queued chat, displayed reply and revocation. It used pasted
  pairing input and an offline fixture engine, not physical-camera or provider
  proof. Native result bundle: run `6513b5f69a6d`, one passing UI test.

## Consequences and remaining work

Local mode listens on the LAN; tunnel mode listens on loopback behind an
explicitly configured HTTPS/private-network tunnel. No automatic public relay,
APNs registration/delivery, physical-device provisioning or new release is
claimed by this change. The computer must remain awake with Squad running.

Remote-member execution is currently routed in the desktop chat HTTP layer,
while the shared queue executes local turns. Until that queue has verified remote
routing, the phone refuses message/delegation to a remote-assigned member and
asks to pair its actual computer. A remote label does not prove VM isolation.
VM provisioning and per-agent OS isolation are separate unfinished work.

The initial phone command set omits file upload, groups, OS access, profile edits
and permissions. A lost phone can be revoked individually. Turning the listener
off preserves pairings for re-enabling; removing a pairing revokes its key. Device
credentials are operational state outside the portable backup definition allowlist
and are not a portable grant of computer access. There is deliberately no
automatic eviction of message receipts or replay of an uncertain mutation.
