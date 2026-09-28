# Design Direction

## UI Component Style

- Product UI should feel simple, functional, and Notion-like: calm document surfaces, clear hierarchy, whitespace, and concise controls.
- Avoid bento-style layouts, boxed dashboards, and card walls. Do not turn each designated area into a bordered or tinted rectangle.
- Use borders, background fills, and framed panels only when they materially improve scanning, form containment, or interaction affordance.
- Keep border radius restrained, usually in the 4px to 8px range. Avoid heavy bevels, bulbous corners, glassy panels, and decorative gradients.
- Prefer subtle separators, text scale, alignment, and spacing over colorful section backgrounds to show grouping.
- Keep colors neutral and restrained. Use accent color for actions, status, and focus states, not as broad section fill.
- Use shadcn/ui components and tokens as the baseline. This repo is configured through `components.json`; add missing registry components to `src/components/ui` before writing custom primitives.
- Chat replies should stream the answer as it arrives, show elapsed time and tool activity, and keep raw diagnostic output hidden unless an explicit chat setting enables it.
- While a chat reply is running, the composer should keep a clear stop control and accept additional follow-ups into an editable queue shown directly above the input.
- The composer is a single calm bordered field on the page background (no nested card, heavy drop shadow, or glassy blur); use a subtle focus-within border rather than elevation.
- Do not open a conversation with a boxed status/metric dashboard. Show the member's purpose as quiet text and surface mode/status/workspace as a subtle inline meta line, not bordered metric cards.
- Keep Mission Control out of the primary sidebar; expose it from the Settings/account menu and Settings page while preserving direct routes and tray deep links.
- Keep the tray/menu-bar menu action-focused. The only status block is the compact account/usage summary described under Desktop Shell; do not add further disabled summary lines when the same live details are available in submenus or app views.

## Squad Directory (landing surface)

- Opening Autohand Squad lands on the Squad directory at `/squad` (the app root `/` redirects there). This is the team's home, not an individual member's chat.
- The directory is an employee-directory layout: a calm header (live eyebrow, title, one-line intro), a borderless metric strip (Members / Online now / Active work / Needs attention), a search + status filter row, then a divider-separated member list — no cards or tinted panels.
- Each member row shows: avatar with a status dot, name + role + workspace, a status indicator (dot + label derived from live task/run state), and up to three most-recent tasks with status dots and relative time. Row actions are an inline chat button plus a manage menu (open chat, view profile, automations, remove member). Removal always goes through a confirm dialog.
- Status is conveyed with small colored dots and text, never full-bleed colored fills, consistent with the neutral product surface. The page is theme-aware via design tokens (works in light and dark).
- Live data comes from the existing agents/tasks/runs state (same source as Mission Control via `buildMissionRows`); keep it reading those rather than introducing a parallel data path.

## First-Run Onboarding

- Opening `/` routes to `/welcome` until the user is signed in and completes or skips setup; completed or skipped users land on their first member's chat (finish) or the directory (skip).
- Onboarding is three moments in one calm column: **Point at a folder** (native picker plus recent workspaces), **Meet your first teammate** (three roles ranked from the folder profile, best fit preselected, name prefilled), **Start talking** (creates the member and opens the chat with the first message drafted). No checklist, no percentage bar; the current moment is the progress.
- Readiness is silent while green. A blocked prerequisite (not signed in, runtime down, no provider) is one sentence with one action above the current moment. Sign-in stays delegated to the runtime's device flow; provider setup deep-links to Settings and is never duplicated here.
- Skip is available once signed in; persisted state stays lightweight (status, selected workspace, member readiness, last step).

## Settings

- Settings is two columns: a slim sticky section list on the left (plain text rows, the current section highlighted by a soft fill, a one-line runtime status underneath) and one content column of at most `max-w-3xl` on the right. The window header already says "Settings"; the page adds no second title, no eyebrow, no summary grid, no path or environment echoes.
- Each section is a heading (`text-base`), one sentence of description, then rows: label and detail on the left (`220px`), the control on the right. Sections are separated by a single divider; the first sits flush with the top of the column.
- Toggles and choices are divider rows, never bordered or tinted boxes. A selected choice shows a check mark and a stronger label, not a filled background. No icons in section headers.
- Copy avoids repeating a word three times in view: the section is "Appearance", its first row is "Mode"; the "Language" section's row is "Display language".
- Notifications is one switch row per event kind and a ghost Send test notification button.

