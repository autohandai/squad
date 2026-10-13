# ADR-0118: Teams from an objective, templates, and the non-blocking team build

Date: 2026-10-14. Lane `team-builder` of the parity work, branch
`lane/team-builder` from `main` at 79c8387.

## Context

The person asked for it in their own words: "add new team based on their
primary objective like Marketing team for example and bring suggested new
team members automatically with their skills of choice based on it, and etc
non blocking, and also from templates", with three screenshots of another
product: a "+" menu (New chat / New bot / New group chat / Create team /
Templates), a Templates dialog with Explore / Import / From a folder / Share
tabs and rows like "4 bots · 3 playbooks · Google Analytics, Google Sheets ·
~3 min · Load", and a template page with a member grid, "Suggested routines
arrive paused, and connected apps stay off until you approve them", and an
Add team button.

What Squad had, and what this had to respect:

- One confirmed member creation path, `createAgent` in `src/App.jsx`: it
  awaits `POST /api/agents/provision` (profile, skill install) before the
  member is published to the roster (ADR-0077). New member, onboarding,
  Duplicate and Import team all go through it. Import team (ADR-0106)
  creates members one at a time inside its dialog and reports at the end;
  the dialog is modal for the whole run.
- A team file format (`src/lib/teams.js`, ADR-0106) that is an allowlist:
  members, skills, channels, workflows, presets. It had no field for a
  routine (ADR-0110) or a connector (ADR-0107), and an unknown top-level
  field refuses the file.
- Role templates (`src/lib/member-profiles.js`) carrying a title,
  instructions, a seven-field brain card, a personality file and catalog
  skill slugs; and a deterministic member generator
  (`src/lib/member-draft.js`, `draftFromDescription`) that New member uses
  when the model cannot answer. The model path (`POST /api/members/draft`)
  takes 12–15 s per member (ADR-0031), so designing five members with it
  would be a minute of waiting for a dialog whose point is to be quick.
- Routines live on the bridge behind `POST /api/routines`
  (`server/routes/routines.route.mjs` owns the store and the scheduler;
  nothing else writes `routines.json`). Connectors are saved off by
  `ctx.connectors.create` and only run once tested and switched on.
- The notification feed is bridge-owned (`server/notify/policy.mjs`,
  `NOTIFICATION_EVENTS`), and the web app may raise any dotted event through
  `POST /api/events`.
- The Squad directory (`SquadDirectoryPage`) is a divider list of member
  rows with one summary sentence; DESIGN.md forbids a second primary button
  for Share/Import and cards anywhere.

## Decision

### A proposal, not a second designer

`src/lib/team-builder.js` (pure) turns an objective into a proposal:
three to five members with a name, a role title, one line of purpose and
suggested skills, a lead, a channel and one or two routines. The member mix
comes from a small table of objective kinds (marketing, seo, sales,
research, support, security, mobile, design, data, ai, engineering, and a
general fallback), matched by keyword in that order. Each role in a kit is
either a built-in role template, which brings the instructions, brain card,
personality file and catalog skills New member already uses, or a custom
role whose instructions and brain card come from `draftFromDescription`,
the same fallback New member uses. The team's objective and roster are
appended to every member's instructions so each one knows who it works
with. Names come from a pool that avoids the seed members' names, walk from
a role-specific start so two roles rarely share one, and go through
`uniqueName` against the squad and the members still being prepared, so a
collision gets a number. The proposal is deterministic and the dialog
re-proposes on every keystroke; it never waits for a model. The member-draft
route is not called: with it, "Add team" would mean a minute of waiting
before the dialog could even show a proposal, and the role templates
already carry what the model would have written.

### One path for an objective, a template and a file

The proposal becomes a team file (`teamDocumentFromProposal`), validated by
`validateTeamFile` like any file. So a team from an objective, a built-in
template and a file from a folder all take the same route: the bridge plans
it (`POST /api/teams/import/plan`, names made unique), the browser prepares
the members one at a time through `createAgent`, and one
`POST /api/teams/import` call adds the channel, the routines and the
connectors with the real member ids. Share team… then exports the same
shape back out, routines included.

Version 1 of the format gains three optional parts, all rebuilt through the
allowlist: `team.description` and `team.lead`; `routines`
(`member, title, instructions, schedule, maxRunMinutes`) which always arrive
paused and whose time zone is optional, the importer's filling it;
`connectors` (`name, kind, url | command, transport, headers | env` as names
only, `note`). A header value, an env value, an API key or an `enabled` flag
on a connector refuses the file: a key or token is never in a file. The
built-in Web research row is carried as `kind: "builtin"` and never
created, only named.

