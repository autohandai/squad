# ADR-0235: New Zealand bird characters, one cast in three styles

Status: Accepted (shapeless shipped; 3D and clay raster art pending, see below)
Date: 2026-11-17
Amends: ADR-0058 (Grut blob faces)

## Context

The owner asked for a character for every Squad member, inspired by the kiwi
and other New Zealand birds and assigned automatically, in three art
directions: a soft toy-like 3D bust as the default with the kiwi as hero, flat
"shapeless" faces (one organic blob with two eye marks), and clay busts for a
different skin. He showed other products' mascots as references. We take the
ideas (toy 3D, flat blob faces, clay busts), not their characters.

What was there before:

- `public/avatars/birds/*.webp`: ten bird portraits (kiwi, tūī, kea, kererū,
  pūkeko, ruru, pīwakawaka, takahē, kākāpō, kōtare) on a lilac gradient, 20
  to 44 KB each. `src/data.js` `birdAvatarForRole` gives each role a bird and
  hashes unknown roles onto one. Members store the URL in `member.avatar`.
- Skins choose faces through `memberAvatar(member, design)`. `photo` shows
  `member.avatar`, `portrait` shows a role portrait, `blob` (Grut) shows a
  generic blob hashed from the member id (ADR-0058), unrelated to the
  member's bird.
- The native menu bar does not fetch avatars over HTTP. It reads
  `runtime/dist/avatars/<path>` from the app bundle for any avatar starting
  with `/avatars/` (`src-tauri/src/quick_chat.rs`, `member_icons`). The iPhone
  app and Quick Chat use the same URL over HTTP.

## Decision

**A member is one bird. The skin chooses how the bird is drawn.**
`src/lib/bird-cast.js` holds the cast, maps an avatar URL to its bird
(`birdFromAvatar`), and gives members with a custom picture a stable bird
hashed from their id (`birdForMember`).

**Stored URLs do not change.** The 3D cast replaces the files behind
`/avatars/birds/<bird>.webp` in place (512px, plus `/avatars/birds/256/`).
Saved members, the bundled menu-bar lookup, Quick Chat and the iPhone then all
update with no data migration and no change to `src-tauri/`. The alternative,
new URLs plus a migration that rewrites `member.avatar`, would have touched
saved data, the native code and the phone, and still broken avatars stored in
backups.

**Shapeless faces are hand-authored SVG** (`src/lib/bird-faces.js`), drawn
inline the way blobs were. Each face is under 1.6 KB of markup, crisp at
every size, and the eyes are even-odd holes so the page shows through in light
and dark. In Grut, `memberAvatar` returns the member's bird face. The generic
blob fields are still returned for anything that reads them.

**Clay goes to Ember.** Ember is warm ink, rust accents and generous studio
spacing, which suits a handmade plasticine look on flat coloured backdrops.
Paper, Grove and Soft keep their role portraits, which are their identity.
Ember changes `avatars` from `photo` to `clay`. A cast bird shows
`/avatars/clay/<bird>.webp` only if that bird is listed in
`INSTALLED_ART.clay`. A custom picture is never replaced by clay. Grut does
replace it, as it already replaced it with a blob, because Grut promises a
drawn face for everyone.

**Assignment.** A known role keeps its bird, because the role hint is part of
the design contract. Any other new member (blank "chat with a new member",
team import without a role match) gets a bird nobody on the roster has
(`untakenBird`), starting from one hashed from its seed. When all ten are
taken it shares the seed's bird. Only the two creation paths that have the
roster in scope pass it (`startBlankMember`, `ImportTeamDialog`). Team builds
and designed members still hash.

## Raster art is pending, and why

The 3D and clay casts were not generated in this change. The
`gpt-image-bridge` skill (gpt-image-2 through the codex CLI) was run for the
kiwi in both styles. Both calls failed at once with "You've hit your usage
limit … try again at Nov 23rd, 2026 7:50 AM" (codex logs, 2026-11-17). The
other route available, treg's GPT Image 2 at $0.081 per image, reported a
team balance of $0.00. Topping it up is the owner's decision, not this
change's. No other image API credentials were present.

So this change ships everything except the pixels:

- `scripts/build-bird-cast.mjs prompt|generate|install <3d|clay>` holds the
  art-directed prompts (bust framing for a circular crop, studio light, plain
  backdrop for 3D, flat colour backdrop for clay, and no text, watermark,
  human features or likeness to existing mascots). It writes 1024px masters
  to `assets/characters/<style>/` (not served) and installs 512px and 256px
  WebP (`magick … -extent square -resize -quality 82`, tested on a 1200×1024
  input → 512×512, 2 KB). For clay it also rewrites `INSTALLED_ART.clay`.
- Until then, Ember and the default skin show the existing lilac portraits,
  exactly as before. Nothing points at a missing file. Radix drops an image
  that 404s and shows an initial, which is why clay is gated on a list rather
  than on `onError`.

Once quota returns: `generate 3d` and `generate clay`, look at every master
and regenerate any that are off-model, then `install 3d` and `install clay`,
and update this ADR with the sizes.

## Evidence

- `bun run check:skins`: ok. New assertions: Grut draws the member's own
  bird; ten distinct faces, each under 1.6 KB with even-odd eyes; every listed
  clay file exists; clay never replaces a custom picture; ten unknown-role
  members get ten different birds; a role match keeps its bird.
- `bun run build`, `check:render`, `check:minified:browser` (11 passed,
  5 skipped by config) and `check:grut:browser` (3 passed) all pass.
- Contact sheet of the shapeless cast at 120, 32 and 24px on Grut light and
  dark. The first pass was revised: the kererū bib and the fantail's throat
  band read as grins, the tūī's tuft read as a nose, and the kea's orange
  flash was too thin to see.
- App screenshots with ten seeded members, one per bird, in default, Ember and
  Grut. Grut shows the bird faces in the sidebar and chat header. Default and
  Ember show the existing portraits, with no page errors.

## Consequences

- The default and clay casts, the owner's main ask, are not visible yet. The
  default skin still shows the lilac portraits that DESIGN.md now calls the
  previous set.
- Replacing files in place means a webview or iPhone that cached the old
  portrait may show it until the cache expires. We accept this so stored URLs
  never change.
- `install` writes 256px variants, but nothing selects them yet, so every
  surface will load the 512px file. Adding `srcset` is left for when the art
  exists and sizes can be measured.
- Members with a non-bird avatar (riso prints, uploads, `robin`/`wren`
  fixtures) keep it in default and Ember, and get a hashed bird only in Grut.
- Team builds, designed members and role-matched members can still share a
  bird. Only blank and imported members avoid duplicates.
- No static SVG files are published for the shapeless cast. The iPhone and
  the menu bar keep showing the 3D file, because neither has a Grut skin.

## Amendment (2026-11-17): members with no picture

The owner went back to the Squad he had been building (Chief of Staff and
Tatiana) and both showed a letter, not a bird. Their saved profiles carry no
`avatar` at all (checked in the dataset's `app/agents/*/profile.json`): they
were made before the cast. `normalizeAgentCopy` only moved members with an
old role portrait onto a bird, so an empty avatar passed through and Radix
drew the initial.

An empty avatar now gets `birdAvatarForRole(employeeType, role, id)` on load,
the same rule a role portrait follows. A known role keeps its bird (checked
with `bun` against `src/data.js`: Chief of Staff matches no role and hashes
from its id to the pūkeko; Staff Product Designer matches "designer" and gets
the kererū). Two such members can land on the same bird, because load does
not see the roster's other picks; we accepted that rather than make load order
decide who gets which bird. A custom picture is still never replaced.
