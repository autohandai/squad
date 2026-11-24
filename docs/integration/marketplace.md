# Agent marketplace

The marketplace is where Squad agents are published and found. A person or an
Autohand team publishes one member as an **agent template**; anyone can find it
on `autohand.ai/squad/marketplace/` or inside Squad and add it to their squad.
Squad also adds a Grok Bot template from its public link, one at a time.

Since ADR-0253 a listing can also be a whole **team template** (2 to 8
members, their skills and channels), the first screen is curated (Featured,
Teams, a section per category), and views, Add clicks, downloads and
installs are counted and traceable from a website click to the install.

Decisions and their evidence are in
[ADR-0246](../adrs/ADR-0246-agent-marketplace.md) and
[ADR-0253](../adrs/ADR-0253-marketplace-teams-featured-and-install-analytics.md).
This page is the contract.

## Parts

| Part | Where | Owns |
| --- | --- | --- |
| Marketplace API | `services/squad-api` (`src/marketplace.ts`), D1 `squad-marketplace` bound as `MARKETPLACE` | listings, versions, publishers, reports, rate limits, audit |
| Format and links | `src/lib/marketplace.js` (pure; browser, bridge and Worker share it) | template validation, canonical hash, deep links, Grok parsing |
| Bridge | `server/routes/marketplace.route.mjs`, `server/marketplace/*.mjs` | browsing proxy with offline cache, verified fetch, import receipts, publishing with the signed-in account, Grok fetch |
| App | `src/components/marketplace/*` | Marketplace dialog (Explore, From a link, Published), publish dialog, deep-link route |
| Desktop shell | `src-tauri/src/deep_link.rs` | `squad://` registration, cold start and running app |
| Website | `dark-web-cli`: `squad/marketplace/`, `functions/squad/marketplace/`, `functions/api/squad/marketplace/`, `admin/squad/marketplace` | public list and detail, Add to Squad, admin moderation |

## The template format

An agent template is an ordinary team file (`autohand.squad-team`, version 1,
[teams.md](teams.md)) with stricter rules, so a template is also a file
Import team already reads:

- `kind` is `"team"`, `team.name` is the agent's name, `team.description` its
  tagline, `team.lead` is the one member.
- exactly one member; no channels, workflows, routines, connectors or presets;
- at most 10 skills, each SKILL.md text only;
- `look.avatar` is `/avatars/birds/<bird>.webp` with a cast bird id, or empty;
- the whole document is at most 256 KiB as canonical JSON;
- no string may contain anything the secret scanner finds
  (`src/lib/secret-scan.js`). Publishing **refuses** instead of redacting: the
  publish preview shows what was found so the person removes it.

`validateAgentTemplate(input)` in `src/lib/marketplace.js` is the one
validator. It runs `validateTeamFile` (the team allowlist rebuilds every
record, so an unknown field cannot ride along) and then the rules above. The
Worker runs it on publish, the bridge runs it again on every import.

The **content hash** is the SHA-256 of the canonical JSON of the validated
document (object keys sorted, no whitespace). The API stores it per version,
returns it with the template, and Squad recomputes it after download. A link
may carry `sha256`; a mismatch refuses the import and adds nothing.

### Team templates (ADR-0253)

A team template is the same format with `kind: "team"` and stricter rules
(`validateTeamTemplate`):

- 2 to 8 members with distinct names; `team.lead` names one of them (the
  first member otherwise);
- at most 10 skills per member and 40 in all, each used by a member;
- up to 3 channels, among the members only;
- no workflows, routines, connectors or presets;
- starter memory per member only where the publisher switched it on;
- bird pictures only, at most 768 KiB as canonical JSON, secrets refused.

Seeds: `marketplace-seeds/teams.json` names agent seeds by slug
(`lead`, `members`, `channels`, optional `memory`); the seed script builds
each team from those agents exactly as they are listed.

### Listing

