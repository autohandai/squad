# ADR-0243: 300 birds, one picker, and members changing their own avatar

Status: Accepted
Date: 2026-11-17
Amends: ADR-0241 (country grouping), ADR-0240 (picker)

## Context

After ADR-0241 the owner, who loved the drawn bird faces, asked:

> You don't have to call the categories for the avatars by the country. Create
> 300 of them. And also make it easy for me to change the avatars for end users
> to change the avatar of their preferred squad member. Obviously, whenever
> they change it reflects everywhere so it avatars itself can change their own
> avatar too through our handy squad MCP.

So there were three asks: 300 birds with no country headings; changing a
member's avatar has to be easy and has to show everywhere; a member can change
its own avatar through the Squad MCP server.

The state before this change:

- 26 hand-drawn faces in `bird-faces.js`, grouped New Zealand / Brazil /
  United States in the picker (`BIRD_REGIONS`).
- The only way to change a member's picture was Edit Profile, which showed all
  the birds in a 288px box with no search.
- **What we got wrong first:** we assumed that saving a picture in the app
  already reached every surface, because the sidebar changed straight away.
  A browser check that reloaded the page proved otherwise: the member came back
  as its old bird. `OwnershipBootstrap` rebuilds the roster from the bridge's
  copy of each member on every launch and keeps only pinned and hidden from the
  device cache. `channelActionMember` never sent `avatar` to that copy, and
  `updateAgent` did not even write to the bridge for an avatar-only change. So
  until now, any picture picked in Edit Profile went back to the role's bird the
  next time Squad opened. In real use the copy usually had no avatar at all, and
  `normalizeAgentCopy` gave the member `birdAvatarForRole(...)`.

## Decision

### 300 birds, composed rather than drawn one by one

The 26 drawn faces stay exactly as they are. Their flat, 3D and clay SVG is
byte-identical to ADR-0242's, and `check:skins` pins a SHA-256 of the 26 so
they cannot drift. The other 274 are **real species from around the world**,
composed from one line each in `src/lib/bird-species.js`:

```
cockatoo|Sulphur-crested cockatoo|squat #f4f2ec|hook #2e3034|crest:fan #f3d02e
```

`src/lib/bird-composer.js` turns a line into the same `{ eyes, layers }` shape
the drawn faces use, so `birdFaceSvg`, the avatar styles and the raster
pipeline treat them all the same way. The parts:

- six head shapes (egg-shaped: round, tall, wide, squat, and two side views
  looking right);
- 20 beak kinds (front: tri, small, cone, thick, long, drop, hook, bighook;
  side: short, dagger, needle, curve, upturn, spoon, sidehook, bill, sidecone,
  big, pouch; and none, for birds whose frontal shield is the beak);
- crests behind the head (peak, tuft, plume, swept, fan, horns, mohawk, spray,
  wisp, helmet, comb), and a tail;
- marks over the head (cap, hood, mask, stripe, front, bib, breast, belly,
  collar, face, disc, spectacles, eyering, brow, cheek, ear, throat, forehead,
  crown, tie, spots, streaks, moustache, patches, wattle, shield, casque).

Marks that touch the head's edge follow it exactly: they are traced along the
same elliptical arcs as the head, so a cap or bib never sticks out. The eye rule
is the drawn cast's rule written down. The eyes are holes through every layer
that covers them, so they take the tile's colour. If the top layer at the eyes
is pale, they sit over a dark mark instead (the bald eagle and puffin rule from
ADR-0241). If it is near-black, they sit over a cream mark, so they show up on a
dark tile (see Evidence).

Ids stay lowercase letters, because `birdFromAvatar` reads them out of
`/avatars/birds/<id>.webp`. Labels that are Māori or Portuguese carry an
English name for search (`Tauhou/Silvereye`; the drawn birds have a small alias
table in `bird-cast.js`).

**No countries in the app.** `BIRD_REGIONS` is gone and nothing groups or
labels birds by country. `region` stays on the ten New Zealand birds only
because assignment (`birdForSeed`, `untakenBird`) hashes over them; that
invariant is unchanged, so no member's derived bird moved. The eleventh member
and later ones get the rest of the cast in cast order, as before.

### The picker

`BirdPicker` (`src/components/members/BirdPicker.jsx`) replaces the grouped
grid everywhere: Edit Profile, New member and the custom role form.

