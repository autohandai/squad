# ADR-0238: Replies in groups and channels read in order by default

Status: Accepted
Date: 2026-11-17

## Context

Every channel carries a reply mode, `thread` or `channel`
(`normalizeChannelReplyMode`); anything unset is `thread`, and the bridge
stores new channels as `thread` (`server/team/channels.mjs`). So in practice
every group and channel collapsed members' answers under the person's
message: "Chief of Staff and Tatiana replied", then "2 replies", then the
answers indented under a rule with Reply in thread. The owner sent a
screenshot of exactly that in his Chief of Staff and Tatiana group ("hwy you
too") and asked for threads to be a settings preference, off by default.

## Decision

A device preference, `chatSettings.threadedReplies`, default `false`, shown
as Settings › Chat › Reply in threads.

- Off: `ChannelStream` ignores the channel's reply mode and draws the
  chronological stream it already draws for `channel` mode. The "X and Y
  replied" faces line is not drawn either, because the replies sit directly
  below.
- On: unchanged. The channel's own reply mode decides, and the channel
  details select keeps working.

It is a display preference only. The transcript, `parentMessageId`, saved
threads and how members are asked to answer are unchanged, so turning it on
again shows the same threads.

Considered and not done: flipping every channel's stored `replyMode` to
`channel`. That would rewrite saved data, lose each channel's choice, and
still leave new channels defaulting to threads on the bridge.

## Evidence

- `bun run check:work-plans:browser`, `check:render`, `check:minified:browser`
  and `check:settings:browser` pass with the change.
- `check:team:browser` and `check:channels:browser` exercise the threaded
  view; both now seed `threadedReplies: true`. Both fail on main *without*
  this change as well (a member profile path from before owned datasets, and
  a 30 s wait for the channels route), so they do not currently prove either
  mode. The off mode was checked against the installed app instead (see the
  commit that ships this).

## Consequences

- The channel details "reply mode" select still shows while the preference is
  off, where it has no visible effect. Hiding it needs the preference passed
  through the channel settings view; left for later.
- It is per device (local storage), like the other chat settings, so the
  iPhone app keeps its own presentation.
- The two broken channel browser checks above remain broken; repairing them
  is separate work.
