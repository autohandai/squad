# ADR-0133: Forty UX enhancements, and the judgements behind them

## Context

After two bug hunts (ADR-0132) the app did what it said, but the paths people
walk most still had friction that was not a defect: copying a command out of a
reply, finding the end of a long chat, asking again with one word changed,
moving between members, clearing stopped work that was handled elsewhere,
finding a setting, a memory entry or a history event. The 40 changes are listed
with their use cases in `docs/reports/ux-enhancements-2026-10.md`. Each was
tried in the lane preview (lane build, reads forwarded to the installed 0.1.7
bridge, writes refused) against the real roster.

## Decisions

1. **Shortcuts follow the platform and stay out of text fields.** ⌘ on macOS,
   Ctrl elsewhere; "?" and "/" only act when focus is not in an input, so they
   never eat a character someone is typing. One sheet lists every shortcut and
   is reachable from "?" and the account menu, so nothing depends on knowing a
   key exists.
2. **Hidden stopped work is per browser and comes back when it changes.** A
   hidden row is stored with its time; a new failure or a retry moves the time
   and it returns. This keeps "hide" from silently swallowing a repeat failure,
   and needs no bridge change. The Needs you summary counts the same filtered
   list.
3. **Settings search matches words, not content.** Settings renders one section
   at a time, so searching inside all of them would mean rendering all of them.
   A small keyword map per section ("dark" → Appearance, "api key" → LLM
   Providers) answers the common question "where is X" at no cost.
4. **Channel addresses accept names.** `/channels/<name>` is rewritten to the
   id; ids still win when both match, so an id that happens to be another
   channel's name cannot be hijacked.
5. **Copy controls report failure.** They use `copyText`, which returns whether
   the copy happened, and say "Could not copy" instead of a false "Copied".

## What was learnt

"Jump to latest" first never appeared. The anchor was found, but the scroll
parent search returned nothing: Radix's ScrollArea sets its viewport to
`overflow: scroll` only after its own effects run, so on first render it reads
`hidden`. The control now looks for the marked Radix viewport first. A debug
hook (`window.__jtl`) found it in one run; it was removed.

## Consequences

- In the web build, ⌘1–9 is also the browser's tab switch; browsers keep that
  shortcut, so it only works reliably in the desktop app. The sheet still lists
  it.
- Hidden stopped work, sort order and folded sidebar sections live in this
  browser's storage: a second browser or the desktop app and the web build do
  not share them.
- The settings keyword map must be kept in step with new sections; a section
  without keywords is still found by its name.
- Not exercised end to end: "Reset to the level's defaults" (the preview
  refuses member saves) and the empty-channel line (no empty channel here).
- Not done: a "New" divider at the first unread reply in a member chat, and a
  member-chat equivalent of channel threads' unread marker.
