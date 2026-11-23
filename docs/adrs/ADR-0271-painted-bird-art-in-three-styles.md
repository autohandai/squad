# ADR-0271: Painted bird art in three styles

Status: accepted, 2026-11-23

## Context

"redesign all the profile pictures we have so far … using the cli codex with
this prompt [a GPT Image brief for premium minimalist geometric flat-vector
mascots] then use the other 3d and clay version and change on squad and on our
marketplace", then "for all birds not just as examples i gave".

Until now every avatar style was the same drawn SVG face (ADR-0240). The 3D
and clay styles came from a CSS filter over it, and the 3D pipeline from
ADR-0235 wrote its masters over `public/avatars/birds/`. The menu bar and the
iPhone read that folder as the flat face.

## Decision

- **Three painted styles**, all generated through the codex CLI image bridge
  (`gpt-image-bridge`):
  - **flat** uses the owner's brief: 6–12 geometric shapes, negative-space oval
    eyes, no outlines or gradients, head and upper neck. Kiwi, tucano and
    beija-flor go with every flat request as reference images, so the 300
    birds stay one family. Each of the 274 composed birds is described from
    its `COMPOSED_BIRDS` colours.
  - **3d** and **clay** keep the ADR-0235 prompts.
- **Each style has its own folder**:
  - flat replaces the files in `public/avatars/birds/`. The URLs members
    already store, the menu bar and the iPhone pick it up without a rewrite.
    Each bird stays on its plain white background, trimmed and centred with
    even padding. Flat also writes a vtracer SVG to `assets/birds-svg/` for
    the website; that folder is committed but not shipped in the app.
  - 3d goes to `public/avatars/birds-3d/` and clay to `public/avatars/clay/`.
    Neither writes over flat any more.
- **`INSTALLED_ART` lists, per style, the birds that have a picture.**
  `paintedAvatarSrc()` returns that picture. `birdFaceSvg()` wraps it in its
  SVG, so `AgentAvatar`, the bird picker, the marketplace dialog, Settings ›
  Appearance and the perch all show the same picture. `{ drawn: true }` still
  returns the vector face, which the export and the checks need. Any other bird keeps its drawn face and the style's
  filter, so a half-installed style never shows a missing image.
- **Masters stay out of git.** They are 1024px PNGs in
  `assets/characters/<style>/`: 124 MB for 26 + 26 + 300 birds, measured with
  `du -sh`. They are git-ignored and kept on the machine. The repository holds
  only the served WebP: 512px and 256px for each bird.
- **The website marketplace** takes the flat SVGs through
  `scripts/export-bird-faces.mjs`. A bird without a traced SVG gets its drawn
  face, so the export always writes all 300 files.
- **Onboarding asks for the style** ("on the onboarding ask this question which
  style of the avatars they want to use"). Step 3, Avatars, comes after Layout
  and before the menu bar. Four birds are shown large in the chosen style;
  hovering over a style previews it. The choice saves at once to the same
  store Settings › Appearance uses. Flat stays the default.

## Evidence

- 3d: 26 masters generated, reviewed on a contact sheet and installed. That
  is 930 KB of WebP.
- clay: 26 masters generated with 0 failures, reviewed on a contact sheet and
  installed. That is 676 KB of WebP (`install clay` output).
- flat: 300 of 300 generated with 0 failures, three at a time, between 10:33
  and about 13:10 on 23 Nov. All 300 were reviewed on five contact sheets.
  One, the turaco, was off-model (a ragged outline) and was regenerated.
  Installed, the set is 4.7 MB of WebP and 9.8 MB of SVG (`du -sh`).
- `check-skins` now asserts that each installed bird shows its picture in
  every style and each other bird keeps its drawn face.
- `check-member-avatar`, `check-skins` (3 styles x 300 birds) and
  `check:bird-picker:browser` pass with the painted styles installed.

## What was learnt

- `codex exec -i <image> "<prompt>"` read the prompt as a second image path
  and generated from the references alone. A `--` before the prompt fixes it.
- The first version of `served('3d')` still pointed at `public/avatars/birds/`.
  Installing 3D would have replaced the flat faces that the menu bar and the
  iPhone show. Writing 3d into its own folder is what made it safe to ship the
  styles separately.
- The first flat install made the background transparent with a corner flood
  fill at 10% fuzz. That took the bald eagle's and the puffin's white heads
  with it. Comparing the opaque area at 2% and 10% fuzz found 136 of the 300
  birds losing 4–80% of themselves; normal birds lost under 1%. 2% did not
  help either: the eagle's face (251,248,246) is within the background's own
  noise (254,254,253), so it came out speckled. No fuzz separates them, so
  flat keeps its white. The brief allowed "white/transparent".
- Building the onboarding step showed that `STORAGE_KEYS` never had an
  `avatarStyle` entry. Every style choice since ADR-0240 was saved under the
  key `"undefined"`, and it only came back because the same undefined key was
  used to read it. It now has its own key, and the old key is read once as a
  fallback so nobody loses their choice.
- `e2e/onboarding-steps.spec.mjs` walks the new step: 3D shows four painted
  pictures and saves, then Flat saves. 5 tests passed and 1 was skipped
  (compact dark).

## Consequences

- 3D covers all 300 birds since 23 Nov evening (10 MB of WebP; reviewed on
  three contact sheets). The 274 composed birds are described from their
  `COMPOSED_BIRDS` colours with the kiwi and tucano masters of the same style as
  references. Clay followed the same way and covers all 300 too (8.7 MB),
  reviewed on three contact sheets.
- During that run three image requests hung for 3.5 hours although each ran
  under `timeout 600`. A watchdog now kills any request older than 12 minutes,
  and the missed birds are regenerated in a second pass.
- Flat faces are white discs on every tile. The old drawn faces let the eyes
  show the tile colour; in dark mode the flat birds now read as light
  stickers.
- The masters live on one machine. Losing them means regenerating, and a new
  generation will not match the old pictures exactly.
- Onboarding has five steps on the Mac, and four on the web.
- Each style that gets installed adds about 1–2 MB of WebP to the app per 26
  birds.