- A search field ("Search 300 birds") that matches the start of a word in the
  name or the English alias: "owl" finds Barn owl, not Peafowl.
- The bird the member had **when the picker opened** comes first. It is not the
  live selection: a cell that jumped to the front when clicked was the first
  thing the browser check caught.
- One keyboard stop with roving focus: arrow keys (columns are measured from
  the grid's width), Home and End, Enter to choose. ArrowDown from the search
  field goes into the grid.
- Fixed 48px cells in a fixed-height scroll area, so the grid never reflows.
  Faces are drawn only when a cell scrolls within 240px of view
  (IntersectionObserver), and each markup string is built once per bird and
  style.
- The selection ring sits on the tile, so it takes the skin's avatar corner.

### Changing it from where the member is

`MemberAvatarDialog` ("Change Iris's avatar … It changes everywhere Iris
appears") opens from:

- the face on the member's profile card (the card's face is a button; "Change
  avatar" shows on hover and focus);
- the chat header's profile popover (the face, and a Change avatar button next
  to View profile);
- every member menu (directory row, sidebar row, chat header): **Change
  avatar…**.

Save goes through `updateAgent`, which now writes an avatar change to the
bridge. `channelActionMember` sends the member's bird to the bridge copy. An
uploaded picture is not sent: it can be up to 2 MB, and `channels.json` should
not carry that, so the device keeps it and the bridge copy gets `""`.
`withCachedMemberViews` restores a cached avatar only while the bridge copy
names none, so a bird chosen anywhere (including by the member) wins over the
cache. The status snapshot that the menu bar reads is posted 250 ms after any
avatar changes, instead of waiting for the 15 s cadence. The phone host's member
rows now carry the same `/avatars/birds/<bird>.webp` (never an uploaded
picture).

### Members change their own avatar (Squad MCP)

Two tools on the `autohand-squad` server, both allowed by default in the Squad
team tool group, and both of which a person can block:

- `squad_avatars { query?, page? }`: the cast, searchable by name, 40 birds per
  page.
- `squad_set_avatar { bird }`: the calling member only. It never takes a
  member argument, a URL or an image.

`server/team/member-avatar.mjs` resolves the id with `birdById`, stores
`/avatars/birds/<bird>.webp` on the member's bridge copy, and returns a
`profile` receipt (`"Iris is now the Kea."`). This follows `squad_set_fallbacks`
(ADR-0222): the write uses the member's saved copy rather than anything the
tool sends (`avatarActor: 'agent'`, like `modelRoutingActor`), the profile
revision goes up, and `setAccess` refuses an agent avatar patch that is not a
lone cast bird. The browser applies the receipt as it applies a rename, from
the stream or later from `/api/runs`, so the change reaches every surface
without a reload.

## Evidence

- **Contact sheets:** 300 faces at 96px and 32px, on the light (`#eae9e4`) and
  dark (`#323130`) tiles, rendered four times
  (`node scripts/bird-contact-sheet.mjs <dir> <from> 50`) and checked by eye.
  The first pass found these problems:
  - a free oval under the beak read as an open mouth (house sparrow, barn
    swallow, hawfinch, quail, white wagtail, grosbeak);
  - moustache strokes straight down from the eyes read as tears;
  - a forehead dot read as a third eye;
  - a collar band just under the beak read as a grin (condor, Australian
    magpie, jabiru, Magellanic penguin);
  - crests were clipped at the top of the box;
  - near-black birds lost their eyes on the dark tile.

  The fixes went into the composer rules, not into individual birds: throats
  hang from the beak like the chickadee's bib and are wider than the beak;
  moustaches slant outwards; foreheads run into the beak; collars sit lower;
  crested birds use the squat head; near-black faces get cream eyes. 26 species
  lines were changed in the second and third passes. The fourth pass, on the
  final drawings, still found four faces that read wrong (the white wagtail's
  bib looked like a shout, the grosbeak's and bird-of-paradise's throats like
  tongues, the tico-tico's white throat like teeth), and those four lines were
  changed too. Sheets of the final cast were reviewed on both tiles.
- **Sizes:** composed faces are 359–1,031 bytes of SVG (627 on average); the
  drawn 26 are at most 894. Mix: 152 round, 73 side, 26 small side, 11 tall,
  8 wide and 4 squat heads; 20 beak kinds in use.
- **Distinct:** all 300 flat SVGs differ. `check:skins` also asserts that no
  two composed birds share the same head, beak, crest and marks in colours
  closer than 60 in RGB distance; 0 pairs do.
- **Rasters:** `node scripts/build-bird-cast.mjs faces` now renders through one
  Playwright Chrome. It rendered the 274 composed faces (3,334,478 bytes of
  lossless WebP at 512 and 256px; the first run took 65 s) and left the 26
  existing files untouched. All 600 files total 3,715,092 bytes.
- **MCP:** `node scripts/check-member-avatar.mjs`, using a real channels store
  and team service, checks:
  - `squad_avatars` paging (8 pages of 40) and search ("kingfisher" finds the
    kōtare);
  - setting "Kea": saved on the bridge copy, revision +1, receipt accepted by
    `profileReceipts` and `unappliedProfileReceipts`;
  - refusals for `dodo`, a bird URL, an https URL, a data URI, `../kea` and a
    `member` field;
  - another member left untouched, a removed member refused, and a person's
    plain profile patch refused when it carries `avatar`.
- **Browser:** `node scripts/check-bird-picker-browser.mjs`, the dev bridge
  with the fixture engine, checks:
  - Edit Profile lists 300 birds with no country text;
  - the profile card's face opens the dialog with all 300 birds, the Tūī first
    and checked, and 80 of the 300 faces drawn once the grid settles (the
    cells in view and within 240px of it);
  - one tab stop, focus in search;
  - "owl" gives 9 birds and no peafowl, with the grid height unchanged within
    1px;
  - ArrowDown and ArrowRight move focus, and a clicked bird stays in place;
  - Save changes every face of the member, and the status snapshot had the new
    bird 332–361 ms after Save (across seven runs);
  - the bridge copy holds the bird and it survives a reload;
  - the member menu's Change avatar… opens on the current bird;
  - a real fixture-engine turn that calls `squad_set_avatar` changes the bridge
    copy, this window's stored roster, the sidebar, header and chat faces and
    the status snapshot, without a reload, and the chat shows "Wren Tester is
    now the Kea".
- `scripts/check-mobile-host.mjs` asserts the phone host's member row carries
  `/avatars/birds/kea.webp` and leaves out an uploaded picture.
- `check-teams` asserts the bridge's bird wins over the device cache, that a
  device-only upload survives a launch, and that a cached URL never becomes an
  avatar.

## Consequences

- **The composed faces are more regular than the drawn 26.** They are egg
  shapes with traced marks, not hand-drawn blobs. They are recognisable by
  colour and one to three marks; they will not all be as charming as the kiwi.
  Redrawing a favourite by hand is still possible: add it to `FACES` and remove
  its species line (the composer refuses a bird that is in both).
- Near-black composed birds have cream eyes. The drawn tūī and tucano keep
  holes, so on a dark tile they are still harder to read than the composed
  black birds. They were left alone to keep the 26 byte-identical.
- Black birds have little edge contrast on a dark tile, as ADR-0241 already
  noted for the tūī.
- Species ids are permanent: they are stored in members' URLs. Renaming a
  label is free; renaming an id moves members back to their role's bird.
- An uploaded picture still lives only on the device that uploaded it. Another
  device sees the member's role bird. Sending pictures to the bridge copy
  needs a size-bounded store, not `channels.json`.
- The bridge copy's `avatar` is not a revisioned profile field: a stale window
  saving its whole member could put an older bird back after a member's own
  change. That window would have applied the receipt already, so this needs two
  windows racing.
- The bundle carries 3.7 MB of bird WebP, up from 0.38 MB, so that the menu bar
  can read faces from disk with no network.
- The iPhone app does not render `avatar` yet: the host now sends it, but
  squad-mobile still draws initials. Native surfaces still show the flat face
  whatever the avatar style (ADR-0242).
- The sign-in and update perch (ADR-0245) draws its birds from the whole cast,
  so it now meets composed birds as well as the drawn 26; the kiwi still leads.
  `check:signin-update:browser` passes on this branch (12 tests).
- Quick Chat shows the new faces but does not open the picker; changing an
  avatar is done in the main window.
- Search knows English aliases only where we wrote them; a Portuguese or Māori
  name for one of the composed world birds will not find it.
