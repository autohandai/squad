# ADR-0246: an agent marketplace on the team-file format, in its own database

Status: accepted. Builds on ADR-0106 (team sharing and presets), ADR-0118
(team templates), ADR-0151 (dedicated Squad API) and ADR-0193 (account and
team ownership). Contract: [docs/integration/marketplace.md](../integration/marketplace.md).

## Context and evidence

Squad could already share one member as a preset file (member menu → Share as
preset…), but a file has to be sent to someone. The owner asked for a public
marketplace: agents published by the person who made them or by their
Autohand team, listed on `autohand.ai/squad/marketplace/`, added to Squad
through a `squad://` link, plus 200 agents from the Autohand Squad team to
start with and the ability to bring in a Grok Bot template from its link. The
Grok Bot marketplace was the capability reference, not a look to copy.

What existed and what was measured before deciding:

- The preset and team files are `autohand.squad-team` version 1, rebuilt
  through an allowlist (`validateTeamFile`), with a secret scanner that
  redacts on export (`src/lib/secret-scan.js`). Importing a team file goes
  through `addTeam`, which creates members through the confirmed creation path
  with skills switched off and the member at Suggest commands.
- The Squad API Worker (`services/squad-api`) already exchanges an Autohand
  credential for a Squad session and rechecks team roles and
  `resources:operate` against `/v1/accounts` on every team request.
- **Grok Bot pages.** `https://x.ai/robots.txt` allows `/` except `/tools/`.
  One user-agent-honest request (`AutohandSquad/0.1 (template import)`) to
  `https://x.ai/bot/pXNvc_U2cGyZmheYrUuF_` returned 200 (69 KB HTML, marked
  `noindex, nofollow`). Its server-rendered data holds exactly
  `{id, ownerType:"USER", sharerName:null, botName:"figma bro", description,
  addHref:"grokbot://app/v1/bot-template?id=…", color:"#FF309B", shape:"gem"}`
  under the query key `["bot-template", id]`. There are no instructions,
  skills or prompts anywhere on the page. The Add button is only the
  `grokbot://` link, so the template body is fetched by Grok's own app with
  the person's Grok session. `https://x.ai/legal/bot-sharing-terms` answered
  403 to both curl and a web fetcher, so its text was not reviewed.
- The seed agents: 200 written for this change by the Autohand Squad team
  (20 in each of ten categories, 247 skills), checked by a script for the
  schema, uniqueness across all 200, the secret scanner, banned filler words,
  and private paths or emails, and then passed through the same
  `validateAgentTemplate` the Worker runs on publish
  (`node scripts/marketplace-seed.mjs --check` → "200 seed agents valid; 247
  skills").

## Decisions

**1. The template is a team file with one member.** A marketplace agent is
an `autohand.squad-team` v1 document with exactly one member and its skills,
nothing else. Import team can already read it, the allowlist and limits are
the existing ones, and the version number is the existing one. A separate
format would have needed its own validator, migration story and importer.
`validateAgentTemplate` adds the stricter rules (one member; no channels,
workflows, routines, connectors or presets; ≤ 10 skills; 256 KiB; a cast bird
or no picture; every named skill present).

**2. Publishing refuses secrets instead of redacting them.** Export redacts
and lists what it removed, which suits a file sent to a colleague. A public
listing is different: a redacted template is not what the publisher wrote,
and silently publishing "[removed: looked like a secret]" in someone's
instructions would be both broken and a signal that a secret was there. The
Worker answers `template_secrets` with each path; the publish dialog shows them.
Starter memory is off by default and shown in full before it can be included.

**3. A separate D1 database, `squad-marketplace`, bound to the same Worker.**
Considered: tables in `squad-control-plane`. Chosen apart because the data is
public and read-heavy while the control plane is private and write-heavy (D1
serialises writes per database, and marketplace reports and add counts would
queue behind memory sync); because a moderation mistake should be restorable
with Time Travel without rolling back sessions and memory; and because the
classification differs (everything here is meant to be public, except
reports and the audit trail). Same Worker, because publishing needs the
existing Squad session and team checks. The cost: no foreign key to
`identities`, so publishers are stored by issuer and subject or team account
id, and the creator name is a public display name the publisher chooses
(never an email; the API refuses names containing `@`).

**4. Integrity by content hash, not signatures.** Every version stores the
SHA-256 of its canonical JSON. The Worker re-hashes a stored document before
serving it (a corrupted row answers `template_integrity`), the bridge
re-hashes after download, and the website's Add to Squad link carries the
hash so Squad refuses a template that is not the one the page showed. Squad
always fetches from its configured API origin, never from a URL in a link.
Signing would also protect against a compromised API database; that threat
also lets the attacker publish, so it was left out (see consequences).

**5. A link never adds anything by itself.** `squad://app/v1/agent-template`
opens the agent in Squad's Marketplace dialog; the person reads it and
presses Add to squad. Parsing is exact (scheme, host, path, parameter names,
id and hash shapes) in both the shell and the app.

**6. Imports are untrusted, including Autohand's own.** Marketplace templates
go through `addTeam` with `trusted: false`: skills arrive switched off and
the member starts at Suggest commands. Re-adding an agent already in the
squad offers Update (instructions, brain card, role, description; name,
picture, memory and conversations stay) or Add another, recorded in
`marketplace-imports.json`.

**7. Grok Bot import uses only the public page.** One request per pasted link,
with an honest user agent, a 10-second timeout, a 1.5 MB cap, redirects off,
six a minute and a ten-minute cache. It maps name and description to a
starter agent, keeps the source link and the creator ("by a Grok Bot user"
when the page hides the sharer), and lets the person paste the instructions
if they have them. Squad does not call Grok's private template API, and does
not register `grokbot://`, which belongs to Grok's app.

**8. Team publishing needs owner or admin plus write access.** Any team
member with `resources:operate` can edit the team's Squad, but publishing
puts the team's name on a public page, so the role check is stricter.

**9. Moderation.** Five distinct reporting networks hide a listing until an
admin reviews it. Admins hide (with a reason the publisher sees), restore,
feature and remove (content purged, row kept). Every action is in the audit
table, which stores hashed network buckets, never IP addresses. The website
admin reaches these routes with a dedicated bearer secret and the admin's
email as `X-Marketplace-Admin`.

## What was learnt on the way

- The first publish preview missed a key in a member's instructions.
  `buildTeamFile` redacts everything the scanner finds while it builds, so a
  validator run on the built document saw "[removed: looked like a
  secret]" and passed it. The bridge check caught it (`api_key=…` in the
  instructions published as redacted text). `memberTemplateFindings` now
  scans the raw member, skills, memory and tagline before building, in the
  bridge, the seed builder and the Grok paste field; the Worker already
  scanned the posted document before rebuilding it.