## Squad Channels

- Channels live inside the primary Squad sidebar as a collapsible category under the main navigation, not as a second navigation sidebar.
- The expanded channel category shows channel rows inline with the rest of the sidebar and exposes channel creation from the same area.
- Channel detail pages should use the main canvas for the active channel, member controls, threads, and composer; avoid adding another left rail or boxed dashboard around channel navigation.
- Channel creation and member assignment should stay reachable from both the sidebar category and an empty channel state.
- Channel composers should match the normal chat mention autocomplete behavior for `@here` and member handles, including keyboard selection. Channel loading placeholders should say the member is typing rather than thinking.
- A Canvas tab sits beside the stream as an underlined text tab (Messages | Canvas in the channel header; the member chat reaches the same view from a header icon). The canvas is title, editor, and a 224px revision rail separated by one divider; member edits are a bold rail row with a dot, and the diff colours only the changed lines (soft green / soft rose), never the page. `@canvas:slug` in either composer attaches the canvas to the message.
- Workflows live in the channel settings popover as a divider list (name, trigger summary, enabled switch) with a right-side drawer editor; a run appears in the stream as ordinary member messages carrying a small workflow tag, and an approval gate is one divider row with Approve, Decline and the emoji hint — no banners, no cards.
- Media in a channel message is inline: images at most 320px tall, videos with native controls and a slim one-line scrubber underneath; anchors are small outlined text badges ("0:12 · region"), never pins or cards. Anchor mode is a thin accent ring on the media plus inline Cancel / Use anchor text buttons; a pending anchor or attachment is one outlined chip above the composer.

## Typography

- The product typefaces are **Autohand Sans** for UI and **Autohand Mono** for code, both shipped from `public/fonts` (no font CDN; the desktop app works offline). Tokens: `--font-ui` and `--font-code`; do not reference another family directly.
- Autohand Sans is the variable font (weights 400–700, width 75–100%); Autohand Mono ships Regular, Medium, and SemiBold, with 700 mapped to SemiBold. Licences and provenance live in `public/fonts/ATTRIBUTION.md`.

## Harness Identity And Desktop Shell

- Treat a member's personality, execution harness, model, and permission level as separate choices. Changing between Autohand Code, Codex, and Claude Code must not rewrite the member's brain card.
- Add harness selection as one concise **Runs with** field during member creation and a dedicated Harness section on the member profile. Prefer a restrained list/select and inline readiness text over large vendor cards.
- Show harness readiness as plain states such as Ready, Setup required, Not detected, or Unsupported version, with one direct setup action. Never silently fall back to a different harness when the assigned harness is unavailable.
- Keep harness identity visible but quiet in member metadata, launch preflight, active work, evidence, and handoffs. Do not add another row of boxed metrics or colorful status panels.
- The installable desktop product should open and focus its own native app window. Tray/menu actions should focus or route that window; browser opening remains a developer/headless fallback rather than the primary installed experience.
- The desktop window uses the overlay title bar: the page extends under the traffic lights and the sidebar carries the inset (`html[data-shell="desktop"]`), so the vibrancy layer, never another app's window, shows through the top strip.
- The desktop app owns a native menu bar (File › New › Agent / Channel, Edit, View › Inbox / Agents / Channels / Mission Control / Search / Toggle Sidebar, Window). Menu items dispatch one `autohand-squad:menu` DOM event (`src/lib/desktop-menu.js`); the web app maps actions to its existing navigation, so menus never encode routes.
- The tray menu opens with a compact, quiet status block (disabled lines): "Signed in as …", the plan name, one gauge line per metered usage window ("5 h  ▰▰▱▱▱▱▱▱▱▱   2% · resets in 4h 52m"), and the squad line while services run. Then the actions: Open, Mission Control, Members ▸, Refresh usage; Sign out / Sign in… (never both), Check for updates…, Launch at Login; Start / Stop / Restart services, Open logs folder, Settings…, Report a bug, Give feedback, About; Quit. Labels are short verbs; the tray icon already names the app.
- Sign-in state in the tray follows the account the bridge reports (Squad session or the Autohand CLI session), never only the daemon's in-memory account.
- The account footer and menu show the signed-in Autohand account (name, email, initials or avatar) reported by the bridge; never a hardcoded person or plan. "Sign out" is real: it clears the session shared with the Autohand CLI and returns to the sign-in gate.
- Bug reports and feedback live in the account menu, not in a floating button; nothing may float over the composer's send control.
- Inbox: "Mark all read" clears unread channels and acknowledges handoffs and memory proposals up to that moment, so the badge drops to zero while pending proposals stay listed for a decision.
- Native startup and recovery states should use the same calm app surface: concise progress, an actionable error, Restart Service, and Open Logs. Do not leave users in a blank webview or redirect them to a raw local server page.

