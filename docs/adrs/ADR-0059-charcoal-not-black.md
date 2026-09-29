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

## Addendum: the light theme, and a check so this cannot drift

The light theme was the worse of the two. It was pure `#ffffff` with a ladder
only 11.5 L\* deep, `popover` was the *same colour as the page* so a dropdown
had no lift whatsoever, and it carried four different near-black inks
(`#171717`, `#080a0d` twice, `#1c241f`, `#101511`) — two with a green cast, one
with a blue one — which is why the same small type looked subtly different in
different places.

It is now anchored at `#f7f6f2`, the product's own off-white one step down, so
`popover` can stay pure white and actually be raised. The four inks collapse to
one, `#1b1b18`. Sixteen of twenty-three tokens changed; green and the charts are
untouched, and `destructive` still returns 5.17:1 on the new paper.

Ladder: background 96.9 · popover 100 (Δ3.1, was Δ0) · card 94.8 · muted 92.3 ·
accent 89.8 · border 85.6 — the border sits at Δ11.3 against today's Δ11.5, so
every divider keeps the weight it already had.

Contrast, computed: foreground on background **15.96:1**, muted-foreground on
background **5.33:1** (was 4.74), muted-foreground on muted **4.74:1** (was
4.31, *below AA*), foreground on card **15.14:1**, muted-foreground on card
**5.06:1** (was 4.54). The one pairing in either theme that reaches AA-large
only is muted-foreground on accent — 4.44:1 light, 4.47:1 dark — which is
secondary text on a transient hover fill.

`check-theme-tokens.mjs` now holds all of it: the two copies must agree on every
surface and ink token, both themes must clear AA on the five body-text pairings,
`card` may not match the page, `popover` may not match `card`, each theme gets
exactly one ink, and `index.html` must carry exactly one `theme-color` meta with
App.jsx keeping it in step. Verified by changing one copy only and watching it
fail with the reason.

Charts are allowed to inherit: `.light` is a partial override of `:root`, and a
chart colour that is briefly wrong before React runs is not worth duplicating a
palette for.

## Addendum: the vibrancy rule was the wrong shape

Three `!important` collisions came out of one four-selector rule — the padding
in ADR-0054, `.app-sidebar` in ADR-0058, and `.app-shell-root` above — and each
was invisible until the packaged app ran. Adding an opt-out per element as each
surfaced was treating the symptom.

Letting the window's vibrancy through is only ever right for a skin with no
opinion about its own surfaces. So the rule is now scoped to the default skin
and is no longer `!important`; a skin that paints its own panels simply paints
them, and needs no opt-out at all. Two of the four `!important` declarations in
the file are gone with it.

It matches positively on `[data-skin="default"]` rather than negating soft and
grut. Both `data-shell` and `data-skin` are set by App.jsx at runtime and not in
the same place, so there is a frame where the shell attribute exists and the
skin attribute does not — and a negated selector matches an element with no
attribute at all. `:not([data-skin="soft"])` would therefore flash the vibrancy
through a light skin on every launch. The positive form cannot.

Removing the opt-outs exposed something they had been hiding: Grut's sidebar was
only opaque because of the `!important` override, and underneath it the markup
carries `bg-card/70`. A translucent sidebar over an opaque page composites to a
value nobody chose. Grut separates its two columns by one deliberate step, so
that step is now stated outright.
