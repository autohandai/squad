# ADR-0289: Publish to the marketplace from the phone

Status: accepted, 2026-11-27

## Context

The owner asked for Squad for iPhone to be "able to publish and see published
squad agent members in the marketplace". The desktop already publishes
(ADR-0246): `PublishAgentDialog` sends the window's member record to
`/api/marketplace/publish/preview`, which builds the template, runs the
secret scan (`memberTemplateFindings`) and returns what would be public;
`/api/marketplace/publish` publishes as the signed-in account (a new listing,
or a new version of the same-named one); `/api/marketplace/mine` lists the
account's listings; `DELETE /api/marketplace/agents/:id` unpublishes. The
phone could browse and add (contract 0.5, ADR-0256) but not publish.

## Decision

Contract 0.12, capability `publish`, five commands in
`server/mobile/marketplace.mjs`:

- `marketplace.publish.context { memberID }`: signed in or not, who it can be
  published as, the categories, the person's earlier listing of the same name
  (so the phone offers "a new version"), and the member's name, role and
  tagline.
- `marketplace.publish.preview { memberID, skills?, includeMemory, tagline }`:
  what will be public, read back from the template the computer built
  (`agentFieldsFromTemplate`), the skills, the starter memory (shown before it
  is ever included), and any secret-scan findings with their paths.
- `marketplace.publish {…, tagline, description, category, tags, owner,
  asNewVersion, note}`: publishes through the desktop's own route.
- `marketplace.mine`: the person's listings with status (published, hidden by
  a moderator with the reason, unpublished), version, adds and link.
- `marketplace.unpublish { id }`.

The member record always comes from this computer
(`agentChannelAccess[id].agent`), never from the phone, so the phone cannot
smuggle fields past the scan. Publish and unpublish are receipted like
`marketplace.add`, and the request id goes to the API as the idempotency key,
so a retried tap never publishes twice.

## Consequences

- Publishing happens immediately from the phone; unlike an add (which only
  the window carries out, ADR-0077), it creates no member here.
- The phone publishes members only; publishing a whole team stays on the
  desktop (it needs the team picker and per-member choices).
- Signing in still happens on the computer; the phone says so instead of
  offering a sign-in.
- Evidence: `node scripts/check-mobile-marketplace.mjs` (preview from the
  computer's record, secret scan, first publish then a new version with the
  base version, mine, unpublish, signed-out, validation, receipts),
  `node scripts/check-mobile-host.mjs` (capability and member check against
  the real server), `bun run check:marketplace`,
  `node scripts/check-marketplace-bridge.mjs`, `bun run check:server`.
