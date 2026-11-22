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
    Flat also writes a vtracer SVG to `public/avatars/birds-svg/` for the
    website.
  - 3d goes to `public/avatars/birds-3d/` and clay to `public/avatars/clay/`.
    Neither writes over flat any more.
- **`INSTALLED_ART` lists, per style, the birds that have a picture.**
  `paintedAvatarSrc()` returns that picture, and `AgentAvatar` shows it as an
  image in a round tile. Any other bird keeps its drawn face and the style's
  filter, so a half-installed style never shows a missing image.
- **Masters stay out of git.** They are 1024px PNGs in
  `assets/characters/<style>/`: 124 MB for 26 + 26 + 300 birds, measured with
  `du -sh`. They are git-ignored and kept on the machine. The repository holds
  only the served WebP: 512px and 256px for each bird.
- **The website marketplace** takes the flat SVGs through
  `scripts/export-bird-faces.mjs`. A bird without a traced SVG gets its drawn
  face, so the export always writes all 300 files.

## Evidence

- 3d: 26 masters generated, reviewed on a contact sheet and installed. That
  is 930 KB of WebP.
- clay: 26 masters generated with 0 failures, reviewed on a contact sheet and
  installed. That is 676 KB of WebP (`install clay` output).
- flat: 66 of 300 had been generated after 43 minutes, about 1.5 a minute
  with three in parallel (master file times 10:33 to 11:16 on 23 Nov). The
  first 42 were reviewed on a contact sheet and are on-brief.
- `check-member-avatar`, `check-skins` (3 styles x 300 birds) and
  `check:bird-picker:browser` pass with the painted styles installed.

## What was learnt

- `codex exec -i <image> "<prompt>"` read the prompt as a second image path
  and generated from the references alone. A `--` before the prompt fixes it.
- The first version of `served('3d')` still pointed at `public/avatars/birds/`.
  Installing 3D would have replaced the flat faces that the menu bar and the
  iPhone show. Writing 3d into its own folder is what made it safe to ship the
  styles separately.

## Consequences

- Painted 3D and clay exist for the 26 named birds only: the New Zealand,
  Brazilian and American cast. The other 274 still show their drawn face with
  the style's filter. Painting them means about 550 more generations, roughly
  six hours on the bridge, and they are not done yet.
- Flat ships when all 300 are generated and reviewed. Until then the app
  shows the drawn flat faces, so it never mixes drawn and painted flat birds.
- The masters live on one machine. Losing them means regenerating, and a new
  generation will not match the old pictures exactly.
- Each style that gets installed adds about 1–2 MB of WebP to the app per 26
  birds.
