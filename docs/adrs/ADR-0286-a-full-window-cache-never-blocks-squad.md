# ADR-0286: A full window cache never blocks Squad

Status: accepted, 2026-11-26

## Context

The owner's Squad stopped on "Your device's local storage is full. Free some
space, then retry. Your saved Squad is unchanged." with Retry and Sign out,
while macOS showed 9.4 GB free (985.23 of 994.66 GB used). Issue #88
(affrae, 18 Nov) had measured the same store from the other side: the app's
WebKit localStorage held 5.42 MB, at the browser's limit, of which the
direct-message history (`messages`) was 4.98 MB, and member saves had been
failing silently so only one of 13 members was cached.

The message was wrong about the cause. `OwnershipBootstrap` loads the owned
Squad from the bridge, then writes the roster, the whole direct-message
history, the revision and the channel list into localStorage. That store is
WebKit's, about 5 MB per app whatever the disk holds. When the history no
longer fit, the first write that crossed the quota (often the roster, with
last session's history still on disk) threw `QuotaExceededError`, and the
bootstrap mapped that name to "your device is full" and stopped loading
everything, although every byte it was writing is a cache of what the bridge
keeps. `src/lib/local-cache.js` already compressed the channel history on
quota, but only for App's own `persistLocal` writes, not the bootstrap's.

## Decision

The quota is handled once, in the owned storage wrapper
(`src/lib/owned-storage.js`), so every caller gets it:

1. A write that fits goes to disk, as before.
2. On `QuotaExceededError` the history caches (direct messages, channel
   messages, channel threads, the draft recovery copy) other than the key
   being written move off disk into this window's memory, and the write is
   retried. Members, channels and settings are never the first to give way
   (issue #88's question 6).
3. If it still doesn't fit, that value is kept in memory for the window and
   its stale disk copy is removed, so the next launch reads from the bridge
   rather than an old history.
4. Reads see memory first, key listings include memory-held keys, and a
   later write that fits goes back to disk. Quota never throws; any other
   storage error still does.
5. Pressure is reported to `onStoragePressure` listeners, not swallowed; no
   UI consumes it yet.

The bootstrap's message, if a quota error ever reaches it, now says it is
Squad's own small cache, not the disk.

## Consequences

- Squad opens with a full window cache. With histories held in memory, the
  first paint after the next launch waits for the bridge for those
  conversations, as a fresh install does.
- A draft still unsaved when a window held its history only in memory is
  lost if the app quits before the debounced save; the bridge copy is the
  last saved state.
- This does not answer #88's larger point: the whole history should not be
  cached in a 5 MB store at all. Moving history to IndexedDB, or caching only
  open conversations, is the follow-up; this change makes the limit harmless.
- No user-facing notice yet for storage pressure (#88 question 7).

Evidence: `node scripts/check-owned-storage-quota.mjs` (a 5 MB quota fake:
the owner's case of a nearly full history plus a roster write, a history
larger than the whole cache, small records still on disk, pressure reported,
other errors still thrown). The same scenario against the previous
`owned-storage.js` throws `QuotaExceededError`.
`node scripts/check-storage-full-browser.mjs` fills the real app's
localStorage to Chrome's quota before Squad loads, with six members on the
bridge: with this change Squad opens and lists them and the roster reaches
disk; with the previous `owned-storage.js` swapped back in, the same check
fails on the "cache is full" screen. `check:local-cache`,
`check:fresh-install`, `check:attention-badge`, `check:channel-goals`, the
build and `check:render` pass.
