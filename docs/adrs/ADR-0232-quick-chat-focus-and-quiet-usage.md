# ADR-0232: Quick Chat opens ready to type, with usage as one quiet line

Status: accepted. Amends the Quick Chat lines in DESIGN.md (Desktop Shell).

## Context and evidence

The owner opened Quick Chat from the menu bar (2026-11-16) and had to click the
composer before typing. `QuickChatPanel` never focused it: the native shell's
`reveal_popup` showed the panel, dispatched `squad:popup-shown` and only then
made the window key, and nothing in the page listened for that event to place
the caret.

He also asked why usage sat below the composer. It was a `<details open>`
listing every harness window (Codex weekly, Claude Code weekly and Fable),
shown whenever Settings › Quick Chat › Show harness usage and limits is on,
which is the default. In a 420×600 panel it took about a third of the height
from the conversation.

## Decision

1. Each time the popover is shown, and when its window gains focus, the
   composer receives focus with the caret at the end of any draft, unless the
   person is already in another field of the panel. The native shell now makes
   the panel key before dispatching `squad:popup-shown`.
2. Usage starts collapsed to one line naming the tightest limit
   ("Codex at its limit · resets in 6d 17h"). Opening it shows the full rows;
   the open/closed choice is remembered on this device (localStorage, a
   per-viewer convenience). The setting that hides usage entirely is unchanged.

## Consequences

- People who relied on seeing every window at a glance need one click, once.
- Focus is stolen from nothing else: the panel only exists to be typed into.
- Verified: `node scripts/check-quick-chat-layout.mjs` (new assertions for
  focus on open, refocus on `squad:popup-shown`, collapsed-by-default usage
  and its summary) passes. The native ordering change was exercised by the
  installed app, not by an automated native test.

## Addendum (2026-11-18): the member carousel keeps keyboard focus

"Focus is stolen from nothing else" was wrong. The focusing effect depends on
`member?.id`, so choosing a member re-runs it. Arrow keys in the member
carousel select the next member and move focus to that portrait (roving
focus); the effect then moved focus into the composer, so the second arrow
press did nothing. `check:goals:browser` caught it: after End, the last member
was selected, but `document.activeElement` was the textarea ("Keyboard
selection preserves roving focus").

Decision: the effect leaves focus alone when it is on a member-picker control
that matches `:focus-visible`. Keyboard focus there matches; a mouse click on a
portrait does not, so clicking a member still puts the caret in the composer,
as decision 1 intends. Traded away: a keyboard user who picks a member must Tab
to the composer, which is the usual cost of a roving-focus control. Relies on
`:focus-visible` heuristics, which WebKit and Chromium apply the same way for
programmatic focus after a key press. `check:quick-chat:browser` still passes,
and the goals check passed this step afterwards.
