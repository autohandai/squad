# ADR-0289: A large channel history saves what changed, and typing never redraws it

Status: accepted, 2026-11-27. Issues #87 and #86 (reported on 0.1.21, still
present on main 21fe46b).

## 1. Channel sync sends what changed (#87)

### Context

Every change to channel state (a reply, a reaction, a rename, each streamed
update, and every 750 ms reload while a channel purpose runs) made the window
send the whole history to `PUT /api/channels/sync`: every channel, thread and
message, each message with its agent `trace` and `streamEvents`
(`src/App.jsx`, the sync effect). The bridge refuses bodies over 16 MiB
(`CHANNEL_HISTORY_MAX_BYTES`, `server.mjs`). The reporter's channels.json was
18.9 MB, ~17 MB of it traces and stream events, so every save failed with
"request body too large … Reconnect and try again", and reconnecting could
never help.

Measured with `scripts/check-channel-history-browser.mjs` (a real bridge, 197
messages, 19.2 MB, shaped like the report): on main the window made four
syncs of 19.2 MB each within ten seconds of opening the channel (77 MB
uploaded), all refused, and the banner stayed up.

### Decision

The bridge already merges a sync record by record and keeps the newer
`updatedAt` (`server/channels-store.mjs`, `sync`); a record it already holds
with the same `updatedAt` is ignored. So the window now sends only messages
whose `updatedAt` differs from what the bridge acknowledged: the baseline is
taken from the bridge's own copy on every reload, and each batch that lands
updates it. Channels and threads (small) go with the first batch when they
changed. Syncs are coalesced (400 ms) so a streaming reply is one save, not
dozens, run one after another, and split into batches under 6 MB. A refusal
for size now says one message is too large for the bridge to store instead
of suggesting a reconnect (`api()` now carries the HTTP status).

Traces stay in the sync. For channel replies the window is where the trace is
produced and this sync is how it reaches channels.json; dropping it would
lose "Work details" after a reload. Sending only changed messages makes the
size of the history irrelevant to each save.

### Consequences

- The same fixture now syncs 379 bytes per change, with no banner; the stored
  1,100-event traces are untouched.
- A message changed without a new `updatedAt` is not resent. That matches what
  the bridge did before (it ignored such records), so nothing new is lost.
- channels.json itself still grows with traces, and `GET /api/channels` still
  returns all of it at start (19 MB on the reporter's Mac). Trimming stored
  traces, or fetching them on demand, is the next step and is not done here.
- One message larger than 16 MiB still cannot be saved; it is now named as such.

## 2. Typing never redraws the channel (#86)

### Context

The reporter saw the whole app slow down over days, up to "10+ seconds
between keystrokes showing in the chat box". Fixing the sync (section 1) did
not change typing: on the same fixture keystrokes still took a median of
167 ms to appear (worst ~490 ms), with 44 long main-thread tasks totalling
8.5 s. A CPU profile of the keystrokes (`CHANNEL_HISTORY_PROFILE=<file>`)
showed the time in React creating elements for every message in
`ChannelStream` and its `dayKey`/`fullTime` date work per message.

The cause: the channel page keeps the composer `draft` in the same component
that renders `<ChannelStream>` with inline callbacks, so each keystroke
re-rendered every message with its work details. Two values defeated any
memo even without that: `channelThreads[id] || []` and
`workflowsByChannel[id] || []` made a new empty array on every render, which
re-ran `channelTranscript` over the whole history, and `members` was rebuilt
each render.

### Decision

Build the stream element in a `useMemo` keyed on what it shows (messages,
members, reactions, settings, copy, the handlers from App), never on the
draft; share one frozen empty array (`NO_ITEMS`) and memoise `members`. The
composer, the anchor chips and everything else that reads the draft still
re-render on each keystroke.

### Consequences

- Same fixture: keystrokes appear in 16 ms (one frame) at the median; the
  stream is absent from the keystroke profile. Measured with React's
  development build in the harness, so absolute numbers are higher than the
  packaged app, the ratio is what matters.
- The memo's dependency list must grow with any new value the stream reads.
  A missing dependency shows a stale stream; `check:channel-history:browser`,
  `check:channels:browser` and `check:channel-goals:browser` exercise it.
- Not addressed: the first render of a very long channel (the remaining long
  tasks happen at load) and slowness elsewhere if other pages hold a draft
  next to a large list. Windowing the stream would cover the first.
