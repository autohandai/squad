# ADR-0084: Lossless channel cache fallback at the native storage limit

Date: 2026-10-13

## Context and evidence

The corrected installed candidate could load and create channels but the native
New member form reported that this device could not save its draft. A read-only
query of WebKit's local-storage database measured 5,257,422 bytes of values;
channel history accounted for 3,148,622 bytes and direct messages 1,834,078.
The form's new key could not fit at the approximately five-MiB storage boundary.
Existing `persistLocal` caught failed history writes and left the app mounted,
but neither reclaimed space nor preserved the latest cache update.

`.codex-artifacts/local-0.1.6/quota-repro.mjs` exercises the actual App persistence
function against a five-MiB storage implementation. It failed before the change
because the complete history update was absent, reproducing the quota seam.

## Decision

Keep ordinary JSON when it fits. On a quota error, encode the channel-message
cache with versioned, lossless UTF-16 LZ compression and decode it through the
shared startup reader. Pin `lz-string` 1.5.0, whose published implementation
provides the codec, rather than hand-writing a compression algorithm. See the
[upstream project](https://github.com/pieroxy/lz-string).

Preserve all fields, pending messages and Unicode. Do not delete conversation
records or change direct-message, member or draft storage formats. Security
errors and compression that cannot fit still fail rather than claiming success.
Test reload round trips, member-draft headroom, ordinary JSON and failed writes.
The draft saver can also compact an existing uncompressed channel cache and
retry the exact draft after a quota failure. An unchanged cache write may not
trigger WebKit's quota check, so history-write fallback alone is insufficient.
An exact round trip of the real 93-message cache reduced its UTF-16 storage
from 3,148,622 to 494,500 bytes; records were unchanged. This measurement is
retained in `cache-roundtrip-real.json` under the local candidate artifacts.

The same quota failure also prevented Alex’s confirmed GTM profile from reaching
the browser roster. The bridge retained the prepared profile while the native
roster held eight members, without Alex. All App JSON persistence now retries
the exact write after compacting an unchanged channel cache on quota failure.
`node scripts/check-local-cache.mjs` exercises App’s real persistence function
with a roster write that initially exceeds quota and verifies both the complete
member data and untouched channel history after decoding. This avoids relying
on a channel update happening before a roster or preference save.

For the already affected local account, a targeted offline repair restored
only Alex’s known ID from the saved prepared profile and newer channel-access
configuration. The eight existing roster records were unchanged. The app and
bundled runtime were stopped first, the SQLite backup API preserved the original
storage, and integrity checks passed before and after. The runtime omits the
portrait, so the role/name-based built-in portrait was regenerated. This is a
local recovery, not automatic discovery of every profile directory; deleted
members and unrelated prepared profiles were not imported.

## Consequences and limits

Compression costs CPU on a failed large write and adds a frontend dependency
and a cache format that older apps cannot decode. The bridge keeps normal JSON
channel history; the original native WebKit storage backup also remains
available for rollback. This does not raise the browser's quota, guarantee that
incompressible history or a very large avatar fits, or migrate all workspace
state to a new database. Those broader storage changes are deferred.
