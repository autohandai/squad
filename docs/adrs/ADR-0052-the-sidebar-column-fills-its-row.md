# ADR-0052: The sidebar column fills its row; the sidebar sticks inside it

Date: 2026-09-29
Status: Accepted

## Context

The owner: "this on the sidebar rendering or ui, bring a product ui expert to
fix this especially when we're running."

The shell is a CSS grid: a sidebar column and a main column. The sidebar column
was written as `sticky top-0 h-screen min-h-screen self-start`. Every one of
those four is about the column itself, and together they say: be exactly one
window tall, sit at the top of the row, and stay put while the page scrolls.

That is fine while the page is one window tall. It stops being fine the moment
the main column is taller — a long thread, a busy run, a Work page with rows in
flight, which is why it showed up "when we're running". The grid row grows to
match the main column; the sidebar column does not, because it was told to be
exactly `h-screen`. The row is then taller than the thing filling it, and the
remainder renders in the page background instead of the sidebar's.

Measured in a headless browser, desktop shell, 713px window: with the main
column grown to 2113px, the grid row was 2113px and the sidebar column 713px —
a 1400px strip of the wrong colour below the account footer. At the top of the
page and scrolled to the bottom, identically 1400px.

## Decision

Separate the two jobs that were on one element.

**The column stretches.** The `<aside>` keeps the background, the right border
and the blur, drops `sticky`, `h-screen`, `min-h-screen` and `self-start`, and
takes `self-stretch`. It now spans the whole grid row, so there is no remainder
to show through, at any page height.

**The sidebar sticks inside it.** A `sticky top-0 h-screen` wrapper inside the
aside holds whichever rail renders — the full sidebar or the collapsed one. The
brand stays at the top of the window and the account footer at the bottom of it,
exactly as before.

Nothing inside either rail changed. `.app-sidebar` is still `h-full
min-h-screen`, which against a 100vh wrapper is the same 100vh it always was.

The rejected alternative was to stop the page scrolling at all — give the shell
`h-screen overflow-hidden` and let the main column scroll internally. That is
the better app-shell architecture and it is a much larger change, touching every
page's scroll behaviour. It is not the fix for a column that was told to be the
wrong height.

## Consequences

- Re-measured after the change, same window and same 2113px main column: the
  column is 2113px, the strip is 0px, the brand is at viewport top 0 and the
  footer flush with the window bottom — at the top of the page and scrolled to
  the bottom. The collapsed rail measures the same.
- One wrapper covers every rail. `CollapsedSidebarRail` and
  `CollapsedMemberProfileRail` did not need their own sticky treatment, and a
  future rail will not either.
- The drag region (ADR-0040) is untouched: it lives on the header row inside the
  rail, below the new wrapper.
