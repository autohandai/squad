# Changelog

All notable changes to Autohand Squad. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
SemVer. Nightly builds publish the **Unreleased** section as-is; a stable
release moves it under a version heading.

Release notes on GitHub add a download table and the categorised pull-request
list to the section for that version.

## [Unreleased]

### Added

- A control plane for MCP clients. `squad mcp` (or `bun run mcp` from a checkout) runs a stdio MCP server that Claude Desktop, Cursor or any MCP client can register to list members and channels, read channel threads, search, create channels, post to a channel, send work to a member and wait for the reply, and stop it. It talks only to the local bridge, never exposes approvals, deletion, credentials or computers, and replaces anything that looks like a key or token in replies with `[redacted]`. Members and their models are still created and changed in the app; those two tools say so instead of pretending. See `docs/integration/control-plane.md`.
- A mic button in the member chat, quick chat and channel composers. Speak and the words appear in the field as they are recognised; review them and press Enter when you are ready. Nothing is sent on its own. Browsers that can recognise speech on the device are asked to, so audio stays on the computer. In the desktop app the button explains how to use the Mac's own dictation (the Dictation key, or Fn twice), which types into the same field.
- Read a member's reply aloud with the speaker control on the reply, or turn on "Read replies aloud" in the member's profile so each new reply is read as it lands. Code blocks, file paths, links and tables are summarised instead of spelled out. Replies use the voices built into the computer, or an ElevenLabs voice when a key is added in Settings → Voice; the key stays with the local bridge and is never shown to the browser.
- Remote access over Telegram. Settings → Remote access takes a bot token from @BotFather, shows "Polling as @bot", and pairs exactly one Telegram account with a single-use code or an Open in Telegram link. From the phone, `/members` picks a member, a plain message runs it on this machine with one live status message and the reply formatted for Telegram, `/new` starts a fresh conversation, `/stop` interrupts, `/channels`, `/status` and `/help` do what they say. The conversation also appears in that member's chat in the app. Handoffs, workflow approvals, channel proposals and failed runs always reach the phone with a link into the app, approvals and proposals with Approve/Decline buttons; finished runs follow the Long work / Everything / Off choice. The bridge polls Telegram outward; nothing is opened to the internet and the token never leaves this machine.
- Usage shows a ledger of the last 30 days by member, by model and by day: runs, input, output and total tokens, steps when the harness reported them, and time. The same tables appear whether the analytics service or the bridge answers.
- Settings has a System section with the number of members, channels, threads, messages and memory entries on this computer, the data folder with Copy path and Show in Finder, and a "Check for updates automatically" switch. Off, the app only looks for releases when you ask; manual checks still work everywhere.
- Channel responder rules. Channel settings gain a Responder row: Everyone (every member answers, as before), Lead (one chosen member answers messages that mention nobody and hands off by mentioning others), or Auto (a quick model call picks who answers; below 60% confidence the lead answers, or everyone). `@name` and `@here` always win. If the lead leaves the channel the row says so and everyone answers until you choose another. Auto needs a provider the bridge can call directly with an API key (OpenAI, OpenRouter, DeepSeek, Z.ai, NVIDIA, Cerebras, Ollama, or Autohand AI with an API key); otherwise the row says "Auto is unavailable with this provider" and the channel falls back the same way. Threads show "Answered by Noah (auto · 80%)" or "Answered by Iris (lead)". Member-opened channels apply the same rule to their purpose. One request per un-mentioned message in an Auto channel, none for mentioned ones (`bun run check:responders`).
- Settings has a Connectors section. Add an MCP server as a command or a URL, press Test to see the tools it offers, then turn it on; members whose MCP connectors permission is set to Allow get it on their next turn, whichever harness they run on. Keys and tokens stay on this machine and are never shown back.
- A built-in Web research connector gives members `web_search` and `web_fetch` through Firecrawl, with the source address in every result so replies can cite what they read. Paste a Firecrawl key, Test checks it, and the switch turns it on.
- Follow-ups you send while a member is busy now wait in a queue that lives on the bridge: they survive reopening the app, run one at a time in order, and you can edit, reorder, remove, pause and resume them above the composer (and in Quick Chat). Stop cancels the running follow-up and pauses the queue. After a restart the interrupted follow-up says so and the queue waits for you to resume it.
- The member chat meta line shows how full the model's context is ("Context 42%") when the harness reports it, with a quiet warning above the composer past 85%. Claude Code members show it today; Codex and Autohand members show nothing until their harness reports a window.
- Settings → Vault keeps logins, cards and personal details sealed on this computer, with the key held by the macOS Keychain (Windows DPAPI, Linux Secret Service, or a private key file outside the data folder). Each item is one row with Remove; there is no way to show a saved value.
- Members can list the vault (labels and masked hints such as “Visa ···· 4242”), ask you for a secret through a secure form in the chat whose values go straight to the vault, and ask you to approve a payment: Approve with a saved card, I'll pay myself, or Decline. Requests wait in the chat and in Needs you, notify like an approval, survive a restart, and the member hears only the outcome with the item's id and hint.
- `vault_fill` is present but refuses on this Mac with the reason: filling a value needs a member workstation, which arrives with lane L3.
- Every member has the same menu on its directory row, its sidebar row and the chat header: Pin, Mark unread, Duplicate, Share as preset…, Hide and Remove. Pinned members sort first; a hidden member moves to a collapsed Hidden group under the directory list and leaves the sidebar, and can be shown again from there. Mark unread puts the reply back in Needs you and the sidebar count exactly as a new reply would. Duplicate opens New member filled in with the member's role, personality, brain card, skills and engine, and the copy is prepared like any member.
- Share team… in the Squad directory saves one `.squad-team.json` file. The dialog lists what goes in, with a tick box per member and per skill: members (name, role title, instructions and brain card, look), skills (SKILL.md text only), channels (name, visibility, section, member names), workflows (saved paused) and, only when ticked, starter notes. Never credentials, conversations, permission grants, provider or model keys, folders or computers. Anything in the text that looks like a key or password is removed and listed afterwards.
- Import team… reads a team or preset file, shows what will be created and what was dropped, and then adds it: members start on the Ask level with their skills switched off, channels get a number when the name is taken, workflows arrive paused. A file that is too large, malformed or carries fields a team file has no place for is refused with a sentence. If a workflow cannot be kept, the bridge removes the channels it just made and says so.
- Presets: every member in an imported team file, and any member shared with Share as preset…, appears under Imported presets at the top of New member's role list.
- Member automations now have a real schedule: once, weekdays, every N minutes, monthly (any day or the last day), yearly, or a custom cron expression, each in a chosen time zone. The editor shows the next three dates, and scheduled runs start on the bridge even while Squad is closed, as long as the member has chatted or run before and has a working folder; otherwise the automation says it needs Squad open and runs when you return.
- Each scheduled automation keeps a run history on the bridge: last run and outcome, next run, occurrences skipped because the previous run was still going, and runs stopped by an optional run limit.
- Ask a member in chat to schedule something and it proposes a routine; the chat shows the rule in words, the time zone and the next three dates with Confirm and Decline. Nothing is scheduled until you confirm.
- Previous chats. New chat puts the conversation away instead of discarding it. The History button beside New chat lists them, newest first, with the first question, the number of turns, the engine and when; open one and it comes back as the live conversation, and a Claude Code or Codex member continues the very same engine session. Remove deletes one. Up to 100 chats per member are kept on this computer.
- Every reply shows up in the Execution panel's Runs tab, whichever engine the member runs on: the question as the title, the engine, the model, the status, and the same activity feed as Work details. Stop there stops the reply. Goal turns, queued follow-ups, scheduled routines and Telegram messages appear the same way.
- Finished runs stay in the Runs tab after Squad restarts (the newest 200).
- Claude Code and Codex members get real controls in the composer settings: Access (Plan only / Accept edits / Full access for Claude Code; Read only / Workspace write / Full access for Codex), a model list read from the installed engine (Claude Code's fable, opus, sonnet, haiku and cached models; your Codex default), Custom… for a typed name, and Reasoning effort when the engine has one. Choosing Auto switches a plan-mode member to Accept edits. The same three fields under Advanced in the member's engine settings set the defaults.

### Fixed

- The app no longer opens to "Autohand Squad could not render — Cannot access uninitialized variable" after the routines update; a value was read before it was set up. The build is now opened in a browser as part of the checks so this cannot pass unnoticed again.
- A Claude Code member whose permission level is Chat only no longer stays stuck in plan mode: the composer shows that it is in plan mode and lets you switch it off for a message, and "Auto" now really writes.
- New chat with a Claude Code or Codex member now really starts a new conversation. Before, the engine was resumed with its previous session id, so the "new" chat silently carried the old context.

## [0.1.6] - 2026-10-13

Local review candidate; GitHub publication is pending user confirmation.

### Changed

- Member chat has one workspace picker. It shows the active folder, lets you switch assigned folders or choose another folder directly, and remembers the choice when you reopen the chat.
- Claude Code and Codex chat replies continue while reporting progress, with a five-minute silence limit and a separate 45-minute maximum runtime. Channel replies use the same runtime ceiling.

### Fixed

- The account gear menu stays above chat content and remains clickable across skins, collapsed sidebars, and narrow windows. Keyboard navigation and Escape work too.
- Settings has a Back action that returns to the screen you opened it from and keeps your member-chat draft, even after changing sections or reloading Settings.
- Long replies show readable durations such as “1 hour 35 min”. Large work details no longer hide the final answer or timeout and leave its timer running; failures show their cause and Retry.
- Full channel history can use a compressed local cache when device storage is full, preserving messages and making room for new member drafts and saved teammates.
- Describing a GTM or APAC market leader no longer becomes a Data Engineer because the brief mentions a sales pipeline. Custom role titles can be corrected before creation.
- Larger channel histories can be saved without hitting the individual-request size limit. Damaged saved history explains the recovery step and remains preserved.
- Quick chat on macOS no longer scrolls its whole window out of view when a goal checklist has completed items; the goal controls stay pinned above the composer.
- A goal restored from the bridge after reopening lands where it happened in the conversation instead of becoming the newest message, so Needs you previews the latest reply.
- Channel history left with a stray closing brace by an earlier version now opens again on its own: the original file is kept beside the repaired one. Other damage still blocks saving with an explanation, and channel approvals and live updates keep working instead of disappearing until restart.
- Retry checkpoint and Retry on a returned handoff error now run the saved recipient and return its result, including after restart, without rerunning completed implementation or QA. Parallel mentions share one task; busy teammates decline additional handoffs with an explicit retry path.
- Portable archives include shared workflow and member-profile runtime modules, preventing missing-module failures.
- Interrupted handoffs show a blocked checkpoint after app/bridge restart, keeping their context and history instead of continuing to appear active.
- A teammate's delegated QA and review stay connected to the original task. The initiating conversation receives the awaited verdict, and the task stays active until its handoffs finish.
- New member saves wait for preparation, keep your draft and custom personality after failure or refresh, and recover a lost response without creating another teammate. Creating someone else during setup now finishes setup and drafts the first conversation.
- Damaged or unwritable member config explains the failure and preserves the saved personality instead of reporting successful preparation.
- Teammates keep their personality, purpose, tools, and chosen harness when warmed or reopened. Built-in role instructions reach the agent runtime directly; deselected skills stop being discoverable and can be restored without losing their files.
- Teammates can organise work into channels within their permissions. Approval requests survive restart, revoked permissions take effect before creation, and a saved purpose reaches its teammates without duplicate prompts on retry.
- Background runs use the same channel permissions and proposals as chat. Failed SDK runs show failure, Stop prevents late channel creation, and channel purposes show the teammate who opened them.
- Saved channel threads remain visible when their messages are unavailable on this device, with a clear explanation of the missing content.
- First-run setup keeps your chosen teammate and name after refresh. Invalid folders and unavailable prerequisites block Start; failed preparation explains the error and can be retried without losing your choices or creating another member.
- Creating channels works repeatedly from the sidebar. Failed saves retain the draft and explain how to retry; successful creation waits for persistence.
- Channel project folders and sidebar sections survive reloads. Concurrent changes use atomic writes, repeated submissions reuse the channel, and stale caches cannot revive a deleted channel.

### Added
- Channel proposals show the purpose and invited teammates with Approve and Decline controls. Failed decisions explain how to retry.
- Channel settings let you change the channel name, visibility, and sidebar section, with failed edits kept for retry.
- **Needs you in the Dock**: the macOS app icon shows the same attention count as the sidebar, clearing when there is nothing waiting.
- **Proactive project observation**: idle members check assigned folders and send concrete improvement suggestions with file evidence. Checks pause for active work and breaks, with daily review limits and an off switch in Self-improvement.
- Autohand providers that cannot authorize background model review continue with local TODO/FIXME checks, labeled with file and line evidence, without sending project code to a provider.
- **Built-in Computer Use**: a bundled engine and permission host let permitted members inspect and control apps, retaining screenshots and action annotations as work evidence.
- **Quick chat on macOS**: choose a teammate from the menu bar, or press ⌘⇧K, to open one small chat popover beside the status-bar icon. A horizontal avatar carousel with live presence and a simple message field keep it focused; switching members preserves drafts.
- **Native macOS notifications**: allow notifications for Squad, send a test, and open the relevant conversation from a notification.
- **About Squad**: a dedicated window with version, source commit, build details, and the installed app executable checksum, plus Policies, Changelog, and Third-party licenses windows.
- **Update available** appears above your account with Download when a newer release is available. Manual checks remain in the native menu, About, and Settings.
- **Task progress in DMs** shows the member's reported checklist as they work, crossing off completed items and giving a concise final update.
- **Goals across harnesses**: use `/goal <objective>` with Autohand Code, Codex, or Claude Code, and pause, resume, inspect, or cancel it without losing the goal when navigating.
- **Real breaks**: `/break` stops ongoing work and declines new requests and handoffs; `/break off` returns the member without automatically restarting a goal.
- **Product usage telemetry** records signed-in sessions, member creation and use, and feature actions through the shared PostHog setup.
- **Upgrade from Settings**: check our GitHub releases and open a verified installer for your computer, with clear download, failure, and installation states.
- **Member preview**: click a teammate’s name or photo in a DM to see their role, live status, and details in a small card, with a direct link to their profile.
- **Workflows in channels**: automations that trigger on a message, a
  reaction, a schedule, or a webhook, run their steps through squad members,
  and pause at approval gates you clear with a button or an emoji.
- **Git as a channel object**: bind a repository folder to a channel and its
  commits, pull requests, and CI results land in the stream as one-line rows.
  Members can open a pull request once their autonomy ladder allows it.
- **Canvases**: Markdown documents in a channel or a member chat that you and
  the members edit together. Every save is an attributed revision with a diff
  and Revert; mention `@canvas:<slug>` to hand one to a member.
- **Media with anchored comments**: images and video render inline in
  channels, and a comment can anchor to a region, a moment, or both. The
  member receives the path, the region, and an extracted frame.
- **Cross-surface search**: one index over messages, channels, members, runs,
  tasks, handoffs, canvases, and workflow runs, grouped by type, with recent
  searches and deep links that highlight the record in place.
- **Activity feed**: agent replies and run output now show a semantic feed of
  what happened (read, search, edit, shell, status) with a Raw toggle, in
  member chat, channel replies, and the Execution panel.
- **Notifications**: native alerts for finished and failed runs, waiting
  handoffs and approvals, and mentions, suppressed while that conversation is
  on screen. A bell beside search carries the unread feed.
- **Member history**: a durable per-member record of every run, reply, edit,
  shell command, handoff, and approval, filterable by kind and exportable.
- **Remote members**: run a member on another machine's bridge. Chat, streams,
  and runs are forwarded with a bearer token and replies stream back marked
  with the bridge that ran them.
- **Multi-user relay**: a relay you host yourself, so a team shares channels
  and messages. The sidebar gains a workspace switcher and Settings a Relay
  section.
- **Presence and stop**: live per-member state with a stop control.
- **Members that introduce themselves**: a new member's first message says
  what it is, where it works, what it is set up for, and when it will stop and
  ask, composed from its own configuration rather than asked of a model
  (ADR-0034).
- **Describe a member and the page fills itself in**: one sentence designs the
  whole member, with the wait naming how long it has been, when it will stop,
  and a Stop that leaves your sentence intact. The instructions and the brain
  card are editable behind a disclosure (ADR-0031, ADR-0035).
- **Members take breaks, brief you, and improve themselves**: a member can
  decline work in its own voice, opening its chat leads with what changed
  since your last visit, and a chief-of-staff pass proposes skills and rules
  it needs (ADR-0027, ADR-0028, ADR-0029).
- **Boot screen**: the window paints the mark and one line before the bundle
  parses, then real start-up checks replace it (ADR-0033).

### Changed
- **Needs you** combines Inbox and Work into one place, with Needs you, In progress, and All work filters. Decisions and blockers come first, followed by unread replies and channel updates.

### Fixed
- The status-bar menu says **About**. Members without a photo show a profile placeholder icon.
- Quick Chat no longer repeats the main startup checklist or full DM controls. Interrupted replies remove the old thinking placeholder and show one inline Retry state.
- Interrupted requests no longer keep spinning after a restart; their history and unfinished task states remain, with a clear retry message.
- The sign-in screen includes the Squad logo and fills the window without a lower gray bar. Account authorization identifies Squad through the shared device sign-in contract.
- Local Mac builds sign the complete app bundle so notification permission can recognize Squad.
- Failed update checks no longer claim the app is up to date. Installer selection matches your platform and verifies the release checksum; Windows runtime executables are excluded.
- Opening a member profile keeps the top-left logo below the window controls.
- The attention count includes waiting approvals; marking updates read clears DM and channel unread state while keeping unresolved decisions visible. Handoff reviews open the selected task.
- Route plug-ins could load twice on a cold bridge, which made every feature
  handle each event twice (duplicate notifications and audit rows).
- Tailwind only scanned four component directories, so styles used by newer
  features were never generated.
- The form-control font reset was unlayered and overrode every utility, so
  fonts and sizes never applied to inputs and textareas.
- A local `tauri build` bundled whatever runtime happened to be staged, so a
  desktop build could ship the previous release's server.
- CI's release dry run never fetched the vendored Autohand CLI and failed on
  every platform.
- Designing a member always timed out, so every custom role came back from the
  deterministic fallback with generic skills however good the description.
  The designer was waiting on MCP servers it cannot use; it now gets none, is
  warmed when the screen opens, and starts each draft with a clean
  conversation (ADR-0036).
- The draft asked a model for a brain-card field the app has no place for and
  never asked for three it does, so three of a designed member's seven fields
  were boilerplate.
- A new member introduced itself and then told you what *you* do, because the
  brain card is written to the member as "you" and was quoted verbatim.
- Designing a member was dead in the installed desktop app: the route imported
  a file the app does not ship, so the loader skipped it silently. A check now
  walks the bridge's import graph.
- The Work page (formerly Mission Control) forced a light palette in dark
  mode, so it rendered white inside a dark app.
- Skill installs and failures were filed as memory proposals needing a
  decision, which buried the Inbox under rows that needed none.
- The new-member page scrolled itself away from the answer, so the line saying
  whether a model or your description designed the member was never seen.
- A deleted member came back on the next launch. Deleting removed it from
  storage, and the seed list read "missing from storage" as "never seen" and
  added it again (ADR-0038).
- **Onboarding knows about git.** Picking a folder now says whether it is
  tracked and who commits there will be from. An untracked folder offers to
  start tracking, so nothing a teammate changes is unrecoverable (ADR-0050).
- **Replay actually replays.** Every action on a Work row was a link that
  added a query parameter and did nothing. Replay re-runs the failed work; the
  rest say where they go (ADR-0049).
- **A member remembers what it learns.** Memory entries were stringified on
  save, so a member proposed the same lesson every hour forever (ADR-0048).
- **The start-up screen wears the product.** The window you see while the app
  boots now carries the mark and the Autohand typeface on the same background
  as the app, so nothing flashes at the handover, and it says how long it has
  been waiting and when it gives up (ADR-0047).
- **Squad is the roster, Work is the log.** The Squad page spent more than
  half the first screen before showing a member; it now takes the Work page's
  layout, fits one screen, and reads the same at every width. The recent-task
  lines moved off it, because Work already owns them, and Work drops its
  duplicate roster in return (ADR-0045).
- Green now means state and nothing else. Buttons are neutral, so a colour on
  screen carries one meaning instead of three (ADR-0044).
- The setup guide moved out of the account menu into Settings, where you can
  run it again whenever you like (ADR-0043).
- Right-clicking no longer offers the webview's Back and Reload. Text fields
  keep their menu.
- The Save button on a new member is neutral while there is nothing to save,
  instead of a bright accent you cannot press.
- A tool permission you changed no longer snaps back. Opening a member's chat
  posted a warm-up that named the member but described nothing about it, and
  the bridge used that to rewrite the member's permissions with empty allow,
  ask and block lists. Editing the member's config.json by hand had the same
  fate, because that file is generated from the app's record (ADR-0041).
- The `skill`, `find_agent_skills` and `install_agent_skill` tools were
  blocked at every autonomy level, so no member could use a skill it had.
  Using and finding skills is now allowed, and installing one asks (ADR-0041).
- The window can be dragged from anywhere along the top band, on every page.
  Dragging used to depend on whichever header a page rendered, so it worked
  only on slivers and not at all on a member's Permissions page. Content also
  no longer starts under the traffic lights (ADR-0040).
- Skills you already have in `~/.autohand/skills`, `~/.claude/skills` or
  `~/.agents/skills`, and the same folders in your workspace, are now found
  and installed. They used to be invisible, so a member asking for one failed
  with "not found in Skilled catalog" (ADR-0039).

## [0.1.5] - 2026-09-24

### Added
- First run ends in a conversation: point at a folder, meet a teammate
  suggested from what the folder contains, and open the chat with the first
  message already drafted.
- Squad recruiting: when a channel's project needs a role nobody in it covers,
  that member asks to join. Only you see the request; Add or Not now. On by
  default (Settings → Chat → Squad suggestions).
- Folder profiles (`POST /api/workspaces/profile`): languages, frameworks,
  and needs detected from marker files and dependencies.

- Native desktop app (Tauri 2): system-webview window, menu bar (File › New ›
  Agent / Channel, View › Inbox / Agents / Channels / Mission Control), tray
  with account, plan usage gauges, members, and service controls.
- Installers for macOS (Apple Silicon and Intel), Windows x64, and Linux x64
  (Debian and AppImage), each bundling Node, the daemon, analytics, the
  `squad` CLI, and the pinned Autohand Code CLI.
- Nightly builds from `main` on the canary channel; Settings → Updates and the
  tray check GitHub Releases for the selected channel.
- Autohand account sign-in from the app (`squad login`), Codex OAuth and
  Claude Code sign-in from the member harness settings, real sign-out.
- Bird-of-Aotearoa member portraits, channel projects, native folder picker,
  member-to-member delegation, channels created by members.
- Composer syntax: `/` commands, `$` skills, `!` shell, `@` mentions with
  presence; queued follow-ups can steer a running reply.
- Warm Autohand Code sessions (follow-ups answer in seconds), OpenTelemetry
  log format for every runtime component.

### Changed

- Channel presence is one living line under the composer ("Iris, Noah and 2
  others are thinking…"); replies appear when they start instead of as
  placeholder rows.
- A member that keeps producing events is never cut off: the chat timeout is
  an inactivity window with a 45-minute ceiling.
- Autohand Sans and Autohand Mono ship with the app; no font CDN.
- Chat, channel, execution panel, and inbox surfaces redesigned; the inbox
  badge clears with "Mark all read".
- The device sign-in page names the product "Autohand Desktop".

### Fixed

- Fresh desktop installs no longer require the legacy tray binary.
- The desktop title bar no longer shows the window behind the app.
- Channel composer send button is no longer covered by the feedback button.

## [0.1.4] - 2026-08-31

- Release pipeline fixes for the Windows installer smoke test; runtime
  binaries, portable archives, and installer manifests for all four targets.

## [0.1.3] - 2026-08-31

- Upload macOS installer assets from the release workflow.

## [0.1.2] - 2026-08-31

- Installable desktop release pipeline with signed and notarised builds when
  credentials are present.

[Unreleased]: https://github.com/autohandai/squad/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/autohandai/squad/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/autohandai/squad/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/autohandai/squad/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/autohandai/squad/releases/tag/v0.1.2