The bridge creates routines by calling its own `POST /api/routines`
(the route owns the store and the scheduler), paused, and saves connectors
through the store with empty header values so the person adds the key in
Settings → Connectors and tests before switching on. A routine that fails
is reported under `dropped` and the channel stays, because the members in
it already exist; this is different from workflows, which roll the channel
back, and deliberately so: a routine is additive and the person can add it
from the Automations page, while a half-made channel was the thing ADR-0106
refused to leave behind.

### Non-blocking: the build record

"Add team" closes the dialog at once. `addTeam` in `src/App.jsx` records a
build (`createTeamBuild`) under `autohandSquad.v1.teamBuilds` with the
document, the plan, each member's draft and its pre-minted id, and
`runTeamBuild` works through it in the background: each member becomes
"preparing", then "ready" when `createAgent` returns (at which point it is
an ordinary member in the roster and leaves the build's rows), then the
bridge step, then the build is removed and a `team.built` event is raised
through `POST /api/events`. The feed turns that into one notification,
"Marketing team is ready · 4 members prepared · #marketing-team created · 2
routines paused", under the Run finished setting, or "could not be
finished" under Run failed, routed to `/squad`. No new notification setting
was added.

The directory shows the build as rows at the top of Everyone in the member
grammar (`TeamBuildRows`): avatar, name and role, "Preparing… (1 of 4
ready)", a spinner and "Joining Marketing team". A failed member says why in
the destructive colour on the text only, with Retry and Dismiss. A reload
marks an in-flight build interrupted rather than losing it (`resumeBuilds`);
Retry resumes from the first member that is not ready, or from the bridge
step when every member is. The summary line counts them ("1 member · 4
preparing").

Trust follows the source. The app's own proposals and the built-in
templates switch their catalog skills on and use the default permission
state, as a role picked in New member does. A file from a folder is an
import: skills off, the Ask ladder level, presets offered, as ADR-0106
decided for files.

### Templates

Six team files ship in `server/teams/templates/` (Marketing campaign team,
SEO growth team, Engineering team, Lead research team, Competitor watch,
Inbox follow-up), each with members whose instructions and brain cards are
written for the job, a channel with everyone in it, two or three routines,
and the connectors it would use: the built-in Web research row, and the
public remote MCP addresses of GitHub, Sentry and Linear with an
`Authorization` header name and no value. The bridge serves them
(`GET /api/teams/templates`) and the same files are bundled into the web app
by a Vite glob (`src/data/team-templates.js`) so Templates works offline
and against an older bridge; the app prefers the bridge's list when it
answers. The folder is inside `server/`, which the desktop runtime already
stages whole.

The dialog has Explore (search, divider rows with an icon, the name, the
purpose, "4 members · 2 routines · needs GitHub, Sentry", Load), Import
(hands the file to the existing Import team dialog rather than a second
review screen) and From a folder (a directory picker; every
`.squad-team.json` in it is validated in the browser and listed; a file
that will not do is one muted row with the reason). The detail keeps the
dialog: a breadcrumb back, the paragraph, one facts line, Team members,
What gets created (channel, routines "arrives paused", connectors "stays
off"), and the two sentences the reference screenshot carried: what is
loaded and what stays off, and that existing members are unchanged with
duplicate names numbered.

### Where the controls are

New team is a second outline button beside New member, because both create
members; Templates…, Share team… and Import team… stay in the overflow. The
sidebar's "+" on Direct messages became a three-row popover (New member,
New team…, Templates…) in `src/components/teams/CreateMenu.jsx`; the
sidebar component only adds the menu when the two new handlers are given,
so other callers keep the plain button.

## Evidence

Run on 2026-10-14 from this lane.

- `bun run check:team-builder` (`scripts/check-team-builder.mjs`): pure
  checks and a real bridge in an isolated state directory, both passed.
  The pure half: "Marketing team for our NZ launch" gives four members
  (Marketing Lead leading, Content Operations Specialist, SEO Specialist,
  Data Analyst), every one named, with a purpose and skills, none named
  Maya, Noah or Eva when those exist, no two alike, `#marketing-team`, two
  routines; the same input gives the same proposal; unticking the lead
  moves the lead; renaming the team renames the channel; the proposal
  validates as a team file whose channel holds everyone and whose every
  member's instructions carry the objective and the roster; the custom role
  starts "Act as SEO Specialist." with a brain card from the member-draft
  fallback; `planImport` numbers "Aroha" to "Aroha 2" and keeps the lead on
  the renamed member. A built file with a `Bearer ghp_…` header value, an
  `sk-live-…` env value and a `firecrawlApiKey` carries none of them and
  only the header and env names; a connector with an `apiKey` field refuses
  the file. Every template validates with zero secret warnings, names a
  lead who is a member, puts everyone in its one channel, and names only
  real role template ids; `templateMeta` reads "4 members · 2 routines ·
  needs GitHub, Sentry" for the Engineering team. A build with one ready
  member survives a reload as interrupted with the ready member still ready.
- The bridge half: `GET /api/teams/templates` lists the six files; the
  plan for the Engineering team against an existing "Atlas" names "Atlas 2";
  the import creates `#engineering` with the four ids, two routines both
  `enabled: false` with `schedule.timeZone` filled from the request's
  `Pacific/Auckland` and no runs, and GitHub and Sentry connectors saved
  `enabled: false` with an `Authorization` header present and
  `configured: false`; a second import names the channel `engineering-2`,
  keeps both connectors (no duplicate), and declines routines when asked;
  `POST /api/teams/export` for the created members carries both routines
  by member name with no `enabled` flag and the lead; `POST /api/events`
  with `team.built` lands in `GET /api/notifications` as "Engineering team
  is ready" routed to `/squad`.
- `bun run check:team-builder:browser` (`scripts/check-team-builder-browser.mjs`,
  headless Chrome against `dist/`): New team opens from the Squad page,
  typing the objective shows Marketing Lead, `#marketing-team` and "arrives
  paused"; the overflow opens Templates with the six rows and the Engineering
  meta line; Load shows "Atlas leads", "What gets created", "stays off" and
  the footer naming the one existing member; Add team closes the dialog
  within five seconds and the directory shows four rows "Preparing… (0 of 4
  ready)", the summary "4 preparing", and `autohandSquad.v1.teamBuilds`
  holds the build. Screenshots, looked at before the design was called
  done: `.codex-artifacts/lanes/team-builder/new-team-dialog.png`,
  `templates-dialog.png`, `template-detail.png`, `directory-preparing.png`.
  The first run of the screenshots showed template rows running past the
  dialog's right edge (the dialog body is a grid item; without `min-w-0` a
  truncated row widens it) and the word "Lead" on all four proposal rows;
  both were fixed and the screenshots retaken.