| Field | Rule |
| --- | --- |
| `id` | 12 characters `[a-z0-9]`; seeds derive it from their slug, publishes are random |
| `name`, `role` | from the member; 1–80 characters |
| `tagline` | 1 line, ≤ 140 characters |
| `description` | ≤ 1,200 characters |
| `category` | `engineering`, `product`, `design`, `marketing`, `sales`, `support`, `operations`, `finance`, `people`, `personal` |
| `tags` | ≤ 5, lowercase words |
| `bird` | cast bird id from the avatar |
| `creator` | `{ kind: "autohand" \| "user" \| "team", name }`; a person's email is never public |
| `version`, `contentHash`, `bytes`, `skills`, `hasMemory` | current published version |
| `createdAt`, `updatedAt` | ISO times; "Added 17 Nov 2026" on every surface |
| `status` | `published`, `unpublished` (by its publisher), `hidden` (moderation), `removed` (admin delete; content purged) |
| `featured` | set by admins; the featured row is ordered by `featuredRank` (admin only) |
| `kind` | `agent` or `team`; fixed at first publish |
| `members` | 1 for an agent, the member count for a team |
| `faces` | teams only: member birds, lead first, at most 8 |
| `installsLabel` | "" under ten installs, then `10+`, `50+`, `100+`, `500+`, `1k+`, `5k+`; exact counts are admin-only |

## HTTP

All responses use the Squad API envelope (`{success,data}` /
`{success:false,error:{code,message},requestId}`).

### Public (no account)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/v1/marketplace/agents?q=&category=&creator=autohand\|user\|team&kind=agent\|team\|all&cursor=&limit=` | published only; featured first, then newest; `limit` ≤ 50; `{agents,nextCursor,total}`; without `kind`, agents only (clients before team templates) |
| GET | `/v1/marketplace/categories` | `{categories:[{id,label,count,teams}],total,teams,autohand}`; `count` and `total` are agents |
| GET | `/v1/marketplace/featured` | `{featured:[listing]}`, agents and teams in the admins' order, ≤ 12 |
| GET | `/v1/marketplace/home?per=1..12` | `{featured, sections:[{id,label,count,teams,agents}], teams, total, teamsTotal, autohand}`: the first screen in one read |
| POST | `/v1/marketplace/agents/:id/events` | `{type:"view"\|"add_click"\|"install", source, attribution?, version?}` → 202 `{counted}`; one per network per listing per type per day; 120 per network per 10 minutes; browsers from the site origins only |
| GET | `/v1/marketplace/agents/:id` | listing plus a preview (instructions, skills, whether it carries memory) and `versions`; ETag |
| GET | `/v1/marketplace/agents/:id/template?version=` | the document and `contentHash`; rate limited per network (60 per 10 minutes); counts one add per network per day |
| POST | `/v1/marketplace/agents/:id/reports` | `{reason,details}`; reasons `spam`, `harmful`, `impersonation`, `secrets`, `broken`, `other`; 10 per network per hour; five distinct reporters hide the listing until an admin reviews it |

Public GETs are `Cache-Control: public, max-age=60, s-maxage=300` with
`Access-Control-Allow-Origin: *`. Reports also accept browser requests from
`https://autohand.ai` (and `www.`), and only reports: an agent's page sends
them from the visitor's own browser so the network bucket is the visitor's,
not the website's shared egress. The network bucket is a SHA-256 of the
connecting IP and the time window; no IP address is stored.

### Publisher (Squad session; teams also send `X-Autohand-Identity`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/v1/marketplace/mine` | listings the session's person published, and those of teams they can publish for |
| POST | `/v1/marketplace/agents` | `{owner:{kind:"user"}\|{kind:"team",id}, listing, document, note}` → 201 listing; `Idempotency-Key` required |
| PUT | `/v1/marketplace/agents/:id` | `{baseVersion, listing, document, note}` → new version; 409 on a stale base; re-publishes an unpublished listing |
| DELETE | `/v1/marketplace/agents/:id` | unpublish; versions are kept for the publisher |

