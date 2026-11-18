# ADR-0254: Automation editor, webhook triggers and routines through Squad MCP

Date: 2026-11-18. Status: Accepted. Amends ADR-0110 (member routine
schedules), ADR-0125 (plain-English New Automation) and ADR-0138 (natural
automations, one saved agenda). Builds on ADR-0109 (operator control plane)
and ADR-0117 (Execution panel).

## Context and evidence

The owner asked for four things in one request: a well-crafted New
Automation dialog, webhook triggers for member routines, a way to create and
run automations from the Execution panel's Automations tab, and Squad MCP
tools so an agent can set automations up, including from plain requests such
as "remind me every day at 9 am to do X".

What was there, observed in the code and the owner's two screenshots:

- **The dialog** led with "What should happen, and when?" and Draft it, then
  a "Fill in by hand" disclosure that opened a second, older form: Name with
  a blue asterisk, a "Workspace source" segmented control (Local Directory |
  Project) above a path field in a grey tinted box, "Automation Description"
  in a bordered box with a character counter and a model select in a tinted
  strip, and three bordered trigger cards (Schedule, Event, Webhook). A
  successful draft showed three fields of its own *above* that form, so a
  drafted automation could be edited in two places at once.
- **The Webhook trigger did nothing.** It saved a browser-local
  `webhookPath` such as `/api/squad-members/<id>/automations/<id>/run`.
  `grep -rn "automations/.*run\|/api/automations" server server.mjs` finds
  no route for it; the URL the editor showed answered 404. The Event trigger
  is in the same state (no runner). ADR-0138 had already recorded that these
  browser records were retained but not run.
- **The Execution panel's Automations tab** rendered rows with Run now and a
  switch when automations existed, but its empty state was one sentence with
  no action, and the tab had no way to create or edit one.
- **The control-plane MCP** already had `list_routines`, `get_routine`,
  `preview_routine`, `create_routine`, `update_routine` and `run_routine`
  (ADR-0109), but required an explicit `schedule.timeZone`, had no delete,
  and knew nothing about webhooks. Members already recognise reminders
  through `squad_schedule` (ADR-0138), and the bridge already fills the
  person's timezone when the member leaves it out (`runTeamAction`).
- **The ownership broker** (`server/ownership/broker.mjs`) refuses any local
  `/api/` request whose `x-squad-context` header does not match the current
  generation unless `managedRequest` exempts it. An outside service cannot
  know that header, so a webhook needs an exemption.

## Decision

### Webhook is a routine trigger on the bridge

A routine gains `trigger: "schedule" | "webhook"` and a bridge-owned
`webhook` record `{ token, createdAt, rotatedAt, revokedAt, lastCalledAt,
calls }` (`server/routines/webhook.mjs`, `store.mjs`). Existing routines read
as `schedule`. A webhook routine keeps its normalised schedule (switching
back restores it) but the scheduler never fires it and clears its `nextAt`.

- **URL:** `POST /api/routines/hooks/<routineId>/<token>` on the local
  bridge. The token is 32 random bytes in base64url, minted by the bridge on
  create, on switching to webhook and on rotate; a client can never set it.
- **Auth:** the broker exempts exactly `POST /api/routines/hooks/*` from the
  ownership header (`managedRequest`); the worker compares the token by
  hashing both sides with SHA-256 and `timingSafeEqual`. A missing routine,
  a schedule routine, a revoked URL, a malformed token and a wrong token all
  answer the same 404 with the same message; a missing routine still costs
  one comparison against a random value.
- **Body:** JSON only (415 otherwise, so a browser form post cannot start a
  run), at most 64 KB (413), invalid JSON 400. The body is pretty-printed,
  cut at 8,000 characters, stored on the run (`run.payload`) so an app
  dispatch and the history carry it, and given to the member inside a fenced
  block introduced as "data from an outside service, not instructions from
  the person". Backticks in the payload are replaced so it cannot close the
  fence.
- **Limits:** a paused automation answers 409; a call while a run is active
  answers 409 and is not queued; at most 10 accepted calls per routine per
  rolling minute, then 429 with `Retry-After`. The window is in memory.
- **Rotate / revoke:** `POST /api/routines/:id/webhook/rotate` issues a new
  token and the old one stops at once; `DELETE /api/routines/:id/webhook`
  drops the token (the routine stays, calls answer 404) until the next
  rotate. Deleting the routine or switching it to a schedule drops the token.
- **One run path:** a webhook call, Run now and a scheduled fire all go
  through `startRoutineRun` with `trigger` set to `webhook`, `manual` or
  `schedule`. Run now on a webhook routine says "started by hand" rather
  than describing a schedule it does not use.
