# ADR-0265: New message's To field, member quick settings, connectors that invite, and suggestions from what a member can do

Status: accepted, 2026-11-20

## Context

Igor, 20 Nov 2026, with screenshots of Slack and Codync:

- "why don't we have a new message ui similar to this". New message was a
  search box over a checkbox list of members, with no presence and no
  channels.
- "permissions for agents users can set allow to manage other agents, look
  how codync does". Codync has one switch, "Manage the team: let this bot
  create bots and change any bot's setup". In Squad the same power was nine
  separate built-in tool rules (`squad_create_member`,
  `squad_update_member_profile`, …) on the Built-in Tools tab, defaulting to
  ask.
- "i'd love to have permissions tab here too quick easy and more details
  when i click on full profile". The Execution panel had Runs, Tasks and
  Automations only.
- "Connectors even if the agent doesn't have any is not listing the ones we
  support and incentive people to actually connect it". A member's
  Connectors page said only "has no connector tools of their own. Shared
  connectors are in Settings → Connectors."
- "I also don't see where i can set an email to an agent". ADR-0262 offered
  the address only through Chief of Staff's MCP offer.
- "these should be suggestions dynamically based on skills, connectors and
  work the chief of staff can do". The welcome's "Try asking" lines
  (ADR-0032) are role and skill templates. For a Chief of Staff with no
  skills they were the same three role sentences every day.

## Decision

- **To field.**
  - New message has a "To:" field. The list under it shows each member's
    face, name, presence dot and role, then channels as `#name`.
  - Members become chips (two or more make a private group chat, as
    before). Backspace removes the last one. Arrow keys and Enter choose.
  - Choosing a channel opens it. Typing `#` narrows to channels.
  - The list is open when the screen opens, as in Slack.
- **Manage the team.**
  - One switch sets the nine team tools to allow; off sets them back to ask.
  - It writes the member's base rules and every folder override, because an
    override wins (`withTeamManagement`, `managesTeam` in
    `src/lib/permission-policy.js`).
  - The Built-in Tools tab still shows each rule.
- **Quick settings** (`MemberQuickSettings`): Manage the team, Email,
  Connectors and Computer Use, as divider rows with one sentence each.
  - They are the fourth tab in the Execution panel (Permissions,
    `?panel=permissions`).
  - Team and email also lead the profile's Permissions page.
- **Email** shows the address with Copy, or "Create address" for an account
  that may hold one (the same `/api/mail` route as ADR-0262), or the
  sentence that says why not.
- **Member Connectors** (`MemberConnectors`):
  - What the member can use: its own tools and the shared connectors.
  - Then "Connect more": up to eight supported connectors, Squad's Google
    ones first. Connect opens Settings › Connectors with that entry's
    install dialog (`?install=`).
  - Connectors stay shared. The page says so instead of drawing per-member
    switches the runtime cannot honour.
- **Suggestions from context.** `suggestionsFor(agent, context)` leads with
  what the member can do now:
  - a reply that stopped;
  - recent work to follow up (the whole squad's for Chief of Staff);
  - asks drawn from connected connectors (mail, calendar, GitHub, Linear,
    Notion/Drive, Slack, CRM, Figma);
  - for Chief of Staff, the squad itself, or "which tools should I connect".
  - Role and skill prompts follow. Everything after the first rotates by
    day.

## What was run

- `scripts/check-member-controls-browser.mjs` (new) passes. It proves:
  - the To field lists both members with presence, then `#release`, and
    choosing it opens the channel;
  - the Permissions tab shows four rows, and Manage the team on reaches the
    bridge as `allow` for all nine tools, then off as `ask`;
  - the Permissions page shows Team and email;
  - member Connectors lists suggestions, and Connect lands on
    `/settings/connectors?install=` with the dialog open.
- `scripts/check-group-chats-browser.mjs` drives chips through the To field
  and passes.
- `check-member-suggestions` passes, extended with the context cases:
  - failed work leads;
  - a connector becomes an ask;
  - no repeats;
  - the list differs from day to day;
  - with no context the old behaviour is unchanged.

## Consequences

- "Manage the team" does not make members created by that member inherit
  the switch, as Codync's does ("the bots it creates can too"). New members
  start at their rank's defaults.
- Connectors have no per-member on/off. Codync shows one switch per bot.
  Squad shows what every member can use. Per-member scoping would need the
  runtime proxy to filter tools by member, and was left out.
- Suggestions read connectors and runs when the empty chat opens: two bridge
  requests, nothing on later messages. The rotation is per calendar day in
  UTC.
- The connector list on a member's page comes from the catalogue's first
  page. An entry beyond it is reached through All connectors.
- Notifications per member (Codync's first switch) was not added. Squad's
  notification settings are per channel and per Squad.