- `bun run check:teams` passes with the two added top-level keys and the
  two summary counts. `bun run check:notifications` passes with the new
  event. `bun run build` (3.8 s) and `node scripts/check-render.mjs` pass.
  `bun run check:jsx` passes for 170 files.

## Consequences

- The proposal is a table, not a model. An objective the table does not
  recognise gets the general kit (Product Manager, Full Stack Developer, QA
  Engineer, Technical Writer) and a team called "Team"; the person renames
  it and unticks what they do not want. Asking the member-draft model per
  member would give better custom roles for unusual objectives and was
  left undone for the reason above; the seam is `proposalMemberRecords`,
  where a model's answer would be merged the way `mergeModelDraft` does.
- Members are prepared sequentially, as Import team does. Four members
  take four provisionings in a row; running them in parallel would be
  faster and was not tried, because provisioning installs skills and the
  cost of four concurrent installs on a slow network was not measured.
- A build caught by a reload is interrupted, not resumed: the person
  presses Retry. The in-flight `createAgent` of the interrupted member may
  still have provisioned a home on the bridge under its id; Retry creates
  it again under the same id, which `createAgent` tolerates (it replaces a
  roster entry with the same id) and provisioning overwrites.
- Connectors from a template are saved with their public address and an
  empty `Authorization` header. The person still has to find the right
  token for each service; the template's note says where it goes. Linear,
  Notion-style OAuth servers may not accept a bare bearer token; the row
  can be edited or removed in Settings → Connectors. Connectors are not
  exported by Share team… because they are squad-wide, not a team's.
- A routine that cannot be created leaves the channel in place and is
  reported under `dropped`; the person adds it by hand. This is the
  opposite of the workflow rule and is recorded above.
- Templates from a folder are read in the browser with the directory
  picker, which Chrome, Edge and the desktop webview support; a browser
  without `webkitdirectory` shows the picker as a file picker and lists
  what was chosen.
- The Templates dialog's Import tab opens the existing Import team dialog
  rather than a non-blocking path, so a file chosen there is still added
  inside a modal with a report. Making Import team non-blocking too would
  be one change (its `add` loop is what `runTeamBuild` does) and was left
  for a later lane so this one did not rewrite ADR-0106's dialog.
- The "Share" tab of the reference product (sharing a template to a
  community) does not exist; Share team… already writes the file, and there
  is no hosted catalogue to share into.
- Locale copy for the new labels is the English fallback in the
  components, as with ADR-0106.
