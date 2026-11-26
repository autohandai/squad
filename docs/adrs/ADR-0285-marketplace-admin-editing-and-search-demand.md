# ADR-0285: Admins edit Autohand's marketplace listings; searches are recorded as demand

Status: accepted, 2026-11-26 (Squad API and website branches; not deployed)

## Context

The owner asked for full control of the marketplace from the website's admin
(`dark-web-cli` › Admin › Squad › Marketplace): add, edit, publish and
unpublish, delete; drafting new agents with the portal's LLM the way the
content factory does; suggestions for agents the marketplace lacks; and stats
such as the most popular agents.

What existed (ADR-0246, ADR-0253): admins could hide, restore, feature,
reorder, remove and resolve reports, and read a 30-day funnel. They could not
change what a listing says. All 371 listings are Autohand's own seeds, and the
publisher routes refuse to change them (`listing_forbidden`: "Autohand's own
agents are changed through the seed process"), so a typo meant a seed file
edit, a new seed row and a database run. Agent pages showed connectors the
website inferred from the listing's words; nothing stored a choice. Nothing
recorded what people searched for, so "agents we don't have yet" had no data
behind it.

## Decision

- **Editing is for Autohand's own listings.** `POST /admin/agents` creates an
  agent under the same `autohand-squad-team` publisher the seeds use;
  `PUT /admin/agents/:id` adds a version. Both build the template with
  `agentTemplateFromFields` (the seed shape, now shared in
  `src/lib/marketplace.js`) and run `checkedContent`, so an admin cannot save
  anything a publisher could not publish: same validators, secret scanner,
  size limits and content hash. A listing published by a person or a team is
  theirs: admins moderate it (hide, remove) but do not rewrite it.
- **New agents are saved unpublished** unless the admin chooses Save and
  publish. Admins publish and unpublish Autohand's listings with the existing
  PATCH; a person's own unpublish still stays theirs.
- **Teams** change only what their listing says (tagline, description,
  category, tags, connectors). Their members are the agents, edited on their
  own listings, so a team never says something its members' pages do not.
- **Connectors become a choice.** `listings.connectors` (up to four of the
  connectors the website draws marks for) is set by admins; empty keeps the
  inferred ones. The public listing carries `connectors` only when set.
- **Searches are recorded as demand.** A first-page search on
  `/v1/marketplace/agents` adds one to `search_queries(day, term)` and to
  `empty` when nothing matched. The term is the normalised search words (at
  most six, 80 characters); no network, person or time finer than the day.
  `GET /admin/searches` returns the most searched words and the ones that found
  nothing. Admin stats gain per-category totals.
- **The LLM stays on the website.** Draft with AI and Suggestions run in the
  website's admin functions through the AI feature `marketplace_agent`
  (Admin › AI settings; default Workers AI `@cf/moonshotai/kimi-k2.6` with
  thinking off, the content factory's model), via the same `generateAiText`.
  A draft only fills the editor; Suggestions only reads. The Squad API never
  calls a model.

## Consequences

- Seed files and the database now diverge once an admin edits a seed: the seed
  script is `INSERT OR IGNORE`, so re-seeding never undoes an edit, and the
  seed JSON no longer describes production. Production is the truth; the
  seeds are how a fresh database starts.
- Search counts are a floor: the public list is cached for five minutes at the
  edge, and repeats served from cache never reach the Worker. Next pages are
  not counted. One-letter searches are ignored.
- Every first-page search is now a D1 write on the marketplace database.
- Migration order matters: this Worker selects `listings.connectors` and
  writes `search_queries` on public reads, so on the old schema every listing
  read fails. `marketplace-migrations/0003_admin_editing_searches.sql` must be
  applied before the Worker is deployed; marketplace migrations are not run by
  the CI deploy job (docs/integration/marketplace.md, step 5a).
- Creating a team from the admin is not built; teams are still seeds.
- Admin create has no idempotency key; the editor disables Save while a save
  is in flight, and a duplicate would show in Listings to remove.
- Suggestions are the model's proposals from the recorded numbers; the page
  says which inputs had data and which model answered. With no searches yet,
  they come from category counts only, and the page says so.

Evidence: `services/squad-api` `npm test` (58 tests, 56 pass, 2 skipped; new:
admin draft → publish → edit → unpublish with versions, secrets and connector
refusals and the audit trail; a seed team's listing edited without its
members and someone else's listing refused; search counting by words per day,
empty results, no next pages, nothing but words and counts stored), `tsc`
clean, `bun run check:marketplace`. Website: `node --test
tests/squad-marketplace-admin.test.mjs tests/squad-marketplace.test.mjs` and
the Playwright admin test in `e2e/squad-marketplace.spec.js`.
