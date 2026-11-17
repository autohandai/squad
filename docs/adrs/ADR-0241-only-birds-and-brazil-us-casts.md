# ADR-0241: Only birds are built in; Brazil and United States casts

Status: Accepted
Date: 2026-11-17
Amends: ADR-0240

## Context

After ADR-0240 the owner said he "loved" the drawn bird faces and asked to
remove the other avatars "and make sure they don't surface again anywhere,
because they were associated with other skins", then to "generate more for all
birds in brazil and US". He also sent the member profile card, which framed the
face in a lilac mat (`AgentPhotoCard`, `bg-[#dcd2ff]`), and asked for no purple
borders.

What was still built in (measured: `public/avatars` was 22 MB, 45 entries):
16 role portraits (`/avatars/<role>.jpg`) used as role-template avatars and
offered in the picker; 27 "riso" prints (`nz-riso-set-*`) offered in the
picker; 16 Soft-skin portraits (`/avatars/soft/`). ADR-0240 had already stopped
skins from showing them, but the picker, role templates and any member saved
with one still could.

## Decision

**Only birds are built in.** The role portraits, riso prints and Soft
portraits are deleted (`public/avatars` is now `birds/` only). The picker lists
only birds; every role template starts as its role's bird. A member saved with
any built-in path that is not a cast bird is moved to its bird on load
(`normalizeAgentCopy`, `AVATAR_VERSION` 3), and until that is saved
`memberAvatar` already draws the bird for any `/avatars/` path. Uploaded
pictures (`data:` URIs) are the person's own and stay. Quick Chat's member
picker and role avatars draw the face too. The profile card's lilac mat is
gone; the face sits on its own skin tile.

**Brazil and United States casts**, drawn in the same style (one soft shape,
two eye holes, at most a few species hints), 26 birds in all:

- Brazil: tucano, arara-azul, bem-te-vi, sabiá, beija-flor, quero-quero,
  harpia, joão-de-barro.
- United States: bald eagle, cardinal, blue jay, robin, roadrunner, puffin,
  flamingo, chickadee.

Pale faces (bald eagle, puffin, chickadee cap) sit over a darker layer, so the
eye holes show that colour instead of a light tile. Each bird has `region`;
the picker groups them New Zealand, Brazil, United States.

**New Zealand stays the default cast.** Assignment (`birdForSeed`,
`untakenBird`) hashes over the ten NZ birds only, as before. Hashing over all
26 would have changed the bird of every member whose bird is derived from its
id. Brazil and US birds are chosen in the picker, and are assigned
automatically only once all ten NZ birds are taken (Brazil first, then the US,
in cast order).

## Evidence

- The 16 new faces were rendered on light and dark tiles and checked by eye;
  the flamingo's beak (read as an open mouth) and the blue jay's necklace
  (read as a grin) were redrawn after the first sheet.
- `node scripts/build-bird-cast.mjs faces` rendered 26 faces, 380,614 bytes of
  WebP at 512 and 256 px.
- `check:skins` asserts the removed files are absent, the picker and role
  templates offer only birds, a saved old portrait draws a bird, 26 birds in
  three regions (10/8/8), the first ten unknown-role members get NZ birds and
  the eleventh a Brazilian one.
- The attachment fixtures read a role portrait as their sample JPEG; they now
  carry a generated 16px JPEG inline. `check-chat-attachment-delivery` passes.
- `check:grut:browser`, `check:minified:browser`, `check:settings:browser`,
  the pair-phone menu check, `check:render` and `check:jsx` pass. The built
  bundle references no `/avatars/` path outside `birds/`.

## Consequences

- People who had picked a role portrait or riso print lose it for their bird;
  that is the owner's ask. Nothing in a backup is rewritten; a restored member
  with an old path is moved on load the same way.
- The NZ role hints remain the only role-to-bird mapping. Brazil and US birds
  carry no role hint.
- Region is not tied to locale. A Portuguese-language Squad still defaults to
  New Zealand birds; choosing a default cast by country is a later decision.
- Dark birds (tucano, puffin, harpia's crest) have less edge contrast on a
  dark tile than on a light one, as the tūī already did.