## Workspace Shell (Buzz-style)

- Presence dots have five states: accent and breathing while working, green online, amber idle, grey offline, and a dotted ring when the bridge is unreachable. Only working animates. Stop sits with the chat header actions and on the profile, confirming in a small popover.
- The primary sidebar is a Slack-like workspace rail: a **Search everything** control (⌘K / Ctrl K), Inbox, Agents, channel sections grouped by the channel's `section` (default "Channels"), then **Direct messages** listing members with presence dots and unread counts, and the account footer. No cards, no tinted panels; unread state is a bold row plus a small dot or count.
- Channel pages are flat, chronological streams: a `# name` header with member count and a settings popover, day separators, a red **New** divider at the last-read boundary, author + time, mention chips for targeted members, emoji reactions with counts, and quick actions on hover. Thread replies render inline under their root with a subtle indent instead of a stacked thread block.
- The composer is one calm bordered field with @ / attach / emoji / format on the left and a round send button on the right; Enter sends, Shift+Enter breaks a line, and `@` opens a keyboard-navigable mention picker.
- Presence is one living line under the composer, not placeholder rows: stacked avatars, then "Iris is thinking…", "Iris and Noah are typing…", "Iris, Noah and 2 others are running tools…", with three breathing dots. A reply enters the stream only once it has text. The line renders nothing when nobody is active and never shifts layout.
- Squad recruiting notices ("Kai wants to join #client-abc — DevOps engineer. Kai can help with the Dockerfile and CI in api; nobody in the channel covers that yet.") sit above the composer as a divider-separated row with Add and Not now. They are visible to the user only, never sent to members, and never counted as unread.
- Inbox is a single divider-separated list (unread channels, handoffs waiting, memory proposals) that links back to the surface owning each item.
- Search results are grouped by type under a quiet filter row (toggle chips, no pills); rows are icon + title + muted snippet with the hit in semibold, no highlight colour; ↑/↓/Enter navigate; an empty query lists recent searches.
- A bell beside the search control carries a small dot while notifications are unread; its popover is a divider list (title, one-line body, relative time) with Mark all read. Native notifications are posted by the bridge, never while the conversation is on screen.
- Providers in Settings are a divider-separated list, expanded one at a time. An account-backed provider (Autohand AI) shows its status as one sentence ("Signed in as …; an API key is optional"), a model select fed by the catalog, and a managed base URL placeholder; it never asks for a key it does not need.
- The **Runs with** control is one select plus one readiness sentence; advanced fields (model override, executable path, Test harness) sit behind a text disclosure. The profile shows Harness as a text summary row beside Model, never as vendor cards.

## Work

- **Work** sits in the sidebar beside Inbox and Agents, with a count of tracked tasks. A primary surface needs a permanent place to stand; this one was reachable only from the command palette, the account menu and links out of the Inbox.
- The surface that lists what the squad is doing is called **Work**, not Mission Control. The old name promised a command centre and the page is a roster of who is on what.
- It opens with the page title and one sentence naming only what is true right now ("2 working · 3 blocked"), never a row of metric tiles. A quiet squad reads as quiet rather than as four zeroes.
- Members and work records are both divider rows in one column, with the same grammar: what it is, one line of detail, then a dot-and-word status with the workspace and any marks beside it. No card grid, no five-column table, no tinted status chips.
- A selected record is marked with a quiet left border, never a filled background, because a tinted block on one row of a divider list is the only thing that reads as a card.
- Filters are text toggles on a divider row, underlined when active. They are one choice with several values, not several buttons.
- Status meanings are documentation and do not live on the page.
- The page uses the repo's own tokens. It used to hard-code a light palette and force it in dark mode, so the whole surface rendered white inside a dark app.

