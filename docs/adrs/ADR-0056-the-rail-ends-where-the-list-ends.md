# ADR-0056: The rail ends where the list ends

Date: 2026-09-29
Status: Accepted

## Context

Second half of "bring a product ui expert to fix this especially when we're
running". ADR-0052 dealt with the sidebar column stopping one viewport short of
a taller page. That was real, and it was not the only thing.

Measured with fourteen members so the direct-message list overflows, 1400x813:
the scroll viewport clipped at y=704, the footer divider sat at 716, and the
account row did not start until 745. Forty-one pixels of nothing between a row
cut in half and the owner's own name, made of four paddings in a row:

- 12px — `pb-3` on the `ScrollArea` root, which is outside the scroll viewport,
  so it is dead space that also stops the list short of the divider
- 1px — the footer's `border-t`
- 16px — the footer's `p-4`
- 12px — `mt-3` on the account row

That last one exists only to clear the "Restart to update" button above it,
which renders only when an update is pending. In the normal case it is dead
space, and it made the footer top-heavy: 29px above the name against 16px below,
a 97px box around a 52px row.

Nothing renders below the footer. The band reads lighter because nothing paints
a fill there — in the desktop shell `.app-sidebar` is transparent over the
window vibrancy, so an empty band next to a dense list is exactly where that
shows most.

## Decision

**The gap belongs to the update button.** `mt-3` comes off the account row and
goes onto the button as `mb-3`, so the spacing exists only when the thing it
separates exists.

**The list runs to the divider.** `pb-3` comes off the `ScrollArea` root. A row
clipped at the divider reads as "there is more below"; a row clipped forty-one
pixels above it reads as broken layout, which matters more than usual because
shadcn's `ScrollArea` passes no `type`, so Radix defaults to `hover` and there
is no scrollbar in the DOM to explain the clip.

Both changes only remove padding. No fill, no panel, no new border, one divider
kept — `DESIGN.md` unchanged.

## Consequences

- Measured before and after in the same headless browser at the same size: the
  footer goes from 97px to 85px, the band from 41px to 17px (the divider plus
  the footer's own padding), the scroll viewport gains 24px of list, and the
  footer becomes symmetric. The sidebar still ends exactly at the window bottom.
- The premise that running members make it worse does not hold geometrically:
  measured idle against working, every box in the footer is identical, and
  nothing in `SidebarAccountFooter` is conditional on run state. What changes
  while members work is where the eye is — on the DM list at the bottom of the
  rail, which is where the void was.
