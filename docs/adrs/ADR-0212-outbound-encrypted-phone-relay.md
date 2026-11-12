# ADR-0212: outbound encrypted phone relay

Status: accepted for implementation; deployment evidence is recorded separately.

## Context and evidence

ADR-0211 supplies real phone pairing and canonical queue execution, but its
local connection needs a shared network and its tunnel mode requires users to
supply an HTTPS origin. The owner requested QR pairing and phone chat from
elsewhere, with an Autohand-operated relay. APNs is a notification mechanism;
it cannot replace the request transport or guarantee a sleeping laptop wakes.

The first workerd regression returned 404 for relay registration. After route
implementation, registration passed but WebSocket upgrade returned 500.
Returning the 101 upgrade response directly, before ordinary HTTP response
header decoration, made the same upgrade test pass. This was an upgrade
handling failure, not evidence that a valid account credential was rejected.

`npm test` in `services/squad-api` exercised 25 API tests, including the actual
outbound Node WebSocket client, local Cloudflare Worker/D1/SQLite Durable
Object routing, computer restart and offline revocation synchronization.
With `SQUAD_MOBILE_PROJECT` pointing at the native client's relay change,
`npx tsx --test test/mobile-relay.test.ts` also ran the actual Swift CryptoKit
HTTP client through the relay and owned desktop controller into the canonical
queue: matching-code approval, one message despite retry, transcript and
revocation passed. These use a fixture identity service and an offline engine,
not a live model or deployed relay. Native simulator and deployment results
must remain distinct evidence.

## Decision

Add an explicit relay mode to Computers settings, preserving local and
user-operated tunnel modes. The computer opens an authenticated outbound
WebSocket to the dedicated Squad API. One SQLite Durable Object identifies
the actor, personal/team owner, dataset and computer; the typed cf entrypoint
declares its SQLite export. D1 indexes registered routes so unknown public
room URLs cannot allocate persistent objects.

Private control calls require a Squad session plus the computer's current
Autohand identity. Team authority is rechecked against current membership.
Host leases last ten minutes and renew every five minutes with fresh access
checks. The client tracks ready confirmation, heartbeat and lease expiry,
reconnects with bounded backoff and synchronizes retained device IDs before
accepting packets. Sessions remain in process memory; identity credentials
never enter the phone, QR or Durable Object socket attachment.

The QR adds an optional 256-bit routing capability (`relayToken`) and a
canonical `/mobile/<roomID>` HTTPS prefix. The capability travels in a JSON
body, never the URL, and the relay stores only its SHA-256 hash. It can route
pairing packets for ten minutes; local matching-code approval promotes it to
one device ID. It cannot decrypt or authorize computer work. AES-GCM keys
remain on the approved devices, using ADR-0211's authenticated packet fields.
Older direct connections keep the original packet body and protocol version.

The relay stores scope and capability metadata, not message bodies. At most
16 HTTP requests wait for a host response for 25 seconds; responses must match
the request identity and originating socket. There is no cloud replay queue.
A malformed ciphertext produces a request error without disconnecting the
whole computer. Local receipt and canonical queue deduplication remain the
delivery authority. Removing a key is immediately authoritative locally;
offline cloud revocation is reconciled before the next host connection.

## Consequences and limits

The laptop needs outbound HTTPS/WebSockets, but no open inbound port in relay
mode. Autohand operates an additional Durable Object service and retains
actor/computer routing metadata, capability hashes and existing session
identity records. Payload encryption does not hide packet size, timing or
routing metadata. Automatic room/account purge and quota billing are not
implemented by this change; per-room phone capacity is twenty.

The computer must remain awake and running. A connection loss can leave a
request unconfirmed; neither relay nor phone should create a fresh receipt
automatically. Public relay request bodies are capped at 128 KiB, enough for
the bounded text commands; encrypted replies follow the existing 2 MiB
packet limit. File streaming, APNs delivery, VM provisioning, arbitrary
computer control and routing work to a different paired computer are outside
this transport change. Existing OS grants and local/remote execution checks
remain authoritative.

Deployment requires the additive `0003_mobile_relays.sql` migration and the
SQLite Durable Object export together. A local workerd pass does not prove
the production account's deployment permissions, identity routing or phone
reachability. Those need a separately recorded deployed-version check.