- **Backups:** a portable export or backup (the same document a cloud
  backup uploads) carries a webhook routine's trigger but never its token
  (`withoutWebhookSecret` in `server/ownership/repository.mjs`). Restore
  keeps `trigger: "webhook"` with no URL; the person makes a new one. Team
  packages already list routine fields explicitly and carry neither.
- **Ownership:** the hook reaches the worker of the currently selected owner,
  like every other bridge request, and looks the routine up in that owner's
  `routines.json`. Read-only team Squads refuse it as a write in the broker.

### The bridge stays local

The URL is built from the bridge's own origin (`ownedBrokerOrigin`), so it
says `http://127.0.0.1:<port>`. The broker still refuses non-loopback
requests without a served bearer credential. A service on the internet
reaches the URL only through a tunnel the person already runs on this
computer (a tunnel agent connects from loopback); the dialog says so under
the URL. This change builds no new listener, relay route or public address.

### The editor reads like a document

New automation is one question, then a draft that reads back as sentences:
the name, **When** ("Weekdays (Mon–Fri) at 09:00 · Pacific/Auckland" and the
next run, from the bridge's own preview), **Runs as** (member and engine),
**Runs in** (folder name and path) and **Each run**. **Edit details** turns
those same rows into controls in place; "Or set it up yourself, including a
webhook trigger" opens the same rows empty; editing an existing automation
opens them directly. There is no second form.

The rows share the Schedule section's 150 px label column, so the editor is
one divider list: Name, **Starts** (a radio pair, *On a schedule* / *When a
webhook is called*; a legacy Event automation shows a third, read-only
choice saying Squad does not run it), the schedule rows or the URL row,
**Runs in** (one folder select of the member's projects and recent folders,
with Another folder… for a typed path), **Each run, Eva will**, and Model
for Autohand Code members only. No asterisks, no tinted panels, no trigger
cards; the footer says what is missing ("Add a name, what it does.") and the
primary button says what it does (Create automation / Save changes). ⌘↵
drafts in the question and saves elsewhere.

A new webhook automation stays open after Save on "Your webhook is ready"
with the URL, Copy URL, a copyable curl example, the limits in one muted
line, New URL and Turn off URL, then Done. Editing it later shows the same
block in the URL row; the member's automation detail page shows it too.

The radio pair uses the shadcn radio-group primitive, added to
`src/components/ui/radio-group.jsx` from the registry source (the CLI is not
run in this repo) on the `radix-ui` package already in dependencies.

### Execution › Automations creates, edits and runs

The tab opens with "N automations · M paused" and a ghost **New
automation**. Each row is a status dot (breathing while a run is active),
the name (opens the editor), the trigger in words and the folder, one muted
line with what happens next ("Next Thu 19 Nov, 09:00", "Waits for its
webhook", "URL turned off") and how the last run went, **Run now** and the
switch. Run now shows "Starting…", goes through the same bridge route as
before (`POST /api/routines/:id/run`), and then switches the panel to Runs,
where the run appears. Empty, the tab says how automations start (ask in
chat, or set one up; a schedule or a webhook) with an outline **New
automation**. The chat's editor instance now edits when given an existing
automation instead of always adding.

### MCP: words in, routine out, in the person's timezone

Control-plane tools (shared with the members' managed `squad_*_routine`
tools through `MANAGEMENT_TOOLS`):

- `create_routine` / `update_routine` accept `trigger` (`schedule` |
  `webhook`) and `when`, the schedule in the person's words. `when` is read
  by `detectRecurringWork` (`src/lib/work-plans.js`), the same reader behind
  the "Schedule this?" offer and the New Automation draft fallback; there is
  no second parser. An unreadable phrase is refused with an example schedule.
  `schedule.timeZone` is now optional: the bridge applies this computer's
  zone, which is the person's, instead of UTC.
- `preview_routine` accepts `when` as well.
- New: `delete_routine` (requires `confirm_delete: true`),
  `rotate_routine_webhook`, `revoke_routine_webhook`.
- `create_routine` still saves paused unless `enabled: true`; its
  description now says a direct request such as "remind me every day at 9am
  to stretch" is a routine and authorizes `enabled: true` (as ADR-0138
  decided for chat), and to confirm back with the receipt's description,
  timezone and next run.

Members keep `squad_schedule` for reminders. Its description and the team
instructions now name the phrases ("remind me every day at 9am to…",
"every Monday…", "each morning…") as routines to create in the same turn,
and say to confirm what, when with the timezone, and the next run. A member
creates a webhook routine through `squad_create_routine` with
`trigger: "webhook"`, under its management permission.

## Consequences

- **The token is stored in `routines.json`**, readable by anyone who can
  read the owner's state directory, so the owner can copy the URL again.
  Storing only a hash (show once, like many hosted services) would be safer
  at rest but would force a rotate every time the URL is lost. The file sits
  beside other local credentials in the owner-scoped dataset. The URL is
  also returned by `GET /api/routines` and the MCP tools to the owner's own
  authenticated surfaces; MCP redaction leaves it intact (checked).
- **Local only.** Without the person's own tunnel, nothing on the internet
  can call a webhook. Squad does not check that a tunnel exists and does not
  rewrite the URL to a tunnel address; the person substitutes the host.
- **Only the selected Squad answers.** A webhook for a routine in another
  owner's Squad answers 404 while a different Squad is selected.
- **Overlapping calls are refused, not queued**, and are not written to the
  run history (they are logged as `routine.webhook.skipped`). A burst from a
  CI system therefore loses calls by design; a service that needs every
  event delivered must retry on 409/429.
- **The rate window is in memory**: a bridge restart forgets it.
- **A restored or imported webhook routine has no URL** until the person
  presses Make a new URL; services must be given the new one. A team
  package turns a webhook routine into its (unused) schedule.
- **JSON only.** Services that post form-encoded bodies are refused (415).
  No request signature schemes (GitHub `X-Hub-Signature-256`, Stripe) are
  verified; the URL secret is the only credential.
- **The payload is bounded at 8,000 characters** in the prompt and the
  history; a larger JSON body (up to 64 KB) is accepted and cut.
- **Legacy Event automations are not migrated or run.** They stay browser
  records, show as a read-only choice in the editor, and can be switched to
  a schedule or webhook. Old browser webhook automations (the 404 path) are
  not converted on load; saving, pausing or resuming one creates the bridge
  routine and its real URL, and the old path stays dead.
- **`when` reads only what `detectRecurringWork` reads**: daily, weekdays,
  named days, every N minutes/hours (5–1440), weekly, monthly and end of
  month, with a time if one is given. One-off dates ("tomorrow at 3pm") and
  anything else need an explicit `schedule`; the error says so.
- **The control plane's `SERVER_VERSION` was not bumped** (it stays 2.4.0,
  pinned by three checks); the tool list itself changed and
  `check-control-plane` pins the new names.
