# ADR-0253: Marketplace v2: whole teams, a curated first screen, 150 more agents and install analytics

Status: accepted. Amends ADR-0246 (agent marketplace) and builds on ADR-0067
(explicit product telemetry), ADR-0106 (team files) and ADR-0118 (team
templates). Contract: [docs/integration/marketplace.md](../integration/marketplace.md).
Website side: `dark-web-cli`, branch `igor/squad-marketplace` (PR #107).

## Context and evidence

The owner asked for the marketplace to be refined by a designer with taste
and to "work great", with five additions: 13 to 18 more agents per category
(with new skills, drawing on the kinds of abilities Grok Bot's marketplace
shows, not its items), importing an entire team, featured agents, and
download and install counts on the website and in Squad through PostHog,
traceable from a website click to the install.

He showed Grok Bot's marketplace: a big "Marketplace" title, pill categories,
a large search field, a Featured row of four large tiles (big mascot, the
creator's photo overlapping it, the name in the mascot's colour, "by
<creator>"), then a section per category with View all and two-column rows
with Add. The standing rule is that competitor screens are a reference for
capability and polish only.

What was there before this change, measured:

- 200 seed agents, 20 per category, every listing an `autohand.squad-team`
  v1 file with exactly one member (`validateAgentTemplate`).
- The app's Explore opened on a flat paged list ("All 200"), the website on
  the same list. Nothing was featured although admins could set `featured`.
- The only count was `adds`, one per network per listing per day when a
  template was downloaded, and it was public on every row.
- Squad's product telemetry (ADR-0067) had no marketplace events; the website
  had no PostHog at all (only a consent banner whose optional-analytics
  choice nothing read).

## Decisions

**1. A team template is a team file with 2 to 8 members, on the same
format.** `validateTeamTemplate` (in `src/lib/marketplace.js`, shared by the
Worker, the bridge and the seed script) accepts `kind: "team"` documents with
2-8 uniquely named members, at most 10 skills each and 40 in all, every
skill used by a member, up to three channels among them, bird pictures only,
and nothing that runs or reaches out on import: no workflows, routines,
connectors or presets. Starter memory is per member and opt-in. Secrets are
refused, never redacted, as for agents. Considered: carrying routines and
connectors (the team file can). Left out because a marketplace import is
untrusted and a routine is something that runs on a schedule; a person can
add those after reading the team. A listing records `kind` and `members`;
the kind is fixed at first publish (an update must still be a team).

**2. Importing a team is Import team.** The app hands the verified document
to the same `addTeam` that Import team, Templates and New team use
(ADR-0118): members are prepared one at a time, untrusted (skills off,
Suggest commands), then the channels are created. One receipt names the
lead and every member it created. Re-adding a team offers Add again (a
second copy with numbered names), not Update: updating several members in
place from a newer version has edge cases (renamed or removed members) this
change did not take on.

**3. One listing namespace, `kind` on the query.** Teams are listings with
ids like agents, read through the same routes. `GET /agents` without `kind`
still returns agents only, so a Squad 0.1.x already in the field never sees a
row it cannot add (its validator would refuse a team template anyway, which
the API test asserts). New links: `squad://app/v1/team-template?…` and the
app route `/marketplace/teams/<id>`; the website page
`/squad/marketplace/teams/<id>/`. Team rows carry `faces` (member birds, lead
first) so a row can show the team without fetching its document; the website
first built this by reading every team's detail and was switched to the
field.

**4. A curated first screen instead of a flat list.** `GET /home` returns, in
one cacheable read, the featured row in the admins' order, the team
templates and each category's first agents. Both surfaces open on it:
Featured (up to eight), Teams, then a section per category with its count
and View all, which switches to that category's paged list. A search, a
category, Teams or From Autohand turns the screen into the flat list as
before.

How this differs from Grok Bot's layout, on purpose:
- No tiles with frames or tinted panels. Featured in the app is open space:
  the bird face, name, role and two lines of tagline, with a hover wash. On
  the website the tile has a pale face area on the page background, because
  the website's page is wider and the face needs a field to sit in; no shadow
  or colour per mascot.
- The mascot is ours: the drawn bird faces, the same renderer as the app.
  A team is a short overlapping stack of its members' faces, which says
  "team" without a badge. No creator photo over the mascot (publishers are
  not identified by photos; ADR-0246 keeps emails and pictures out).
- Names are in the text colour, never the mascot's colour.
- Categories stay underlined words with muted counts, not pills, matching the
  directory's filters.
- Rows keep "Name by Creator", the tagline, and a meta line with role or
  "Team · N members", category, Added date and an installs floor when there
  is one; the action is View in the app (Add happens on the page that shows
  what will be added) and an outline Add on the website.

**5. Featured is curated and ordered.** `featured_rank` orders the row;
admins feature (it joins the end), unfeature and reorder
(`PUT /admin/featured`). The initial set is eight seeds in
`marketplace-seeds/featured.json` (Abner, Code review desk, Callum, Farah,
Hiring loop, Noemi, Imani, Caleb: one per kind of work the owner named,
two teams). The seed applies the order only while the audit trail has no
`listing.featured`, `listing.unfeatured` or `featured.reordered`: once an
admin curates, re-seeding leaves their order alone (tested).

**6. 150 more agents, counts drawn from a recorded seed.** For each category
a count in 13-18 was drawn once with `mulberry32(20261117)`, in category
order: engineering 18, product 13, design 18, marketing 13, sales 14,
support 13, operations 16, finance 16, people 13, personal 16 (150 in all,
recorded in `marketplace-seeds/additions-2026-11.json`; the seed check
recomputes the draw and fails on any other count). Each is original, by the
Autohand Squad team, with 1-3 new skills (270 new skills; 517 in all). They
take the kinds of abilities seen on Grok Bot (prospecting with drafted
outreach, answer-engine briefs, SaaS spend negotiation prep, meeting recaps
into decks, sales call scoring, recruiting coordination, design critique
from a screenshot, prototype building, competitor watch, stress-testing
ideas, video direction) and none of its names, creators or wording; the
seed check rejects "grok" and "x.ai" anywhere in a seed. Every agent drafts
and never sends, pays or posts on its own, says what it will do first, and
marks assumptions. 21 team templates (two or three per category) are built
from these agents by slug, so a team never says something its members'
own pages do not.

**7. Counts are anonymous, server-side and one per network per day.**
`POST /agents/:id/events` takes `view` and `add_click` (website, from the
visitor's browser, like Report, so the bucket is the visitor's network) and
`install` (Squad's bridge, after the import is recorded). Each counts once
per network per listing per type per day, keyed by a SHA-256 of the
connecting address and the day; no address is stored. Downloads are the
existing template count. `listing_stats` keeps the four per day; admins read
counters per row and `GET /admin/stats` (daily, totals, top listings,
attribution). The website sends views and clicks whatever the cookie choice:
nothing is stored on the device and nothing about the person is sent, the
same footing as the request itself.

**8. Public installs are a floor, from ten.** Rows carry `installsLabel`:
nothing under ten, then 10+, 50+, 100+, 500+, 1k+, 5k+. Exact counters are
admin-only and `adds` left the public row. Considered: exact public counts
(Grok shows none; app stores show floors). A small exact number invites
gaming by re-installing from a few networks and reads as "nobody uses this"
in the first weeks when every seed is at zero; a floor is honest and stable.

**9. An attribution id joins a website click to the install.** Every Add
click on the website generates a fresh 20-character random id, puts it in
the squad:// link (`&attribution=`), sends it with the `add_click` event and
with the website's PostHog event. The app carries it through the route to the
receipt request, the bridge sends it with the `install` event (and does not
keep it), and the app's PostHog events carry it. The API joins click and
install in `attributions` for 30 days, then deletes the row. The id names a
click, not a person; it is not stored in a cookie. The deep-link parsers
(JavaScript and the Rust shell) accept exactly that shape and refuse
anything else, as for the other parameters.

**10. PostHog, explicit events only, on both surfaces.**
- Squad: five events through the existing bridge capture (ADR-0067):
  `marketplace_opened`, `marketplace_listing_viewed`, `marketplace_add_started`,
  `marketplace_add_succeeded`, `marketplace_add_failed`, with only the public
  listing id, kind, version, `via` (website-link, in-app, link, grok; not
  `source`, which every Squad event already sets to "squad" and which the
  first draft silently overwrote),
  attribution id, action, member count and a bounded failure reason. DNT and
  Global Privacy Control send nothing (tested in the browser). Unlike other
  Squad events, these are also sent when no one is signed in, with a fresh
  random id and no person profile, as sign-in starts already are: the funnel
  is about listings and is joined by the attribution id, not by a person.
- Website: five `squad_marketplace_*` events, sent only with optional
  analytics accepted and DNT/GPC off, direct to `/capture/` with
  `$process_person_profile: false`, never the search text.
The event names, properties and a HogQL query for the funnel are in the
contract.

## What was learnt on the way

- **The ADR-0246 migration trap, again.** The first 0002 migration had a
  semicolon in a `--` comment ("both are team files; counters…"). The test
  harness splits migrations on `;` and every API test failed with
  `near "both": syntax error`. Fixed by rewording; ADR-0246 already recorded
  this exact trap, and it was still easy to walk into. A later migration
  should not rely on a reader remembering it: a lint for `;` in comments is
  worth adding to the seed check (not done here).
- **A list that reloaded forever.** The first Explore effect listed the
  category counts among its dependencies. Each list load fetches the counts,
  the new counts object re-ran the effect, which loaded the list again: a
  silent loop, invisible online because the list looked the same. The
  in-app browser check found it offline: after the API came back, the
  "Offline · showing the list from…" line vanished before Retry could be
  pressed, because the loop had already refetched. Home and list now load
  in separate effects that do not depend on the counts.
- **Request bodies disappear on navigation.** The browser check first read
  product-event bodies with `Network.getRequestPostData` after navigating to
  a deep link; Chromium had dropped the earlier page's request data, so the
  "before" count was wrong and the check timed out. It now reads each body
  once and keeps it.
- **`source` was already taken.** The first sanitizer named the funnel's
  origin `source`; the bridge's capture spreads the event's properties and
  then sets `source: "squad"` on every Squad event, so every marketplace
  event would have arrived in PostHog as `source: squad` and the
  website-link versus in-app split would have been lost without an error.
  Found while writing the contract's event table, before any check covered
  it; the property is `via`, and the telemetry check now asserts both.
- **"payroll" was no longer one agent.** The older browser check expected a
  single search result; one of the new finance agents also mentions
  payroll. The check now looks for the agent by name.
- **Team channels arrive last.** The receipt is written when `addTeam`
  returns, while members are still being prepared in the background; the
  channel is created after the last member. A check that looked for
  `#reviews` straight after the receipt failed; it now waits for the build.
- The website subagent found that `--border-medium` is defined only under
  `docs/` on the site, so the first marketplace's search box and Add buttons
  had no border at all in production styling (recorded in the site's
  DESIGN.md), and that the admin status label `hidden` collided with the
  site's global `.hidden` class.

## Consequences

- Squad API needs migration `0002_teams_featured_stats.sql` and a re-seed
  (350 agents, 21 teams, 8 featured) before the new surfaces show anything
  new; the production runbook in the contract lists it. Nothing was run
  against production.
- Updating a team in place is not offered; Add again makes a second copy.
- Team publishing from Squad's UI is not built: the API accepts
  `kind: "team"` and is tested, but the member menu still publishes one
  member. Publishing a whole team needs a dialog that chooses members and
  shows each one's memory; left for a later change.
- Views and Add clicks are counted per network per day: two people behind
  one office address on the same day count once; one person on two networks
  counts twice. Good enough for ranking and for the owner's funnel; not a
  count of people.
- Attribution only joins when the person installs from the link within 30
  days and the API stores that click; a website visitor who opens Squad
  separately and searches is an in-app install.
- Squad's marketplace events are counted anonymously, which is a widening of
  ADR-0067's "signed-in or sign-in start" rule; it carries no person data.
- The website's PostHog key is a build-time public ingestion key
  (`VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`); none is configured yet, so the
  website sends nothing to PostHog until one is set.
- Copy is English fallbacks, not yet in `src/locales.js`.
- The Rust parser was compiled and tested on its own
  (`rustc --test src-tauri/src/deep_link.rs`, 5 tests); no native build.
- Search remains `LIKE` over stored text, now including a team's member
  names and roles.

## Evidence (commands run for this change)

- `node services/squad-api/scripts/check-marketplace-seeds.mjs` → "350 seed
  agents valid (150 added from 10 files: {engineering 18, product 13, design
  18, marketing 13, sales 14, support 13, operations 16, finance 16, people 13,
  personal 16}); 517 skills; 21 team templates; 8 featured".
- `cd services/squad-api && npx tsx --test test/*.test.ts` → 41 pass, 0 fail
  (2 skipped, pre-existing); `npx tsc --noEmit` clean.
- `node scripts/check-marketplace.mjs`, `node scripts/check-marketplace-bridge.mjs`,
  `node scripts/check-marketplace-account-codes.mjs`,
  `node scripts/check-product-telemetry.mjs`,
  `node scripts/check-marketplace-browser.mjs`,
  `node scripts/check-marketplace-in-app-browser.mjs` → all pass; the in-app
  check adds the Code review desk from
  `/marketplace/teams/<id>?sha256=…&attribution=…`, sees four members on one
  receipt, `#reviews` created, the API's `attributedInstalls` go to 1, the
  product events in order with the attribution id, and none under GPC.
- `rustc --test src-tauri/src/deep_link.rs` → 5 passed.
- Screenshots reviewed: `.codex-artifacts/marketplace-in-app/full-default-light-home.png`,
  `full-default-light-team.png`, `minified-paper-phone-home.png` (first pass
  showed role text running into the next featured tile and team faces
  overlapping row titles; fixed with a full-width text block and a two-face
  stack in rows).

## Addendum, 19 November 2026: adds from a phone

A listing added from a paired phone (ADR-0256) is recorded with `via: "phone"`
and Squad's funnel source `phone`; the anonymous install count to the
marketplace API sends `in-app` until the API accepts `phone`.
