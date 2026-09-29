# ADR-0054: The title bar is part of the app, not a band above it

Date: 2026-09-29
Status: Accepted

## Context

The owner, with a screenshot of Squad beside a screenshot of another app: "top
bar of the app is annoying doesn't match which looks like uses the same app
foreground colours."

The window is already a full-size content view — `TitleBarStyle::Overlay`,
`hidden_title`, `transparent` — so the page does extend under the title bar.
What it then did with that space was the problem. `.app-shell-root` carried
`padding-top: var(--titlebar-inset)` while the shell root, `#root`, `body` and
`html` are all `background: transparent !important` in the desktop shell.

Twenty-eight pixels of padding on a transparent element is twenty-eight pixels
of nothing. What showed through was the window's own vibrancy material, which is
a light grey. In a black app that reads as a grey bar sitting above the sidebar
and the main column rather than as part of either — exactly the seam the other
app does not have, because there each column's own colour runs to the top edge
and the traffic lights sit on it.

## Decision

**The columns reach the top edge; only their content is inset.** The padding
moves off `.app-shell-root` and onto `.app-sidebar` and `.app-main`. Their
backgrounds now paint from y=0, so the band is the app's own surface, and the
brand row and the channel header still start below the traffic lights.

**The full-height rewrites stay, and the sidebar opts out.** `h-screen` inside
the shell is still one inset too tall for a padded column, so the rewrite that
subtracts it is still needed — removing it cost the page a 28px scrollbar, which
is how this was caught. The sidebar column is the exception: it starts at the
top edge rather than below the band, so it is genuinely a whole viewport tall
and asks for `h-[100svh]` by hand, which the rewrite does not match.

## Consequences

- Measured in a headless browser with `data-shell="desktop"`, `data-platform="mac"`,
  813px window: both columns at top 0 and height 813, content at 28, page
  overflow 0. The web shell is unchanged — everything at 0 and no inset.
- `--titlebar-inset` is still 0 off macOS, so Windows and Linux are unaffected.
- The drag strip is untouched: still fixed at the top, full width, the height of
  the inset, and still the only drag region (ADR-0040). It now sits over the
  app's own surface instead of over a strip of window.