Publishing is 5 per hour and 20 per day per person. Team publishing requires a
current Autohand team role of owner or admin **and** full write access
(`resources:operate`), checked against `/v1/accounts` on every request.
Hidden or removed listings cannot be changed by their publisher.

### Admin (website only)

`Authorization: Bearer <MARKETPLACE_ADMIN_TOKEN>` plus `X-Marketplace-Admin:
<admin email>` for the audit trail. The website's admin functions hold the
token; browsers never do.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/v1/marketplace/admin/agents?status=&q=&cursor=` | every status, with open report counts |
| PATCH | `/v1/marketplace/admin/agents/:id` | `{status:"published"\|"hidden", featured, reason}` |
| DELETE | `/v1/marketplace/admin/agents/:id` | `{reason}`; status `removed`, version documents purged |
| GET | `/v1/marketplace/admin/reports?status=open` | |
| PATCH | `/v1/marketplace/admin/reports/:id` | `{status:"resolved"\|"dismissed", note}` |
| GET | `/v1/marketplace/admin/audit?cursor=` | content-free events, newest first |
| PUT | `/v1/marketplace/admin/featured` | `{ids:[…]}` puts these featured listings first in this order; audited as `featured.reordered` |
| GET | `/v1/marketplace/admin/stats?days=1..365&listing=` | `{daily:[{day,views,addClicks,downloads,installs}], totals, top, attribution:{clicks,installs}}` |

Admin rows (`/admin/agents`, filters `kind`, `featured=1`) also carry
`featuredRank`, `adds` and `stats:{views,addClicks,downloads,installs,attributedInstalls}`.

## Links

`squad://app/v1/agent-template?id=<id>[&version=<n>][&sha256=<64 hex>][&attribution=<20 a-z0-9>]`
and `squad://app/v1/team-template?…` (same parameters) are the only accepted
deep links; they open the app routes `/marketplace/agents/<id>` and
`/marketplace/teams/<id>`. Scheme, host, path and parameter names are exact;
anything else is ignored. The shell turns it into the app route
`/marketplace/agents/<id>`, which opens the Marketplace dialog on that agent.
**A link never adds anything by itself**: the person reads the agent and
presses Add to squad. Squad fetches the template from its own configured API
origin, never from a URL inside the link.

From a link (Marketplace dialog) also accepts
`https://autohand.ai/squad/marketplace/<id>`, a bare id, a Squad link, a Grok
Bot page `https://x.ai/bot/<id>` and `grokbot://app/v1/bot-template?id=<id>`.

## Importing

1. The bridge fetches `/template`, validates it with `validateAgentTemplate`,
   recomputes the hash and compares it with the API's and the link's.
2. `GET /api/marketplace/imports?listing=<id>` tells the dialog whether this
   squad already has a member from that listing (receipts in
   `<squad state>/marketplace-imports.json`, pruned of removed members).
3. New: the document goes through `addTeam` exactly like a team file:
   untrusted, so skills arrive switched off and the member starts at Suggest
   commands. Already here: **Update <name>** writes the new instructions, brain
   card, role and description to that member (name, picture, memory,
   conversations and permissions stay) and adds new skills switched off; **Add
   another** creates a second member with a numbered name.
4. The receipt records listing, version, hash, member and source.

A team template goes through `addTeam` like Import team: every member
untrusted, the channels created after the last member. Its receipt has
`kind: "team"`, `memberId` (the lead) and `memberIds`. Re-adding a team
offers Add again, never Update.

After a new member or team is recorded, the bridge posts one `install`
event with `source` (`website-link` when the link carried an attribution id,
`link` for a pasted or bare link, `in-app` otherwise) and the attribution id.
The receipt does not keep the attribution id. Updates are not installs.

## Install analytics and the funnel (ADR-0253)

Server-side counts (Squad API, anonymous, one per network per listing per
type per day): **views** and **Add clicks** from the website, **downloads**
(template fetched), **installs** (Squad confirmed). Attribution: an Add click
with an attribution id and an install with the same id join in
`attributions` for 30 days (`attributedInstalls`).

