# ADR-0059: Charcoal, not black, and the window edge is the app's colour

Date: 2026-09-30
Status: Accepted

## Context

The owner, with two zoomed screenshots of the window corners: "feels a little
wrong on the edges and the app foreground is weird colours, the autohand theme
colours as well is not charcoal dark like for eye pleasing even for light mode."

Three separate things, and the first two were the same bug twice.

## Decision

**The window edge paints the app's colour, not the window's.** The desktop shell
sets `.app-shell-root { background: transparent !important }` so the macOS
vibrancy shows through, and `!important` beats any specificity a skin can reach.
The Soft skin pads that element by 10px to float its panels — so the padding
showed *window material*, a mid-grey band around and between the panels instead
of the skin's own background. This is the same collision already found on
`.app-sidebar` (ADR-0058): a skin that paints its own surfaces opts out, and now
both elements do.

**`theme-color` follows the theme.** `index.html` carried two static metas,
`#000000` for dark and `#ffffff` for light. That is the colour the browser paints
its own chrome with at the window edge, and static it was right for exactly one
preset out of twenty and no skin at all. There is now one meta, updated at
runtime from whichever background is actually in force.

**The dark theme is a charcoal.** `#1d1c1b` at L\*10.3 replaces `#000000`.

The diagnosis was not simply "too black". The whole value ladder was crushed
into the bottom 15 L\* of the range, and `card` and `popover` were the *same*
colour, so a dropdown opening over the sidebar separated by shadow alone — in a
product that deliberately avoids drawing borders around everything, surfaces
have to separate by value. Anchoring the page at L\*10 leaves headroom under
every surface above it, and the ladder becomes 10.3 / 13.3 / 17.1 / 20.4 / 24.0
/ 25.4.

It is warm-neutral rather than dead neutral, because the ink is already a warm
off-white (`#faf9f5`). Neutral surfaces under a warm ink is what made the old
theme read as a black screen rather than graphite.

Eleven of the twenty-three tokens changed. Green is untouched: it still means
state and nothing else, and the primary is still the plainest thing on the
surface, both per `DESIGN.md`.

## Consequences

- Contrast, computed rather than asserted, on the proposed dark: foreground on
  background **16.15:1**, muted-foreground on background **6.59:1**,
  muted-foreground on muted **5.02:1**, foreground on card **15.08:1**,
  foreground on popover **13.61:1**. All clear AA for body text. The drop from
  19.93:1 is the point: pure black against a near-white ink is more contrast
  than the eye wants for hours at a time.
- Three hardcoded blacks would not have followed the change and are now on the
  card token: `dark:bg-black/95` on the collapsed sidebar and `dark:bg-black` on
  both collapsed rails. On a charcoal page a hardcoded black rail sits *darker*
  than the surface it is meant to lift off.
- The palette lives in two places — `THEME_PRESETS` in `App.jsx` and the `:root`
  block in `styles.css` — and the App.jsx copy is written onto the root at
  runtime, so it wins. Both were changed together; changing one alone looks like
  the edit did nothing.
- Measured in the desktop shell: default renders `rgb(29,28,27)` with
  `theme-color` `#1d1c1b`; Soft's shell renders `rgb(236,238,244)` instead of
  transparent, so the grey band is gone; overflow 0 in every skin.
