# ADR-0058: Skins change the whole look, not the palette

Date: 2026-09-29
Status: Accepted

## Context

The owner: "one of the ideas i have is to allow users create skins for their
app, truly customise they way they want the look and feel, for now let's create
3 skins ... default (today's ui), this one and Grut ... which also change the
avatar for each."

Twenty theme presets already existed, and every one of them looks like the same
product, because a preset swaps 23 colour tokens and nothing else. The two
references do not differ from Squad in colour. One is defined by large radii,
soft shadows and panels that float on a tinted page; the other by flat surfaces
and members drawn as coloured blobs with eyes. Colour is the part that was
already solved.

## Decision

**A skin sets colour, shape, elevation, density and avatars.** Tokens reuse the
existing 23-name contract. Beyond them a skin sets `--radius` — which already
feeds `--radius-sm/md/lg/xl`, so every shadcn primitive reshapes for free — plus
elevation, density and where a member's face comes from.

**A skin may declare no colours at all.** The default skin declares none, so the
user's light/dark choice and all twenty presets keep working underneath it.
Switching to a skin and back loses nothing. Where a skin has an opinion it wins;
where it has none the preset shows through.

**A skin that is about being light says so.** `soft` forces the light surface
and `grut` the dark one, because a skin whose whole point is being light has
nothing sensible to show in the dark. Only the default skin follows the user.

**Elevation is a short list on purpose.** Two columns and the things that float
above them by nature. A skin that puts a shadow on every row is the card-heavy
bento surface `DESIGN.md` rules out, and the default skin sets elevation to
`none`, so all of it collapses and today's flat surface is untouched.

**Grut's avatars are drawn, not downloaded.** A blob is a shape, an expression
and a colour, so it is an SVG of about 360 bytes: 8 x 16 x 12 = 1536 of them,
crisp from a 16px list row to a 96px header, with the eyes punched through by
`fill-rule: evenodd` so the page shows through. Which blob a member gets is
hashed from its id, so it survives a reload, a rename and a reinstall.

**Soft's portraits are opt-in by slug.** Radix unmounts an avatar image that
fails to load, so an `onError` fallback cannot quietly swap in a replacement — a
missing portrait becomes an initial, not a photo. `SOFT_PORTRAIT_SLUGS` lists
the roles that actually have artwork; anything not listed keeps the member's
existing picture. The skin therefore works before the art exists.

## Consequences

- Measured in a headless browser, all three: default is dark at `#000000` with
  radius `0.625rem` and four photo avatars; soft is light at `#eceef4` with
  radius `1.25rem`, floating insets and four avatars; grut is dark at `#0d0d0f`
  with four blobs. Page overflow is 0 in all three and there are no console
  errors.
- Density is a scale on the root font size, and it is why soft ships at 1.
  At 1.15 the root became 18.4px, the page gained a scrollbar, and the scaled
  type started to disagree with the fixed-pixel icons beside it. The float
  reads from radius and shadow; it did not need bigger text.
- Soft's 10px inset has to be paid for out of the viewport, not added to it.
  Padding the shell alone cost 20px of scrollbar; chasing individual containers
  made it 1595px. The fix is the idiom this file already uses for the macOS
  title-bar inset — rewrite the viewport-height utilities, including the `lg:`
  variants inside Tailwind's own `lg` query. Missing those variants is what kept
  a 20px scrollbar after everything else was accounted for: the chat column asks
  for `lg:h-screen` and alone held the layout a full viewport tall.
- `check-skins.mjs` reads the token list out of `App.jsx`, so a skin that names
  one colour must name all 23 — a half-declared palette is the bug where a skin
  looks right until a chart or a destructive button appears. It also fails on a
  var no skin applies, on a listed portrait with no file, and if the blob hash
  stops reaching every bucket.
- That last check earned itself immediately. FNV over ids sharing an `asq_`
  prefix leaves the similarity in the low bits, and `hash % 8` gave every seeded
  member a triangle. The hash now avalanches before it is sliced, and three
  salted passes make three independent choices.

## Addendum, same day: the soft portraits

Sixteen role portraits now exist, one per role in the existing avatar set, drawn
with `gpt-image-2` under one art direction so they read as one cast: soft
editorial vector illustration, off-white ground, muted palette, a single coral
accent on the clothing. The role only changes the character.

They are **228 KB for all sixteen**, because each 1024px PNG is downscaled to a
256px JPEG and the original deleted immediately. Kept at source size they would
have added roughly 20 MB to a repository already carrying 21 MB of avatars, for
pictures the app draws at between 16 and 96 pixels. They use `.jpg` because the
existing role avatars do.

`SOFT_PORTRAIT_SLUGS` now lists all sixteen, and `check-skins` fails if any of
them has no file on disk. A role with no portrait - a custom one the user
invents - still falls through to its own picture.

The generation itself only works in the foreground. Detached with `nohup` every
call failed in about four seconds with no output at all, sixteen times; the same
command run normally produced a 1.2 MB image in about a minute. Anything
regenerating these should not background them with `nohup`.
