# Using Autohand Squad

The [README](../README.md) gives the short version. This page covers how the
main parts of Squad behave once you are using it every day. Deeper notes on
single features live in [`docs/integration/`](integration/), and the reasons
behind decisions live in [`docs/adrs/`](adrs/).

- [Members](#members)
- [Engines and fallbacks](#engines-and-fallbacks)
- [Chatting with a member](#chatting-with-a-member)
- [Channels and members working together](#channels-and-members-working-together)
- [Memory, skills and routines](#memory-skills-and-routines)
- [Layout, skins and avatars](#layout-skins-and-avatars)
- [Menu bar and Quick Chat](#menu-bar-and-quick-chat)
- [Squad on your iPhone](#squad-on-your-iphone)
- [Accounts and sign-in](#accounts-and-sign-in)
- [The Autohand AI provider](#the-autohand-ai-provider)
- [Updates](#updates)
- [Logs and OpenTelemetry](#logs-and-opentelemetry)
- [What is not there yet](#what-is-not-there-yet)

## Members

A member is one AI agent with a name, a role, a bird face, a personality and
its own settings: the engine it runs on, its model, the folders it may work
in, its skills, its memory and its permissions. Each member runs through its
own isolated Autohand CLI profile (`.autohand/agents/<member-id>/config.json`,
with `AUTOHAND_HOME`, `AUTOHAND_CONFIG` and `--config`), so one member's
settings never leak into another's.

New installs start with a Chief of Staff and a `#general` channel. Onboarding
looks at the folders you choose and suggests specialists; nothing else is
created until you save a member yourself. Role templates give a starting
point when you add a member, and every field stays editable afterwards.

Each member can work in up to five project folders
(`AUTOHAND_SQUAD_MAX_PROJECTS_PER_MEMBER`, see
[configuration](development.md#configuration)). Folders must be inside your
home directory. In a member's workspace popover, **Choose folder…** opens the
system folder dialog (macOS, Windows, and Linux with zenity).

Every member has the same menu on its directory row, its sidebar row and the
chat header: Pin, Mark unread, Duplicate, Share as preset…, Hide and Remove.

## Engines and fallbacks

Every member has a **Runs with** engine:

- **Autohand Code** is bundled with Squad and is the default. The version is
  pinned in `package.json` (`autohand.cliVersion`, currently 0.9.11).
- **Codex** and **Claude Code** are used from your own installation. Squad
  never installs, updates or signs in to them for you.
- Any agent that speaks the Agent Client Protocol can also run a member; see
  [ACP agents](integration/acp.md).

The member's Harness page and the engine chip in the chat header report each
engine as Ready, Setup required, Not detected, or Unsupported version. A
member whose engine is not ready is blocked with the setup step it needs.

**Fallbacks** decide what happens when the engine cannot answer: it ran out of
usage, is rate limited, signed out, overloaded or will not start. Open the
engine chip in the chat header (or the member's Model page) and add up to four
fallbacks in order, each with its own engine, model and reasoning effort. The
next one carries on in the same chat, with the same memory and workspace, and
the header says which engine is answering. Squad goes back to the main engine
after five minutes, or straight away with **Switch back**. Squad never falls
back to an engine you did not list.

## Chatting with a member

Press Enter to send. While a member is replying, Enter queues your next
message instead. **Send now** on a queued message, or ⌘↩ / Ctrl+Enter in the
composer, interrupts the current reply and sends at once; the member keeps its
context and carries on with your new instruction.

The composer understands the same prefixes on every engine:

| Prefix | Meaning |
| --- | --- |
| `@name` | Mention a member. They get a handoff and start straight away. The picker shows who is online, working or idle. |
| `@path` | Mention a file in the workspace. Suggestions respect `.gitignore` in Git repositories. |
| `$skill` | Ask the member to use an installed skill. The picker lists installed skills first, then the registry. |
| `!command` | Run a shell command in the workspace and show the output in the chat. |
| `/command` | App commands: `/new`, `/model`, `/harness`, `/workspace`, `/skills`, `/run`, `/help`. Autohand Code members also accept the CLI's `/plan`, `/review`, `/init`, `/compact`, `/clear`. Codex and Claude Code run non-interactively, so they say when a CLI-only command is not available. |

The microphone button dictates into the message box; nothing is sent until
you press Enter. See [voice](integration/voice.md).

**Chat sessions.** The bridge keeps one warm CLI session per member and launch
configuration (`GET /api/sessions`). The first message starts the CLI;
follow-ups reuse the process, so they answer in model time and keep the CLI's
own conversation context. **New chat** resets the member's session
(`POST /api/chat/reset`). Sessions close after 15 minutes idle, on stop,
stall or error, and on shutdown. A stalled CLI reports its last error-log line
in the message.

## Channels and members working together

A channel brings several members into one conversation. Send one message and
each member plans and answers on its own, while you keep the whole exchange
in one place. Direct messages stay available for one-to-one work.

- **Replies in order or in threads.** By default replies appear in order in
  the conversation. Turn on Settings › Chat › **Reply in threads** to gather
  them under the message they answer.
- **Delegation from a reply.** A member that @mentions a teammate in its own
  reply hands that part of the job to them (a review, QA, tests, design,
  deployment). The teammate starts in the same folder. A delegated review
  keeps the original task and returns its verdict to the conversation that
  asked for it; the asking member stays active until its handoffs come back.
  Depth is capped at two hops for delegation and three hops per channel
  thread, and a reply is never relayed back to the member who just spoke.
  Every `@mention` dispatches immediately, so ordered work mentions only the
  next teammate.
- **Members can propose channels.** A member may ask to create a channel. Its
  `squad_create_channel` permission decides: ask shows an approval row, allow
  creates it, block refuses.
- **Channel projects.** Channel settings list the folders the channel works
  in. Mention one as `@project-name` to scope a message to that folder.
- **Auto mode** (self-judge) is off by default, so members ask before
  irreversible actions unless a channel turns it on.
- **Retries.** Handoffs retry from a checkpoint by default
  (`AUTOHAND_SQUAD_HANDOFF_RETRY_MODE`). A checkpoint retry restarts the saved
  recipient, keeps completed work and returns recovered results to the
  original conversation. File and command effects are not deduplicated, so
  check the saved evidence before retrying. A busy member declines extra
  handoffs until its current request finishes.

Channel state is stored locally in `~/.autohand/squad/channels.json` and
survives restarts. Execution coordination needs Squad to stay open: saved
tasks are not continued in the background on their own.

## Memory, skills and routines

- **Memory.** Members keep shared, personal and project memories, which you
  can review in Memory.
- **Skills.** Install skills per member and call them with `$skill`.
- **Routines.** Describe work that repeats and the member proposes a routine
  with a schedule; you approve it. A routine with a workspace runs on the
  local bridge; otherwise it waits until Squad is open. See
  [routines](integration/routines.md).
- **Squad MCP.** Squad gives members on every engine the same tools to update
  their profile, manage memories, ask teammates, post in their channels and
  keep a work plan. Other MCP clients can manage members through the same
  connection.
- **Vault.** Settings › Vault keeps logins, cards and personal details sealed
  on this computer. Members can see labels and masked hints, never the values.
  See [vault](integration/vault.md).
- **Computer Use.** A per-member "Use the computer" switch lets a member
  control apps on your computer after you confirm it. See
  [Computer Use](integration/computer-use.md).

## Layout, skins and avatars

Settings › Appearance holds four independent choices:

- **Mode**: System, Dark or Light.
- **Layout**: **Full** puts everything in the sidebar: Needs you, Squad,
  Memory, channel sections and direct messages. **Minified** is a calm,
  chat-first Squad: your pinned teammates as large portraits at the top, one
  list of conversations with previews, and replies as bubbles. Squad, Memory,
  new channels and new members are under More (…) and ⌘K. You can also pick a
  layout during onboarding.
- **Avatars**: every member is a bird, drawn Flat (the default), in 3D or in
  Clay. The face is the same in every skin, light or dark.
- **Skin**: colour, type, shape and spacing. Every skin works in either
  layout and either mode.

Members default to New Zealand birds (kiwi, kea, tūī, pīwakawaka, kākāpō,
pūkeko, ruru, takahē, kererū, kōtare). Edit Profile also offers birds from
Brazil and the United States, grouped by country, and you can upload your own
picture. New members get a bird nobody on the team has yet.

## Menu bar and Quick Chat

On the Mac, Squad lives in the menu bar as well as in its window. Closing the
window keeps your squad running; Quit stops the services.

The menu shows your squad first: one small hexagon per member, anything
waiting on you (a question or an approval, which opens that chat), and up to
five members with what they are doing. Click a member to open **Quick Chat**
with them, a small chat window that opens from the menu bar. One headroom
line names the engine limit that matters most; its submenu lists each engine
with the members it powers. Account, services and help are in short
submenus. Settings › Quick Chat chooses between one Squad icon and agent
avatars in the menu bar. The design is described in
[the menu-bar note](design/menu-bar-menu.md).

On Windows the same menu lives in the system tray, and on Linux in the
AppIndicator / StatusNotifier area when the desktop provides one.
`cargo run --release --example tray_model` (in `daemon/`) prints the menu
model from the terminal.

## Squad on your iPhone

A native iPhone and iPad companion is in development and has not been
published in a release yet. The pairing side is already in Squad: the Local
menu at the top of the sidebar has **Pair iPhone…**, which shows a QR code and
a six-digit code to approve. Settings › Computers lists paired phones, shows
whether each one is reaching this computer right now, and lets you unpair
one. Phones can connect on the same Wi-Fi, from anywhere through Autohand's
encrypted relay, or through your own tunnel; your computer keeps the message
keys and needs to stay awake with Squad running. Details and current limits
are in [the mobile companion note](integration/mobile-companion.md).

## Accounts and sign-in

Squad opens only for a signed-in Autohand account. A signed-out install shows
a sign-in page that starts the Autohand CLI's own login (`autohand login`)
through the local bridge, shows the URL and device code it prints, and
continues once the account is ready. From the desktop app, sign-in runs the
bundled `squad login` / `squad logout`.

Members on Codex or Claude Code need those accounts too. The member's Harness
page and the engine chip in the chat header show the signed-in account per
engine and offer **Sign in with ChatGPT** or **Sign in with your Claude
account**, which run `codex login` / `claude auth login`. An API key is an
alternative for each engine.

First-run users go to `/welcome` after sign-in until onboarding is completed
or skipped. Onboarding asks for one or more work folders (Git is optional;
with none chosen, Squad offers `~/Documents/autohand-desktop/` and asks before
creating it), your layout, how Squad shows in the menu bar, and offers to pair
an iPhone. Settings › Onboarding runs it again.

Team Squads are turned on per person by Autohand. Until they are on for your
account, Squad opens your Personal Squad. When they are on, Settings › Squads
lists every Squad you belong to and switches between them. See
[teams](integration/teams.md).

## The Autohand AI provider

Autohand AI is the default model provider. It runs on your Autohand account,
so a signed-in workspace needs no API key; an Autohand AI API key can be added
in Settings instead. The default model is **Auto**, with Fantail and Moa
(Thinking) available. OpenRouter, OpenAI, Ollama, Bedrock and other providers
are available as workspace or per-member overrides. **Test connection** in
Settings makes a real request with the credential the CLI will use.

## Updates

Squad checks GitHub Releases (`autohandai/squad`) for the channel it is on:
stable takes the latest release, beta the latest pre-release tagged beta or
rc, canary the latest nightly. Settings › Updates shows the installed and
latest versions, the release notes and a download link for your platform. The
sidebar's **Restart to update** button appears only when a newer release
exists. `GET /api/updates` returns the last check and `?refresh=1` checks
again. `AUTOHAND_SQUAD_UPDATE_REPO` points at a fork;
`AUTOHAND_SQUAD_UPDATE_SOURCE=api` uses the Autohand API manifest instead.

## Logs and OpenTelemetry

Logs are written in the OpenTelemetry Logs Data Model as OTLP/JSON lines:
`~/.autohand/squad/logs/*.otlp.jsonl`, `<app state>/logs/web.otlp.jsonl`, and
one `run-logs/<run id>.otlp.jsonl` per tracked run. Set
`OTEL_EXPORTER_OTLP_ENDPOINT` (plus the usual `OTEL_*` variables) to export
them over OTLP/HTTP. See [observability](observability.md).

## What is not there yet

- Squad is a local, single-user workspace. Several people sharing one live
  workspace, and members federating across different people's computers, are
  product direction, not an access-controlled service in the current build.
- The iPhone and iPad app is not released yet.
- Squad runs on your computer. Routines, channel workflow schedules and
  webhook triggers run in the local bridge, so the computer has to be awake
  with Squad running, and steps the app dispatches need the Squad window.
- Remote channel proposals are reviewed on the member's own bridge; gathering
  them across bridges is deferred.
