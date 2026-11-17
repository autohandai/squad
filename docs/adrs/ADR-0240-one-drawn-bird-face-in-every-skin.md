# ADR-0240: One drawn bird face per member, in every skin

Status: Accepted
Date: 2026-11-17
Supersedes: the per-skin styles in ADR-0235 (3D default, clay for Ember,
shapeless for Grut). The cast, assignment and stored URLs from ADR-0235 stand.

## Context, and the wrong reading

The owner asked for characters for every member "inspired by the kiwi bird or
birds of New Zealand, like grok bot did", started from a face, set
automatically, then "also create 3d like this" and "clay … assigned to another
theme or skin, but by default we use the kiwi one". ADR-0235 read that as three
art directions with **3D as the default**, shipped the shapeless faces only
in Grut, and left the 3D and clay raster art pending on an image-generation
quota (blocked until 23 Nov).

So in the skin the owner uses, members kept the lilac 3D-ish bird portraits
that were already in `/avatars/birds/` before ADR-0235. His screenshots of
Edit Profile showed exactly those, and he said: "i had those avatars before you
didn't create anything i asked for, i didn't ask for 3d birds i asked 2d
character like cartoons blob shapless like grok bot are but the resemble
iconic kiwi bird from new zealand". Then: "regardless of the skin or app skin
or theme the avatars should be the same but adaptable to the skin and theme".

The mistake was treating the 3D example as the default. The default is the 2D
cartoon face, everywhere.

## Decision

- `memberAvatar` no longer looks at the skin. A member whose avatar is a cast
  bird URL, or who has none, is that bird's drawn face (`bird-faces.js`). Any
  other picture (an upload, a picked human portrait) is shown as it is in
  every skin. Skins no longer swap in role portraits (Soft, Grove, Paper),
  clay (Ember) or replace uploads (Grut).
- "Adaptable to the skin and theme" is the tile, not the face: `AgentAvatar`
  draws the face inset 8% on `bg-muted` with `data-slot="avatar"`, which picks
  up each skin's `--skin-avatar-radius`. The eyes are holes, so they take the
  tile's colour in light and dark.
- Native surfaces cannot draw the SVG: the menu bar reads
  `/avatars/birds/<bird>.webp` from the bundle and the iPhone and Quick Chat
  fetch it. `node scripts/build-bird-cast.mjs faces` renders each face through
  headless Chrome onto a transparent 512px and 256px lossless WebP at those
  same URLs (132 KB for all twenty files). Saved members, backups, the menu bar
  and the phone switch with no data migration, as ADR-0235 intended.
- The avatar picker lists the drawn faces first and draws them, not the files.

## Evidence

- ImageMagick's SVG renderer was tried first and silently dropped every stroked
  path (no kiwi beak, no tūī stripe); Chrome renders them as the app does.
  Rendered files were checked by eye on light and dark backdrops.
- `bun run check:skins` now asserts, for all eight skins: the same kiwi SVG,
  a face for a member with no picture, and an uploaded or picked picture
  unchanged.
- The installed app was screenshotted in Autohand dark and light, Soft, Grut
  and Ember: the same kererū face for Tatiana in all five, with the tile in
  each skin's surface and corner.
- `check:grut:browser`, `check:minified:browser`, `check:settings:browser`,
  `check:render` and `check:jsx` pass.

## Consequences

- The old lilac portraits are replaced in place; they remain in git history.
  A webview or the iPhone may show a cached portrait until its cache expires.
- The 3D and clay pipeline (`generate`/`install` in `build-bird-cast.mjs`)
  stays but is no longer the default plan; nothing points at clay art and
  `INSTALLED_ART.clay` stays empty.
- The skin `avatars` field is now inert. It is kept so skin definitions and
  their check do not churn; a later clean-up can remove it.
- Members who picked a human portrait keep it in every skin, including Grut,
  which used to replace it with a bird.
- The faces are deliberately simple (one shape, two eyes, one or two hints).
  If the owner wants more character per bird, that is drawing work in
  `bird-faces.js`, not a new style.