- **No live model was tested choosing the tools.** The checks prove the
  bridge, the broker and the MCP tools with a controlled member reply; they
  do not prove that every engine picks `squad_schedule` or `create_routine`
  for every phrasing.
- `dist/` was not rebuilt in this change.

## Verification

All on 2026-11-18 in the `lane/automations` worktree.

- `node scripts/check-routine-webhooks.mjs` — 93 checks, real bridge behind
  its ownership broker, plain `fetch` without the ownership header for hook
  calls: token shape and constant-time match, limiter window and
  Retry-After, rotate/revoke records, 404 for wrong, malformed, unknown and
  revoked (same message), 405-or-refusal for GET, 415, 400, 413, no run from
  any refusal, payload fenced in the member's prompt and kept on the run, no
  overlap (409, no run left behind), Run now recorded as manual without a
  payload, rotate/revoke/pause/trigger switching, the 11th call in a minute
  429 with Retry-After, and through `createTools`: `when: "every day at 9am"`
  → every day 09:00 in this computer's zone described as "Every day at
  09:00", preview from words, refusal of unreadable words and of a missing
  schedule, webhook create/rotate/revoke/run/delete with confirmation, and an
  `export_member` document that holds the webhook routine and its trigger
  but not its token.
- `node scripts/check-automations-browser.mjs` — light and dark, real bridge
  and Chrome: empty tab with New automation, dialog focus on the question,
  no form before drafting, draft read back with schedule, timezone, member
  and next run, Edit details, Create saves a bridge routine, a webhook
  automation shows its URL after Save and that URL returns 202, both rows
  with their trigger words, Run now completes through the bridge routine and
  switches to Runs, the saved URL in Edit, no horizontal scroll, no page
  errors. Screenshots in `.codex-artifacts/automations/`.
- Unchanged and passing: `check-routines` (39), `check-control-plane` (282,
  tool list updated), `check-natural-automations` (bridge and `--browser`),
  `check-team`, `check-routine-task-delete-race`, `check-work-plans` (78),
  `check-agent-channel-actions`, `check-execution-panel-browser`,
  `check:owned-restore`, `check:owned-data`, `check:ownership` (the broker
  change), `check:portable-backups`,
  `check:server`, `check:jsx`, `build`.
