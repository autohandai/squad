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
- While a chat reply is running, the composer should keep a clear stop control and accept additional follow-ups into an editable queue shown directly above the input. That queue is the bridge's durable per-member queue (ADR-0111), not browser state: rows are a status dot, the editable text, Move up/down, Send now, Edit and Remove; the header carries the count and one Pause/Resume text button; a paused queue says why in one muted line. Quick Chat shows the same list compactly (count, Pause/Resume, arrows, Remove). Stop cancels the running follow-up and pauses the queue; New chat clears it. Follow-ups that have started appear in the stream as a user message and the reply, like goals.
- The composer is a single calm bordered field on the page background (no nested card, heavy drop shadow, or glassy blur); use a subtle focus-within border rather than elevation.
- Do not open a conversation with a boxed status/metric dashboard. Show the member's purpose as quiet text and surface mode/status/workspace as a subtle inline meta line, not bordered metric cards.
- Needs you is the primary destination for human attention and squad work. Preserve older Mission Control and Inbox routes as aliases; do not expose a second disconnected work destination.
- Keep the tray/menu-bar menu action-focused. The only status block is the compact account/usage summary described under Desktop Shell; do not add further disabled summary lines when the same live details are available in submenus or app views.

## Squad Directory (landing surface)

- Opening Autohand Squad lands on the Squad directory at `/squad` (the app root `/` redirects there). This is the team's home, not an individual member's chat.
- The directory is an employee-directory layout: a calm header (live eyebrow, title, one-line intro), a borderless metric strip (Members / Online now / Active work / Needs attention), a search + status filter row, then a divider-separated member list — no cards or tinted panels.
- Each member row shows: avatar with a status dot, name + role + workspace, a status indicator (dot + label derived from live task/run state), and up to three most-recent tasks with status dots and relative time. Row actions are an inline chat button plus a manage menu (open chat, view profile, automations, remove member). Removal always goes through a confirm dialog.
- Status is conveyed with small colored dots and text, never full-bleed colored fills, consistent with the neutral product surface. The page is theme-aware via design tokens (works in light and dark).
- Live data comes from the existing agents/tasks/runs state (same source as Mission Control via `buildMissionRows`); keep it reading those rather than introducing a parallel data path.
- One member menu everywhere (directory row, sidebar row, chat header), in one order: Open chat / View profile / Automations, Pin / Mark unread, Duplicate / Share as preset…, Hide / the state toggle, Remove. It is a popover of plain rows from `src/components/members/MemberMenu.jsx`; an item is absent, not disabled, where it makes no sense (no Open chat in the chat header). Remove always goes through the confirm dialog.
- Pinned members sort first in the directory and the sidebar and carry a small pin beside the name; no section header, no tinted row. Hidden members leave the sidebar and the main list and sit in a collapsed **Hidden · N** disclosure under the list, divider rows with one ghost Show action each. The summary line counts them ("4 members · 1 hidden").
- Share team… and Import team… live in a quiet overflow beside New member, never as a second primary button. Both dialogs are divider lists: a heading with a count, one sentence of what the rows carry, then rows with a checkbox, a name and a muted line. A dialog says exactly what the file will hold before Save file and, afterwards, what was removed from the text and what was left out. There is no confirmation step; Save file and Add to squad are the decisions.

## First-Run Onboarding

- Opening `/` routes to `/welcome` until the user is signed in and completes or skips setup; completed or skipped users land on their first member's chat (finish) or the directory (skip).
- Onboarding is three moments in one calm column: **Point at a folder** (native picker plus recent workspaces), **Meet your first teammate** (three roles ranked from the folder profile, best fit preselected, name prefilled), **Start talking** (creates the member and opens the chat with the first message drafted). No checklist, no percentage bar; the current moment is the progress.
- Readiness is silent while green. A blocked prerequisite (not signed in, runtime down, no provider) is one sentence with one action above the current moment. Sign-in stays delegated to the runtime's device flow; provider setup deep-links to Settings and is never duplicated here.
- Skip is available once signed in; persisted state stays lightweight (status, selected workspace, selected role, name, provisioning identity, member readiness, last step). Refresh restores the current moment and its inputs.
- Start requires a validated folder, account, runtime and provider. Failed checks offer an inline retry; failed provisioning keeps the form and its choices. Setup completes only after the bridge provisions the member.
- Every New member path waits for preparation before adding the teammate. Keep one folder-scoped draft and identity across refresh/retry, including handwritten personality and brain edits; show inline preparation/error text and clear the draft on success or Cancel. “Create someone else” completes setup and drafts the first conversation after the same confirmed save.
- Custom member titles stay editable beside the name. Preserve the requested business or technical job; a detailed brief must not silently force an unrelated built-in role.
- Large saved history must not prevent a new member draft from being saved. Preserve complete cached history when relieving local-storage pressure; do not silently truncate conversations.

