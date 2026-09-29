# ADR-0060: Panel corners agree with the window's

Date: 2026-09-30
Status: Accepted

## Context

The owner, with a zoomed screenshot of the window corner: "feels a little wrong
on the edges."

The grey band in that screenshot was a separate bug (ADR-0059). What was left
after fixing it is geometry.

An AppKit probe — compiled and run rather than remembered — reports
`NSThemeFrame._cornerRadius = 12.0` points on macOS 15.5, identical for a plain
titled window and for the exact style this app builds
(`TitleBarStyle::Overlay` + `hidden_title` + `transparent`). Points map 1:1 to
CSS pixels at any backing scale, so **the window's corner is 12px**. The same
probe puts the traffic lights at y 6..22, which confirms `--titlebar-inset: 28px`
clears them with 6px to spare; that number is right and does not change.

The frame mask clips, so the app can only ever paint a *smaller* visible corner,
never a larger one. The Soft skin was painting 20px panels inside a 10px inset.

Concentric corners — a margin that stays the same width all the way round —
require `inner = outer − inset`. Two consequences:

- **12px is a ceiling.** No panel radius above it can agree with the frame at
  any positive inset. 20px was past the ceiling before the inset was counted,
  so 20/10 could not be fixed by tuning either number alone.
- Measured on the real geometry, the margin was 10px along the flat edges but
  **17.5px across the diagonal** — the window's curve crosses at 4.97px from the
  corner and the panel's at 22.43px. The page colour pooled in each corner
  instead of running as an even border. That, not the absolute radius, is what
  reads as the corners disagreeing.

`DESIGN.md:8` had already said it: "Keep border radius restrained, usually in
the 4px to 8px range. Avoid heavy bevels, **bulbous corners**…". The 20px I
shipped in ADR-0058 was outside this repo's own contract, not merely
non-concentric.

## Decision

**Soft: 8px panels inside a 4px inset.** `inner = 12 − 4`, so the margin is 4px
at every point including the diagonal. Both numbers sit inside DESIGN.md's
range, and the skin keeps its identity from elevation and palette, which is what
DESIGN.md says identity should come from.

**Grut: 12px, no inset.** Concentric by definition at inset 0, and at the
ceiling rather than above it.

**Default: 8px.** This is a correction, not a change of direction — the
stylesheet had always been `0.5rem`, and the skin system raised it to `0.625rem`
without cause. The default skin has no inset and its panels reach the window
edge, so it has no visible outer corner of its own to reconcile.

**The frame radius is not touched.** Tauri 2 exposes nothing for it and AppKit's
is private. Painting past the mask fails twice over: the vibrancy view behind is
square, so the area between the panel's curve and the mask shows the window
material — the same band, four times over in miniature; and rounding the effect
view instead makes that region fully transparent, which would cut a bite of
desktop out of the corner for the default skin, whose sidebar really is
transparent. The value is also not stable across releases — 10pt before
Sequoia, 12 now, larger on Tahoe — which is reason enough not to hard-code a
dependency on it beyond this check.

## Consequences

- `check-skins.mjs` holds the geometry: no skin may exceed the 12px ceiling, any
  skin with an inset must satisfy `radius == 12 − inset`, and the inset the
  stylesheet applies must be the one the radius was chosen for. Verified by
  putting 20px back and watching it fail with "nothing above the window's 12px
  frame mask can agree with it at any inset".
- The 12px constant is asserted in one place with the measurement recorded
  beside it. If a future macOS changes the frame radius, one number moves and
  the check says which skins no longer agree.
- Re-measured after the change: all three skins render with page overflow 0 and
  no console errors in the desktop shell.
