# Agent marketplace

The marketplace is where Squad agents are published and found. A person or an
Autohand team publishes one member as an **agent template**; anyone can find it
on `autohand.ai/squad/marketplace/` or inside Squad and add it to their squad.
Squad also adds a Grok Bot template from its public link, one at a time.

Decisions and their evidence are in
[ADR-0246](../adrs/ADR-0246-agent-marketplace.md). This page is the contract.

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
| `featured` | set by admins |

## HTTP

All responses use the Squad API envelope (`{success,data}` /
`{success:false,error:{code,message},requestId}`).

### Public (no account)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/v1/marketplace/agents?q=&category=&creator=autohand\|user\|team&cursor=&limit=` | published only; featured first, then newest; `limit` ≤ 50; `{agents,nextCursor,total}` |
| GET | `/v1/marketplace/categories` | `{categories:[{id,label,count}],total}` |
| GET | `/v1/marketplace/agents/:id` | listing plus a preview (instructions, skills, whether it carries memory) and `versions`; ETag |
| GET | `/v1/marketplace/agents/:id/template?version=` | the document and `contentHash`; rate limited per network (60 per 10 minutes); counts one add per network per day |
| POST | `/v1/marketplace/agents/:id/reports` | `{reason,details}`; reasons `spam`, `harmful`, `impersonation`, `secrets`, `broken`, `other`; 10 per network per hour; five distinct reporters hide the listing until an admin reviews it |

Public GETs are `Cache-Control: public, max-age=60, s-maxage=300` with
`Access-Control-Allow-Origin: *`. The network bucket is a SHA-256 of the
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

## Links

`squad://app/v1/agent-template?id=<id>[&version=<n>][&sha256=<64 hex>]` is the
only accepted deep link. Scheme, host, path and parameter names are exact;
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