- `cf dev` in this package runs the Vite plugin and rejects `--local` and
  `--persist-to`; `cf d1 query` has no local mode. The README's local steps
  were stale. `scripts/local-marketplace.mjs` runs the Worker in workerd with
  persistent D1, migrations, seeds and the identity fixture instead.
- Splitting a migration on `;` (as the test harness does) breaks on a
  semicolon inside a `--` comment. The first draft of the migration had one.
- The first local runner passed `d1Persist` to Miniflare 5, which silently
  ignores it: the database was empty after every restart. The app's offline
  screenshot showed "All 200" above an empty list, which is how it was found.
  Miniflare 5 takes one `resourcePersistencePath`; the bridge check now
  asserts the seeds survive a restart.
- Reports were first planned through a website function. Every visitor would
  then have shared the website's egress as their network bucket, so ten
  reports an hour for the whole site and one "reporter" for the five-reporter
  rule. Reports now go from the visitor's browser straight to the API, which
  allows `https://autohand.ai` as an origin for that one route only.
- On the built website (not in Vite's dev server) the bird faces were blank:
  the page function for `/squad/marketplace/*` also caught
  `/squad/marketplace/birds/*.svg`. It now hands those to the static assets.

## Consequences

- Two databases to migrate and back up for the Squad API; the runbook lists
  both.
- Search is `LIKE` over a stored lowercase text column. It is fine for
  thousands of listings; FTS5 is the next step if the catalogue grows.
- The Worker's public responses are cacheable for 5 minutes at the edge, so a
  hidden or removed listing can stay visible on cached pages for that long.
- No signatures, no per-listing screenshots, no ratings or comments, no
  publisher profile pages, no email to a publisher when a listing is hidden.
- Seeds are inserted once. Changing a seed's content later needs a new
  version through a script that does not exist yet.
- The Grok import gives a starter agent, not the original instructions; and
  Grok's bot-sharing terms were not readable to automated clients and need a
  human read before the feature is announced.
- Autohand-authored listings cannot be changed through the publisher routes.
- The desktop's `squad://` handling was compiled and tested only as the
  std-only parser (`rustc --test src-tauri/src/deep_link.rs`, 4 tests); the
  Tauri glue was checked against the plugin's source signatures but not built,
  per this lane's no-native-build rule. The first signed build must be tried
  with Squad closed and open before release.
- Marketplace dialog and publish copy are English fallbacks, not yet in
  `src/locales.js` for other languages.
