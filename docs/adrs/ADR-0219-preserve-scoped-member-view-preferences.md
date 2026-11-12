# ADR-0219: Preserve scoped member view preferences on startup

## Context and evidence

The Grut browser check could pin an older member and observe it first, but its
later group-chat screenshot showed the member unpinned after a full navigation.
`OwnershipBootstrap` deliberately replaces the cached roster with the verified
registry before mounting the app. Pin and Hide only changed the cached member
record, so that replacement discarded the person's view choices. The earlier
assumption that only the new recency sort was wrong was incomplete.

## Decision

Keep the canonical registry authoritative for membership and every profile and
access field. After ownership is activated, read the existing owner-scoped cache
and copy only the boolean `pinned` and `hidden` choices, plus their valid recorded
dates, onto matching canonical member IDs. Do not restore extra cached rows or
read unscoped legacy storage. This is shared startup behavior for all skins;
Grut uses the same choices rather than a second preference store.

## Consequences and evidence

Pin and Hide remain device view preferences, so this change does not synchronize
them to another computer or expose new profile fields through MCP. The source
registry can still remove or change a member regardless of the local cache.
Malformed or unavailable view data must not block loading the verified roster.

`check:teams` exercises stale names, workspace and permissions, a fake higher
profile revision, an absent cached member and malformed cache data: only the
four view fields may survive. `check:grut:browser` pins through the app, performs
full navigations in both layouts, then hides, reloads and shows a member again.
These are isolated fixture checks, not installed-app or live-account proof.