## Settings

- Settings has a Back action that returns to the screen where it was opened, including its route parameters and member-chat draft. Changing sections or reloading Settings keeps that origin. A direct Settings link without an origin returns to Squad.
- Settings is two columns: a slim sticky section list on the left (plain text rows, the current section highlighted by a soft fill, a one-line runtime status underneath) and one content column of at most `max-w-3xl` on the right. The window header already says "Settings"; the page adds no second title, no eyebrow, no summary grid, no path or environment echoes.
- Each section is a heading (`text-base`), one sentence of description, then rows: label and detail on the left (`220px`), the control on the right. Sections are separated by a single divider; the first sits flush with the top of the column.
- Toggles and choices are divider rows, never bordered or tinted boxes. A selected choice shows a check mark and a stronger label, not a filled background. No icons in section headers.
- Copy avoids repeating a word three times in view: the section is "Appearance", its first row is "Mode"; the "Language" section's row is "Display language".
- Notifications is one switch row per event kind and a ghost Send test notification button.
- Remote access is a divider-row section: a Bot token row (password input and an outlined Connect), one status sentence ("Polling as @bot" or the error, in the muted or destructive colour) with a ghost Disconnect, a pairing row that shows the code in `code` type with letter spacing beside an outlined Open in Telegram and a ghost New code, a paired-account row with the account name and a ghost Unpair, then the notify choice as check-mark rows (Long work / Everything / Off). No QR image, no boxed steps, no numbered wizard. The nav detail is Off, Waiting to pair, Needs attention, or the paired name.
- Messages that came from Telegram sit in the member's conversation as ordinary user and member rows; the source is data on the row, not a badge.
- Connectors is a divider list under Relay: the built-in Web research row first (status sentence, Test, switch) with its key row beneath, then one row per added server (name, kind summary, last test, Test, Edit, Remove, switch). Editing and adding are inline forms, not drawers or cards. A new connector is saved off; a secret is shown only as "configured" with a four-character hint and is replaced by typing a new value. The section never shows per-member grants; those stay in the member's Permissions.
- Vault is a Key row saying where the key is held, then one divider row per item (label, kind · masked hint, a ghost Remove), an empty line when there is nothing, and ghost "Add login / card / personal details" buttons that open one inline form (label plus the kind's fields, secrets as password inputs). Never a "show value" control, never the value after it is saved.
- Updates report a successful repository check, its time, or an actionable failure. Never call an unknown or failed check up to date. Upgrade downloads and verifies the native installer, opens it, and explains that the user finishes installation and reopens the app.
- The Usage page's ledger is three plain tables under the existing cards: By member, By model, By day, divider-separated, right-aligned tabular numbers, Steps shown as "—" until a harness reports them. One sentence when nothing was recorded in the window; no cards, no charts for the ledger.
- Settings carries a System section: five count rows (Members, Channels, Threads, Messages, Memory entries) as label-and-value divider rows, a Data folder row with the path in mono plus Copy path and a platform-named reveal action, and one switch row "Check for updates automatically". Counts come from the bridge; the section never echoes environment or version details already shown elsewhere.
- A verified newer release appears directly above the account footer with a Download action, progress, and an actionable failure. Keep manual Check for upgrades in the native app menu, About, and Settings; do not add a permanent account-menu item. About opens a separate, reusable native window; Policies, Changelog, and Third-party licenses open their own readable document windows. Build identity distinguishes source commit, local changes, and the actual installed desktop executable SHA-256.

## Squad Channels

- Damaged saved channel history must explain the recovery action and preserve the file; never disguise it as an empty workspace or expose a raw JSON parser error.
- Agent-created purpose prompts show the originating member's name and avatar, including after restart; their prompt role must not make them appear authored by the human.

- Channels live inside the primary Squad sidebar as a collapsible category under the main navigation, not as a second navigation sidebar.
- The expanded channel category shows channel rows inline with the rest of the sidebar and exposes channel creation from the same area.
- Channel detail pages should use the main canvas for the active channel, member controls, threads, and composer; avoid adding another left rail or boxed dashboard around channel navigation.
- Channel creation and member assignment should stay reachable from both the sidebar category and an empty channel state.
- Channel creation closes and navigates only after the bridge saves it. Failed mutations retain input and show an actionable inline error; duplicate submissions cannot create a second channel.
- Channel name, visibility and sidebar section are a compact form in the existing settings popover, with one Save channel action and retained failed edits.
- The responder is one more row of that form: a Responder select (Everyone, Lead, Auto), a member select limited to the roster when Lead or Auto is chosen, and one muted sentence underneath that explains the mode, says "The lead is no longer in this channel, so everyone answers" when the lead left, or "Auto is unavailable with this provider…" when the bridge cannot call the provider directly. No switches, badges or boxes; it saves with the same Save channel action.
- A thread whose recipients were chosen by a mode shows one muted text tag in the thread meta row beside the target label: "Answered by Noah (auto · 80%)", "Answered by Iris (lead)", "Everyone answered (auto fell back: timeout)". Everyone mode shows nothing, so existing threads look the same.
- The composer hint names the mode when nothing is mentioned: "Target: lead (Iris)" or "Target: auto"; mentions still show the mentioned handles.
- Agent channel proposals are plain divider-separated approval rows showing the proposing member, channel purpose and recipients. Approve/Decline wait for bridge confirmation, show failed decisions inline, and remain in Needs you until resolved.
- Saved thread metadata remains visible when its messages are missing. Show the stored title and recorded reply count with a plain missing-content explanation; never invent a member reply.
- Channel composers should match the normal chat mention autocomplete behavior for `@here` and member handles, including keyboard selection. Channel loading placeholders should say the member is typing rather than thinking.
- A Canvas tab sits beside the stream as an underlined text tab (Messages | Canvas in the channel header; the member chat reaches the same view from a header icon). The canvas is title, editor, and a 224px revision rail separated by one divider; member edits are a bold rail row with a dot, and the diff colours only the changed lines (soft green / soft rose), never the page. `@canvas:slug` in either composer attaches the canvas to the message.
- Workflows live in the channel settings popover as a divider list (name, trigger summary, enabled switch) with a right-side drawer editor; a run appears in the stream as ordinary member messages carrying a small workflow tag, and an approval gate is one divider row with Approve, Decline and the emoji hint — no banners, no cards.
- Media in a channel message is inline: images at most 320px tall, videos with native controls and a slim one-line scrubber underneath; anchors are small outlined text badges ("0:12 · region"), never pins or cards. Anchor mode is a thin accent ring on the media plus inline Cancel / Use anchor text buttons; a pending anchor or attachment is one outlined chip above the composer.

## Typography

- The product typefaces are **Autohand Sans** for UI and **Autohand Mono** for code, both shipped from `public/fonts` (no font CDN; the desktop app works offline). Tokens: `--font-ui` and `--font-code`; do not reference another family directly.
- Autohand Sans is the variable font (weights 400–700, width 75–100%); Autohand Mono ships Regular, Medium, and SemiBold, with 700 mapped to SemiBold. Licences and provenance live in `public/fonts/ATTRIBUTION.md`.

## Harness Identity And Desktop Shell

- Treat a member's personality, execution harness, model, and permission level as separate choices. Changing between Autohand Code, Codex, and Claude Code must not rewrite the member's brain card.
- Warm, resumed, and agent-only turns retain the saved role, personality, harness and permission choices. Runtime skill summaries name installed selected skills and explain unavailable ones; removing a skill removes it from discovery while preserving its authored files for restoration.
- Add harness selection as one concise **Runs with** field during member creation and a dedicated Harness section on the member profile. Prefer a restrained list/select and inline readiness text over large vendor cards.
- Show harness readiness as plain states such as Ready, Setup required, Not detected, or Unsupported version, with one direct setup action. Never silently fall back to a different harness when the assigned harness is unavailable.
- Keep harness identity visible but quiet in member metadata, launch preflight, active work, evidence, and handoffs. Do not add another row of boxed metrics or colorful status panels.
- The installable desktop product should open and focus its own native app window. Tray/menu actions should focus or route that window; browser opening remains a developer/headless fallback rather than the primary installed experience.
- The desktop window uses the overlay title bar: the page extends under the traffic lights and the sidebar carries the inset (`html[data-shell="desktop"]`), so the vibrancy layer, never another app's window, shows through the top strip.
- Every sidebar variant, including member profiles and collapsed rails, owns the same desktop traffic-light inset exactly once. The logo uses the same brand size and header spacing across routes; profile navigation must not move it into the native controls.
- The desktop app owns a native menu bar (File › New › Agent / Channel, Edit, View › Needs you / Agents / Channels / Search / Toggle Sidebar, Window). Menu items dispatch one `autohand-squad:menu` DOM event (`src/lib/desktop-menu.js`); the web app maps actions to its existing navigation, so menus never encode routes.
- The tray menu opens with a compact, quiet status block (disabled lines): "Signed in as …", the plan name, one gauge line per metered usage window ("5 h  ▰▰▱▱▱▱▱▱▱▱   2% · resets in 4h 52m"), and the squad line while services run. Then the actions: Open, Needs you, Members ▸, Refresh usage; Sign out / Sign in… (never both), Check for updates…, Launch at Login; Start / Stop / Restart services, Open logs folder, Settings…, Report a bug, Give feedback, About; Quit. Labels are short verbs; the tray icon already names the app.
- Sign-in state in the tray follows the account the bridge reports (Squad session or the Autohand CLI session), never only the daemon's in-memory account.
- On macOS, Members in the menu bar opens one reusable 380×520 Quick Chat popover beside the status-bar icon, without a separate title bar. Window → Quick chat and ⌘⇧K reach the same popover. One horizontal portrait carousel shows true presence dots and the selected member's quiet name/role/status line; arrow controls appear only when it overflows, with drag, horizontal scrolling, and keyboard selection. Conversation and one restrained shadcn InputGroup composer follow, with an Enter hint and Send/Stop; no dropdown, second identity header, portrait grid, harness/settings toolbar, or workspace controls. Switching members preserves drafts and the main app route. Escape or outside focus dismisses it without stopping work. Quick Chat waits with one connection line, never the main startup checklist.
- macOS notifications belong to the installed Squad app, with explicit permission controls and a real OS submission result. Keep queueing, OS acceptance, and visible banner display distinct; Focus mode and the user's system settings control display. Clicking opens the originating local conversation or attention view.
- The account footer and menu show the signed-in Autohand account (name, email, initials or avatar) reported by the bridge; never a hardcoded person or plan. "Sign out" is real: it clears the session shared with the Autohand CLI and returns to the sign-in gate.
- Account menus use the shared portaled dropdown primitive, above the sidebar and chat layers in every skin. Keep them within the window, inherit the skin’s surface tokens, and support pointer selection, arrow keys, Enter, and Escape with focus returned to the gear.
- Bug reports and feedback live in the account menu, not in a floating button; nothing may float over the composer's send control.
- Needs you: "Mark updates read" clears unread direct messages and channels. Unresolved approvals, handoffs, memory proposals, and blocked work stay visible and counted until resolved; reading never decides them.
- Native startup and recovery states should use the same calm app surface: concise progress, an actionable error, Restart Service, and Open Logs. Do not leave users in a blank webview or redirect them to a raw local server page.

## Squad

- **Squad** is the roster: who is on the team and every control that changes it. **Needs you** holds human decisions, unread updates, and the squad work log. Neither page repeats the other's content.
- It uses the Work page's grammar exactly: an 896px column, an 18px title with one sentence naming only what is true now, one divider control row of text toggles, then divider rows of people. No state box, no segmented bar, no column header, no second layout below a breakpoint.
- A member row carries the name, the role, the one line naming the current commitment, then a dot-and-word availability control with the workspace beside it. Row actions appear on hover.
- The surface is called Squad in the sidebar and in the heading. The create button says "New member", so the word is not said three times in one view.

## Workspace Shell (Buzz-style)

- Presence dots have five states: accent and breathing while working, green online, amber idle, grey offline, and a dotted ring when the bridge is unreachable. Only working animates. Stop sits with the chat header actions and on the profile, confirming in a small popover.
- The primary sidebar is a Slack-like workspace rail: a **Search everything** control (⌘K / Ctrl K), Needs you, Squad, channel sections grouped by the channel's `section` (default "Channels"), then **Direct messages** listing members with presence dots and unread counts, and the account footer. No cards, no tinted panels; unread state is a bold row plus a small dot or count.
- Channel pages are flat, chronological streams: a `# name` header with member count and a settings popover, day separators, a red **New** divider at the last-read boundary, author + time, mention chips for targeted members, emoji reactions with counts, and quick actions on hover. Thread replies render inline under their root with a subtle indent instead of a stacked thread block.
- The composer is one calm bordered field with @ / attach / emoji / format on the left and a round send button on the right; Enter sends, Shift+Enter breaks a line, and `@` opens a keyboard-navigable mention picker.
- Presence is one living line under the composer, not placeholder rows: stacked avatars, then "Iris is thinking…", "Iris and Noah are typing…", "Iris, Noah and 2 others are running tools…", with three breathing dots. A reply enters the stream only once it has text. The line renders nothing when nobody is active and never shifts layout.
- Squad recruiting notices ("Kai wants to join #client-abc — DevOps engineer. Kai can help with the Dockerfile and CI in api; nobody in the channel covers that yet.") sit above the composer as a divider-separated row with Add and Not now. They are visible to the user only, never sent to members, and never counted as unread.
- Needs you is the single destination for decisions, updates, and work. Its default filter orders approvals, handoffs, blocked or failed work, memory proposals, unread replies, and unread channels; show only populated groups. Each row names its action and opens the surface owning it.
- Search results are grouped by type under a quiet filter row (toggle chips, no pills); rows are icon + title + muted snippet with the hit in semibold, no highlight colour; ↑/↓/Enter navigate; an empty query lists recent searches.
- A bell beside the search control carries a small dot while notifications are unread; its popover is a divider list (title, one-line body, relative time) with Mark all read. Native notifications are posted by the bridge, never while the conversation is on screen.
- Providers in Settings are a divider-separated list, expanded one at a time. An account-backed provider (Autohand AI) shows its status as one sentence ("Signed in as …; an API key is optional"), a model select fed by the catalog, and a managed base URL placeholder; it never asks for a key it does not need.
- The **Runs with** control is one select plus one readiness sentence; advanced fields (model override, executable path, Test harness) sit behind a text disclosure. The profile shows Harness as a text summary row beside Model, never as vendor cards.

## Needs you

- **Needs you** combines the former Inbox and Work into one sidebar destination. Its badge counts unresolved decisions, unique blocked or failed work records, permission warnings, and unread conversations; it is not a total-task counter.
- Use one column and three underlined text filters: **Needs you**, **In progress**, **All work**. Start with Needs you, preserve the chosen filter, and let explicit task/run links open their record even when the saved filter would hide it.
- The page lives at `/work`; old `/inbox` and `/mission-control` links remain valid. Search retains Inbox, Work, and Mission Control as aliases.
- A pending vault request (secure form or payment) is a "Vault requests" decision section above handoffs; its row opens the member's chat where the form or decision row lives. It counts in the badge and only resolving it removes it.
- A pending handoff is one decision row, not a second work row in the same filter. Keep record evidence, replay, recipe launch, runtime recovery, and evaluation filters available in the combined surface.
- Delegated QA/review retains its original task, request and workspace. Keep the parent active until its handoffs resolve; return the reviewed result to the initiating conversation and completed ownership to the origin. Partial text, a stopped recipient or a failed review cannot be presented as completed work.
- After restart, accepted browser-owned handoffs from the previous bridge process show a blocked checkpoint with saved context and interruption evidence. Restore their history without silently dispatching another request; preserve current-process work, pending decisions and completed records.
- It opens with the page title and one sentence naming only what is true right now ("2 working · 3 blocked"), never a row of metric tiles. A quiet squad reads as quiet rather than as four zeroes.
- Members and work records are both divider rows in one column, with the same grammar: what it is, one line of detail, then a dot-and-word status with the workspace and any marks beside it. No card grid, no five-column table, no tinted status chips.
- Record details open only after a record is selected; evaluation counts describe the current work filter. A selected record is marked with a quiet left border, never a filled background, because a tinted block on one row of a divider list is the only thing that reads as a card.
- Filters are text toggles on a divider row, underlined when active. They are one choice with several values, not several buttons.
- Status meanings are documentation and do not live on the page.
- The page uses the repo's own tokens. It used to hard-code a light palette and force it in dark mode, so the whole surface rendered white inside a dark app.

- The desktop window has no title bar of its own, so the shell reserves a band at the top for the traffic lights and renders one empty fixed strip that owns the window drag. Headers add to that area by declaring themselves deep drag regions, which drag from anywhere inside them while their own buttons keep working. It is the only drag region in the app: dragging delegated to page headers only works on the slivers between their children, and disappears entirely on a page that renders no such header.

- The setup guide is onboarding, not an account action. It lives in Settings as its own section and can be run again at any time; it is not in the account menu beside Sign out.
- In the desktop shell the webview's own context menu is suppressed, because Back and Reload are browser actions in something that is not a browser. Text fields keep theirs, since cut, copy and paste are the reason anyone right-clicks in one.
- Green means state and nothing else: online, working, passed, the active share of the team. The primary action is neutral, near-white on dark and near-black on light, so a colour carries one meaning. This applies to the Autohand presets; the presets that imitate other products keep their own accent.
- A disabled primary button must come from the shared button primitive, which drops it to a neutral surface. A button that hard-codes its own accent colours keeps the fill when disabled and still reads as the page's call to action.

## Agent Chat

- Actual reported plan items form a quiet inline checklist while work runs. Cross out only explicitly completed items; tool activity does not invent a plan or imply completion. Final updates state the outcome and remaining work concisely.
- `/goal <objective>` pursues a durable goal using the member's selected harness. Show state, turn and time limits, and Pause, Resume, Cancel. Navigation does not stop the worker; restarting pauses it until an explicit resume. A normal harness exit alone cannot mark a goal complete.
- `/break` pauses ongoing work and declines new requests and handoffs in the member's voice. `/break off` makes the member available; it does not silently resume a goal. Resolve mentioned identities before deciding whether they can accept work.
- The sign-in gate carries the actual Squad logo and fills the desktop viewport, including its drag area. Device authorization must identify the requesting product as Squad through the shared stored identity contract.
- The header is one row: avatar and name share one keyboard-accessible trigger for a compact anchored profile popover (name, role, live status, purpose, workspace, model, harness, and View profile), role, and a meta line with a live status dot (Online / Working), workspace, model, and a **Runs with** chip that opens the engine switcher. Actions on the right are **New chat** plus icon buttons for automation, tasks, and runs.
- The meta line adds `Context 42%` after the model when the bridge knows the tokens of the member's last request and the model's window; at 85% and above the figure turns amber and one quiet amber line above the composer says so. Unknown usage or an unknown window shows nothing, never a guess.
- Messages sit in a 48rem column. User messages are quiet right-aligned bubbles (muted background, no border) with the time on hover. Member messages are avatar + name + time + a small live indicator while working; the answer is prose at 15px/1.75. No badges, no cards.
- While working, one line shows the current stage with a small spinner. Work details are a text disclosure with a summary (steps · tools · duration); raw diagnostic output stays behind the chat setting.
- Elapsed time uses human units: `1 min 35 sec`, then `1 hour 35 min` for longer work. A terminal reply stops its timer and working indicator immediately. A timeout states whether it stopped for silence or the maximum runtime and offers Retry. If final diagnostics exceed the shared-message limit, keep the received activity and explain that final work details were limited.
- Work details is a semantic activity feed: one divider row per action that updates in place, reads folded into a "read 12 files" row, edits and shell commands in mono, failures in the destructive colour with their detail open, and a text Raw toggle for the unprocessed trace. The Execution panel's run output uses the same feed.
- A failed answer is an inline destructive note with the cause, a **Retry** button, and a sign-in hint when the cause is authentication.
- The composer is one rounded bordered field over a soft gradient; workspace, settings, and terminal sit left, queue and the round send/stop button right. Enter sends, Shift+Enter breaks a line, `@` mentions members.
- Dictation is one ghost mic button in the composer's action row, after the other left-hand controls and before send. While listening it becomes a small filled stop square in the accent colour with a pulsing dot and "Listening…" beside it; a problem is one muted or destructive sentence in the same place, never a dialog. In the desktop shell the same button explains the Mac's own dictation instead of listening.
- Read aloud is a ghost speaker icon at the end of a reply's meta line, visible on hover or focus and always while that reply is speaking (then a small accent stop square). Channel replies carry it in the hover action bar. The per-member switch is a divider row on the profile; the ElevenLabs key is a Settings → Voice row that only ever shows a four-character hint.
- The empty state introduces the member ("Hi, I'm Eva.") with role and description, then a divider list of suggested asks.
- Each member chat has one workspace picker showing its active working folder. Selecting an assigned folder or choosing another folder saves that member’s primary workspace immediately. Keep the full path visible in the picker; show assigned folders, rather than the machine’s entire repository inventory, and do not expose a separate Add workspace control.
- A member with no usable photo shows a neutral generic profile icon, including the native menu; do not leave a blank image slot or substitute an initial.
- Member avatars are the bird portrait set under `public/avatars/birds`: square, soft 3D, lilac gradient background, one role hint per bird. Role portraits are legacy; do not add new ones.
- The composer's picker is one quiet popover for `@`, `/`, and `$`: icon, token, and a muted detail column; the selected row uses the accent background. Presence on member rows is a small dot (green online, primary pulsing while working, muted idle).
- Terminal output and app notes (from `!` and `/`) render as ordinary member rows authored by "Terminal" or "Squad", never as system banners.
- A member's secure request is one divider row above the canvas: "Eva asks for GitHub login · Login", the reason, one line saying the value goes to the vault, then the kind's fields (password inputs for secrets) with Save to vault and a ghost Decline. A payment request is one divider row with "Eva wants to pay 19.99 USD to Fastmail · fastmail.com", the card it would use (a plain select when there is more than one), and Decline / I'll pay myself / Approve, Approve outlined. Both follow the channel-proposal grammar: no banner, no card, decisions wait for the bridge and show failures inline.
- Previous chats are a History icon button right after **New chat** in the chat header. It opens a popover with a one-line explanation and a divider list, one row per chat: the first question, then a muted line with turns, engine and when. The row opens the chat; a quiet trash icon removes it. No cards, no preview pane, no search. While the member is answering the rows are disabled and one muted line says why.
- The composer settings popover speaks each engine's language. For Claude Code and Codex members the Policy select becomes **Access** with that engine's three levels and one muted line saying what the chosen level allows, the model box is a select (engine default, the engine's own models, Custom… revealing a text field) and **Reasoning effort** appears only when the engine reports levels. Autohand members keep Policy and the free-text model. Same fields, same order, under Advanced in the member's engine settings.
- Reasoning effort is one slider with the level name at the right and a quiet reset: stops are Engine default then the engine's levels; the thumb, the filled range and the active stop move with short eased transitions and the name fades up on change. Never a drop-down.
- Reply lists: the marker (dot or number) sits in a fixed 1.25rem column beside the text, rows 0.375rem apart; nested items indent by level.
- Needs you has a **Folder access** section (amber folder icon, "Alex needs /path", "Allow or decline"); the row opens the member chat where the decision lives.
- A folder request is a quiet block under the reply that was refused: one sentence naming the member, one muted line, then one divider row per folder with the path in mono, a small **Allow and continue** and a ghost **Not now**. No dialog, no banner, nothing in the sidebar.
- A run row in the Execution panel names its engine and says "chat reply" when it came from a conversation; launched runs and replies share one list and one feed.
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
- The desktop start-up screen is the native page Tauri serves while the Rust bootstrap runs, and it is built to match the React screen that follows so the handover costs no visible movement: same background, same 56px mark, same column, same typeface, which ships beside it. Its check rows do not animate, because nothing reports their state yet and a row that ticked would be inventing a fact. The wait says how long it has been and when it stops, after a gate long enough that a normal start never shows it.
- The window is never blank: an inline boot screen paints the mark and one line before the bundle parses, then real start-up checks replace it, with member avatars settling in as the squad is read. No progress bars, because a bar that measures nothing is a lie told smoothly.

- A member picks up a tool the work kept failing without, and adds a line to its own escalation rules when a run of work goes badly. Both are announced in its own conversation, never applied silently.

- A new member's first message is the member saying what it will do: what it is, where it works, what it is set up for, and when it will stop and ask. Composed from its own configuration, never asked of a model, so every sentence can be checked against the profile beside it.

## Member Profile

- History is a divider list grouped by day with underlined text filters (All / Messages / Runs / Edits / Shell / Handoffs / Approvals), a ghost Load more, and one outline Export button. Rows are icon + sentence + a muted meta line (kind · time · links); failures use the destructive colour on the text only. No cards, no badges.

- **Runs on** sits under Runs with as two divider rows (This machine / Remote bridge) with a check mark on the chosen one; URL, name, and token fields, a Test button, and one status sentence. Share this machine is a text disclosure that shows a minted token once with a copy button. Failures name the remote. A remote member reads "/ on Studio" in the profile summary and a reply that came back over the proxy ends its work-details meta with "via Studio"; the directory shows nothing, since the transport is a detail, not a badge.

- Relay is a divider-row section: URL, Token, Workspace, one Save, the enable switch, a one-sentence status and a ghost Sync now.

## Maintenance

- When a durable user UI preference emerges, update this file in the same change so future UI work reflects it.

- Idle project observation delivers concrete, evidence-backed suggestions in the member’s ordinary DM. Keep its on/off control in Self-improvement; report paused, unsupported, and failed checks honestly. A suggestion is not completed work.
- The macOS Dock badge uses the same unresolved attention count as Needs you and clears at zero or sign-out. Compact chats cannot overwrite that count.
- Computer Use is a member capability in Permissions, with separate observe/control access and explicit native confirmation. Screenshots and action annotations belong with the work as ordinary evidence attachments.

- Computer Use setup is an explicit action; macOS Accessibility and Screen Recording permission do not grant a member access. Recover evidence by its exact work session and keep another member’s screenshots out of the conversation.

- Squad’s Computer Use permission host has its own product identity and System Settings entry. It must not share permission identity with another Autohand product whose signer or lifecycle differs.

- A handoff retry executes the saved receiving checkpoint explicitly; retain completed source work, attempt history and final result return. Busy recipients decline without hidden queueing. Every @mention dispatches immediately; ordered delegation mentions only the next recipient.

- The Automations editor's Schedule section is a divider list of label-and-control rows (Repeat, the kind's own fields, Time zone, Run limit, Next). The next three dates come from the bridge and read as plain text lines; no calendar widget, no card.
- A scheduled automation's row carries one quiet meta line: a status dot, last run and outcome, next run, and "Needs Squad open" in amber when the bridge cannot run it alone. The detail page lists recorded occurrences (including skipped and missed) as divider rows.
- A schedule proposal from chat is a divider section at the top of the member's chat: who proposes what, the rule in words with its time zone, the next three dates as small text, then Decline and Confirm. No card frame, no tinted fill; nothing is scheduled until Confirm.