- The desktop window has no title bar of its own, so the shell reserves a band at the top for the traffic lights and renders one empty fixed strip that owns the window drag. Headers add to that area by declaring themselves deep drag regions, which drag from anywhere inside them while their own buttons keep working. It is the only drag region in the app: dragging delegated to page headers only works on the slivers between their children, and disappears entirely on a page that renders no such header.

- The setup guide is onboarding, not an account action. It lives in Settings as its own section and can be run again at any time; it is not in the account menu beside Sign out.
- In the desktop shell the webview's own context menu is suppressed, because Back and Reload are browser actions in something that is not a browser. Text fields keep theirs, since cut, copy and paste are the reason anyone right-clicks in one.
- Green means state and nothing else: online, working, passed, the active share of the team. The primary action is neutral, near-white on dark and near-black on light, so a colour carries one meaning. This applies to the Autohand presets; the presets that imitate other products keep their own accent.
- A disabled primary button must come from the shared button primitive, which drops it to a neutral surface. A button that hard-codes its own accent colours keeps the fill when disabled and still reads as the page's call to action.

## Agent Chat

- The header is one row: avatar, name (opens the profile preview), role, and a meta line with a live status dot (Online / Working), workspace, model, and a **Runs with** chip that opens the engine switcher. Actions on the right are **New chat** plus icon buttons for automation, tasks, and runs.
- Messages sit in a 48rem column. User messages are quiet right-aligned bubbles (muted background, no border) with the time on hover. Member messages are avatar + name + time + a small live indicator while working; the answer is prose at 15px/1.75. No badges, no cards.
- While working, one line shows the current stage with a small spinner. Work details are a text disclosure with a summary (steps · tools · duration); raw diagnostic output stays behind the chat setting.
- Work details is a semantic activity feed: one divider row per action that updates in place, reads folded into a "read 12 files" row, edits and shell commands in mono, failures in the destructive colour with their detail open, and a text Raw toggle for the unprocessed trace. The Execution panel's run output uses the same feed.
- A failed answer is an inline destructive note with the cause, a **Retry** button, and a sign-in hint when the cause is authentication.
- The composer is one rounded bordered field over a soft gradient; workspace, add, settings, and terminal sit left, queue and the round send/stop button right. Enter sends, Shift+Enter breaks a line, `@` mentions members.
- The empty state introduces the member ("Hi, I'm Eva.") with role and description, then a divider list of suggested asks.
- Member avatars are the bird portrait set under `public/avatars/birds`: square, soft 3D, lilac gradient background, one role hint per bird. Role portraits are legacy; do not add new ones.
- The composer's picker is one quiet popover for `@`, `/`, and `$`: icon, token, and a muted detail column; the selected row uses the accent background. Presence on member rows is a small dot (green online, primary pulsing while working, muted idle).
- Terminal output and app notes (from `!` and `/`) render as ordinary member rows authored by "Terminal" or "Squad", never as system banners.
- The Execution panel is a plain sheet: a title with an inline count sentence, a "Now" divider list of active tasks, underlined text tabs, and divider lists for runs and tasks with a text disclosure for output. No metric tiles, no cards, no auto-opening on mention.
- Sign-in surfaces are single-column, left-aligned, and calm: one primary action, the sign-in link and device code when the CLI prints them, a terminal alternative, and a **Check again** action.

- The sidebar header carries a quiet workspace switcher (current workspace name, chevron, popover list with a status dot per relay workspace and a "Connect a relay…" row). Member ownership is one muted meta phrase ("Runs on Noah's Mac"), never a badge. People presence is one sentence under the member presence line.

- Git events (commits, pull requests, CI) are one-line muted rows between messages, indented to the message text column: icon, short ref, title, a dot-and-word status, time on the right. No cards, no coloured fills; status colour follows the presence dots. Pull request rows reveal Review and Open on hover. The Repository section in channel settings is two inputs, one status sentence, and Bind/Unbind.

