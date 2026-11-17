# ADR-0242: Avatar styles — flat, 3D and clay, as one setting

Status: Accepted
Date: 2026-11-17
Amends: ADR-0235 (3D default, clay for Ember), ADR-0240

## Context

The owner's original ask had three parts: drawn shapeless faces inspired by
New Zealand birds for every member, "also create 3d like this", and "also
create in clay … assigned to another theme or skin", with the kiwi-led drawn
cast as the default. ADR-0235 planned 3D and clay as generated raster art; that
was blocked (the gpt-image bridge refuses until 23 Nov; treg's balance is
$0.00, about $1.62 for twenty images). ADR-0240 then made the drawn faces the
same in every skin, at the owner's request: "regardless of the skin … the
avatars should be the same but adaptable to the skin and theme".

So clay could no longer belong to one skin, and 3D and clay still did not
exist.

## Decision

3D and clay are **avatar styles**, a device setting in Settings › Appearance ›
Avatars: Flat (default), 3D, Clay. A style is the same face in a different
material, applied everywhere the app draws a face, in every skin and theme.

They are SVG lighting filters over the flat face (`birdFaceSvg(bird, { style })`
in `src/lib/bird-faces.js`), not new art:

- 3D: the face's alpha is blurred into a height map, lit with a point
  specular highlight and a distant diffuse light, plus a soft contact shadow.
  It reads as a glossy vinyl toy; the eye holes become shallow pits.
- Clay: fractal noise both nudges the edges slightly and roughens the height
  map; matte diffuse light only, no specular, a smaller shadow.

This needs no image service, keeps every face crisp at any size, keeps the
bird and its shapes identical across styles, and works for all 26 birds,
including the Brazil and US casts, with no per-bird work.

## Evidence

- Both filters were rendered for ten birds on light and dark tiles and
  checked by eye. The first clay pass was too subtle and frayed the puffin's
  white face, so the edge displacement went from 2.2 to 1.2 and the surface
  noise in the height map from 0.16 to 0.30.
- `check:skins` asserts the three styles, flat as the default and unchanged,
  and that each 3D and clay face carries its filter and every path of the flat
  face, for all 26 birds.
- In the installed app, choosing 3D, then Clay, then Flat in Settings ›
  Appearance changed the members list to `url(#squad-bird-3d)`, then
  `url(#squad-bird-clay)`, then no filter.

## Consequences

- The menu bar, Quick Chat files and the iPhone read
  `/avatars/birds/<bird>.webp`, which stays the flat face. They do not follow
  the style yet; doing so needs rendered 3D and clay files and a way to tell
  native surfaces the device's style.
- This is not the generated, photographic 3D or clay the original raster plan
  aimed at. If that is still wanted, `build-bird-cast.mjs generate|install`
  remains and can replace the filters once image generation is available.
- Every inline face carries its filter definition; identical ids across many
  faces on one page resolve to the same definition, which browsers handle, at
  the cost of about 1.3 KB of markup per styled face.
- `ADR-0235`'s "clay for Ember" is withdrawn: no skin chooses a style.