PostHog, explicit events only. Squad (bridge capture, ADR-0067; DNT and GPC
send nothing; anonymous allowed with no person profile):

| Event | Properties |
| --- | --- |
| `marketplace_opened` | `entry`: directory, minified, command, route, link |
| `marketplace_listing_viewed` | `listing_id`, `listing_kind`, `version`, `via` |
| `marketplace_add_started` | `listing_id`, `listing_kind`, `version`, `via`, `attribution_id`? |
| `marketplace_add_succeeded` | the above plus `action` (add, update, another), `members` |
| `marketplace_add_failed` | the above plus `reason` (offline, rate_limited, not_found, checksum, invalid, unavailable, failed) |

`via` is `website-link`, `in-app`, `link` or `grok` (Grok has no
`listing_id`). Every Squad event also carries `source: "squad"`,
`product: "autohand_squad"`, `app_version` and `platform`, which is why the
funnel's own source is named `via`.

Website (only with optional analytics accepted, DNT/GPC off;
`$process_person_profile: false`; `source: "website"`,
`product: "autohand_squad_marketplace"`):

| Event | Properties |
| --- | --- |
| `squad_marketplace_viewed` | `surface` (home, category, search, teams), `category`?, `results_count` |
| `squad_marketplace_searched` | `query_length`, `results_count`, `category`? (never the text) |
| `squad_marketplace_category_selected` | `category` |
| `squad_marketplace_listing_viewed` | `listing_id`, `listing_kind`, `category`, `version`, `featured` |
| `squad_marketplace_add_clicked` | `listing_id`, `listing_kind`, `category`, `version`, `featured`, `placement` (featured, section, list, detail), `attribution_id` |

The funnel: `squad_marketplace_listing_viewed` → `squad_marketplace_add_clicked`
→ `marketplace_add_started` → `marketplace_add_succeeded`. The website and
Squad have different distinct ids, so join the last three on
`attribution_id`, for example as a HogQL insight:

```sql
SELECT c.properties.listing_id AS listing,
       count() AS clicks,
       countIf(s.event IS NOT NULL) AS installs
FROM events c
LEFT JOIN (SELECT event, properties.attribution_id AS attribution_id FROM events
           WHERE event = 'marketplace_add_succeeded' AND timestamp > now() - INTERVAL 30 DAY) s
  ON s.attribution_id = c.properties.attribution_id
WHERE c.event = 'squad_marketplace_add_clicked' AND c.timestamp > now() - INTERVAL 30 DAY
GROUP BY listing ORDER BY clicks DESC
```

In-app installs (no website click) are `marketplace_add_succeeded` with
`via = 'in-app'`. The same funnel without PostHog is
`GET /v1/marketplace/admin/stats` (Admin › Squad › Marketplace).

## Grok Bot templates

`POST /api/marketplace/grok/preview {url}` fetches the public bot page
`https://x.ai/bot/<id>` (one request, 10 s, 1.5 MB, no cookies, redirects to
other hosts refused, `User-Agent: AutohandSquad/<version> (user-initiated
template import)`), at most 6 per minute, cached for 10 minutes per id.

The public page carries the bot's **name, description, colour, shape, owner
type and sharer name** in its server-rendered data. Its instructions are not
on the page: Grok's own app downloads them through `grokbot://` with the
person's Grok session. Squad does not call that private API. The import
therefore makes a starter agent from the description, names the source and the
creator ("Grok Bot template by …", or "a Grok Bot user" when the page hides the
sharer), and offers a field to paste the bot's instructions when the person has
them. Nothing is fetched in bulk and nothing is fetched without a pasted link.

## Publishing from Squad

Member menu → **Publish to marketplace…**. The dialog is the preview: name,
role, tagline, category, the skills (each a checkbox), and **Starter memory**,
off by default; switching it on shows the MEMORY.md text that would be public.
Conversations, files, folders, permissions, connectors, routines, engine and
model settings are never part of a template. Any secret-scanner hit is listed
with its place and blocks Publish. Publish as: Personal, or each Autohand team
the person may publish for. Published lists the person's listings with
Update (new version from the member as it is now) and Unpublish.

