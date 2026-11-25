# ADR-0281: The phone changes a member's avatar, personality and skills

Status: accepted, 2026-11-26

## Context

Contract 0.10 (ADR-0279) let Squad for iPhone read a member's profile and edit
its name, role, description and instructions through the computer. The owner
asked next for the rest of what the desktop's Edit Profile changes: the avatar,
the personality and the skills. Each of the three had its own obstacle.

- **Avatar.** An avatar is not one of `MEMBER_PROFILE_FIELDS`: the revisioned
  PATCH refuses it. The desktop window sets it by saving the whole member copy
  (`PUT /api/members/:id/channel-access`), and the only narrow path
  (`avatarActor: 'agent'`, ADR-0243) is the member's own `squad_set_avatar`.
- **Personality.** The PATCH already took `personality`, but it is stored as
  a PERSONALITY.md profile file: `# Personality`, a `Role:` line, then the
  text. The first host check read back
  `"# Personality Role: Phone-edited role Dry humour, short answers."`, the
  file flattened by `clip`, not what the person typed.
- **Skills.** The PATCH takes skill package ids and validates them against the
  catalog, but the phone had no way to see the catalog.

## Decision

Contract 0.11, capability `profileEdits`:

- `member.update` also takes `personality` (600 characters, the profile
  limit) and `skills` (up to 32 package ids, the route's own limit; empty
  clears). The profile returns `personality` as the person's text only
  (`personalityFromFile` in `member-shaping.js` is the inverse of
  `personalityFileContent`), plus `skillIDs`, `maxSkills` and `avatar`.
- `member.skills` lists the packages for the member's workspace through the
  same `/api/skills/catalog` the operator's `list_skills` uses, unavailable
  packages dropped, 40 a page.
- `member.avatar.set` takes a cast bird id and an `expectedRevision`. It goes
  to a new `PUT /api/control-plane/members/:id/avatar`, which calls `setAccess`
  with `avatarActor: 'person'`. `agent-channel-actions` treats it as the
  avatar-only path ADR-0243 built: a lone `avatar` key, a cast bird, the
  member's saved copy as the base, the revision bumped, plus the revision
  check the phone sends.

## Consequences

- The phone chooses birds only. Uploading a photo from the phone is not
  built: it needs an image pipeline (size, type, the 2 MB desktop limit) over
  the relay, and the phone already draws the 300 birds locally.
- An avatar change bumps the profile revision like a rename does, so an edit
  on the other device made from the older revision is asked to look again.
- Skills are assigned, not installed: as with `set_member_skills`, packages
  install on the member's next turn on the computer.
- Abilities, memories, model routing and folders stay desktop-only; they
  depend on the computer's paths and grants.

Evidence: `node scripts/check-mobile-host.mjs` (personality round trip shows
the stored file and the phone's text, skills list and clear, a 33-skill
refusal, the kea chosen and read back, a stale avatar change refused, a
non-bird and a URL refused); `check-member-avatar`, `check-member-management`
and `check-member-default-routing` still pass.