- A member row in the sidebar reveals a vertical overflow menu on hover: Chat, Details, Take a break, Delete. Chat comes first because it is what the row itself does. A member on a break declines new work in its own voice rather than going quiet, and delete asks first, naming the member.

- Opening a member's chat leads with what changed since your last visit, under a quiet "Since you were last here" label: a divider list of at most five lines, what it learned first. Every line comes from the member's own history, never from the model. A member with nothing to report shows nothing.

- Settings carries a Self-improvement section: two switch rows, on by default. Members review their own work every few hours and post the result into their own conversation as an ordinary message. That message is the whole of "proactive": no banner, no new notification kind, no badge.

- Tables in a member's reply render as divider rows with no fills or borders around cells, scrolling horizontally inside the message column rather than widening it. A disabled primary button drops to a neutral surface, so it never reads as the page's call to action.
- While a member is working, the direct-message composer carries one muted line under it saying what it is doing, in the same place the channel composer shows presence.

- The new-member page is one question and its answer, in a 720px column. Describing the role is the primary path, as a textarea that grows with the text: Enter writes a newline, ⌘ or Ctrl with Enter designs. Ready-made roles wait behind a disclosure as divider rows with a check on the selected one, never a card grid with toggles.
- The line that replaces a wait names what arrived and carries the one action that outcome deserves: a designed member offers "Review it below", which scrolls and then focuses the name. A lesser but usable result reads the same way and differs by structure, not colour, offering "Try again". Only a genuine failure uses the destructive colour, on the text alone.
- A wait for a model says the two things that are known: how long it has been, and when it will stop, and it can be stopped. Stopping returns the surface to exactly where it was with what was typed intact, reports nothing, and discards an answer that arrives afterwards. The line appears where the answer will land, after a short gate so a fast reply never flashes it, and is replaced in place by its own result. Past twelve seconds it says what happens if nothing arrives. Spinners stay out of buttons: a control is not busy, a request is.
- The instructions and brain card a member starts with sit behind a "How it will work" disclosure of labelled divider rows, editable. They are what the model writes and what decides how the member behaves, so they are one disclosure away rather than absent or on the page by default.
- The designed member arrives as a member, with a name in a borderless heading, its role beneath, and a portrait picked from its own role and name. The fifty-four-portrait picker waits behind "Choose another portrait". Filling the page never scrolls it or takes focus, so the line saying whether a model or the description designed it stays in view.

- "Try asking" is built from the member's own role, skills and workspace, so no two members offer the same prompts and none contain a placeholder.
- The window is never blank: an inline boot screen paints the mark and one line before the bundle parses, then real start-up checks replace it, with member avatars settling in as the squad is read. No progress bars, because a bar that measures nothing is a lie told smoothly.

- A member picks up a tool the work kept failing without, and adds a line to its own escalation rules when a run of work goes badly. Both are announced in its own conversation, never applied silently.

- A new member's first message is the member saying what it will do: what it is, where it works, what it is set up for, and when it will stop and ask. Composed from its own configuration, never asked of a model, so every sentence can be checked against the profile beside it.

## Member Profile

- History is a divider list grouped by day with underlined text filters (All / Messages / Runs / Edits / Shell / Handoffs / Approvals), a ghost Load more, and one outline Export button. Rows are icon + sentence + a muted meta line (kind · time · links); failures use the destructive colour on the text only. No cards, no badges.

- **Runs on** sits under Runs with as two divider rows (This machine / Remote bridge) with a check mark on the chosen one; URL, name, and token fields, a Test button, and one status sentence. Share this machine is a text disclosure that shows a minted token once with a copy button. Failures name the remote. A remote member reads "/ on Studio" in the profile summary and a reply that came back over the proxy ends its work-details meta with "via Studio"; the directory shows nothing, since the transport is a detail, not a badge.

- Relay is a divider-row section: URL, Token, Workspace, one Save, the enable switch, a one-sentence status and a ghost Sync now.

## Maintenance

- When a durable user UI preference emerges, update this file in the same change so future UI work reflects it.