## Failure states

- API unreachable: Explore shows the last list this bridge saw ("Offline ·
  showing the list from 14:02") with Retry; Add needs the network and says so.
- Not signed in: Explore and Add work; Publish asks to sign in.
- Hash mismatch, invalid template, removed listing, rate limit: one sentence,
  nothing created.

## Production rollout

Squad API steps 1–7 were run on 24 Nov 2026 at the owner's request ("release
the site marketplace"): database `squad-marketplace` (c5df5ea5-d7a7-4bda-8eb4-98d7277f80eb,
repository variable `SQUAD_MARKETPLACE_DATABASE_ID`), both migrations, the admin
secret, deploy a2c68db (version 2fe2e5c2), 19 seed batches. Checked:
`/v1/marketplace/categories` total 350, teams 21, per-category counts as seeded;
`/featured` 8; `?q=payroll` finds Margot, Phoebe, Isidore; a `/template` returns
its `contentHash`; the admin list answers with the token and an actor.
The CI deploy job now passes the marketplace database and email sending.

The steps, for a fresh account:

Squad API (`services/squad-api`, Cloudflare account that owns `autohand.ai`):

1. Create the database: `node_modules/.bin/cf d1 create` with name
   `squad-marketplace` (or the dashboard). Note its ID.
2. Apply the schema:
   `SQUAD_MARKETPLACE_DATABASE_ID=<id> node_modules/.bin/cf d1 migrations apply <id> --dir marketplace-migrations`
3. Secret, at least 32 random characters, set without echoing it:
   `MARKETPLACE_ADMIN_TOKEN` on the `squad-api` Worker. Keep the value for the
   website's Pages secret of the same name.
4. Deploy with both IDs exported (`SQUAD_API_DATABASE_ID`,
   `SQUAD_MARKETPLACE_DATABASE_ID`): `npm run typecheck && npm test && npm run build && npm run deploy`.
   Add `SQUAD_MARKETPLACE_DATABASE_ID` to the CI deploy variables in
   `.github/workflows/squad-api.yml` before enabling automatic deploys.
5. Apply `marketplace-migrations/0002_teams_featured_stats.sql` the same way
   as step 2 if the database was created before ADR-0253.
6. Seed the agents, teams and featured order (idempotent; `createdAt` is the time you run it):
   `node scripts/marketplace-seed.mjs --batches .cloudflare/marketplace-seed`, then
   for each file `node_modules/.bin/cf d1 query <id> --batch @<file>`.
   Check: `curl -s https://squad.autohand.ai/v1/marketplace/categories` reports
   `total: 350`, `teams: 21`, and per category 20 plus the counts in
   `marketplace-seeds/additions-2026-11.json`; `/v1/marketplace/featured`
   lists the eight seeded featured listings.
7. Smoke: `GET /v1/marketplace/agents?q=payroll`, one `/template` whose
   `contentHash` matches the listing, and an admin call with the token and
   `X-Marketplace-Admin` that returns `agents`.

Website (`dark-web-cli`, branch `lane/squad-marketplace`): follow its
`runbooks/squad-marketplace.md` (Pages secret, permission and flag migrations,
deploy, private check with the flag, then `SQUAD_MARKETPLACE_PUBLIC=true`).

Desktop: the `squad://` scheme ships with the next signed build (Cargo adds
`tauri-plugin-deep-link`; `tauri.conf.json` declares the scheme, so the bundle
writes `CFBundleURLTypes` on macOS, the NSIS registry keys on Windows and the
`.desktop` handler on Linux). Verify after building: `open 'squad://app/v1/agent-template?id=<seed id>'`
with Squad closed and with it open.

Rollback: Worker routes are additive; redeploying the previous Worker removes
them without touching `squad-control-plane`. The marketplace database can be
restored with D1 Time Travel on its own.
