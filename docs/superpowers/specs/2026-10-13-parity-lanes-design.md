# Parity lanes: features from xiryn, OpenMausBot and OpenBot on Squad

Date: 2026-10-13. Status: approved direction from the product owner ("build in
parallel lanes, no PRs, merge into main, delete the branch when done").

## What was compared

Four reference products were cloned at these commits and read, not run:

| Reference | Commit | Licence | Shape |
| --- | --- | --- | --- |
| [xiryn](https://github.com/SouravBeraAkaSpeed/xiryn) | 0.4.1 (2026-10-12) | MIT | One Next.js process + SQLite; one Docker desktop per agent; Telegram; vault. |
| [OpenMausBot](https://github.com/milind-soni/OpenMausBot) | `34cbd59` | Apache-2.0 | Harness server over claude/codex/grok CLIs; cloud desktop or local; Composio; voice; team sharing; MCP control plane. |
| [OpenBot (nightly-labs)](https://github.com/nightly-labs/openbot) | `6856250` | PolyForm Noncommercial 1.0 | Electron workspace over Codex/Claude/Grok/ACP; queues; embedded browser; A2A messages. **No code may be taken from it.** |
| [OpenBot (CopilotKit)](https://github.com/CopilotKit/OpenBot) | `6d86ba4` | MIT | AG-UI coworker platform; governed gateway; computers per coworker; reach via Slack/Teams/SMS. |

The earlier conversation named "openbot" without a URL; both projects with
that name are covered so nothing is missed. Reference code is read for
behaviour and edge cases only; Squad extends its own bridge, harness and state
seams (the standing decision in `docs/reports/squad-competitor-audit.md`).

## Already in Squad (no lane)

Role templates with brain cards and per-member harness/model; channels with
membership, proposals and approvals; delegation with returned results and
restart recovery; durable goals; per-member `MEMORY.md` plus a memory-proposal
inbox; workflows with message/reaction/schedule/webhook triggers and approval
gates; native notifications with per-kind settings; update check and upgrade;
command palette and search; skins; provider settings with tests and masked
secrets; permission ladder with tool policies; host Computer Use with evidence;
remote members and the multi-user relay; git as a channel object; canvases;
member history; loopback bind with an Origin guard.

## Lanes

Each lane is one branch `lane/<id>`, one worktree, one ADR number reserved
below, its own `scripts/check-<id>.mjs` wired into the `ci` chain, CHANGELOG
lines under `[Unreleased]`, and DESIGN.md lines for any durable UI rule.
New UI goes in new files under `src/components/<area>/`; `src/App.jsx` gets
imports and mount points only. New bridge code goes in
`server/routes/<id>.route.mjs` plus `server/<id>/` modules per
`docs/integration/CONTRACT.md`, with an integration note at
`docs/integration/<id>.md`.

### L1 voice (ADR-0087)

From: xiryn mic dictation; OpenMausBot on-device macOS dictation, replies read
aloud with built-in Mac voices or a cloud voice, per-member voice.
Scope: a mic button in the member, channel and quick-chat composers. In the
desktop shell, recognition is on-device through a Tauri command over the
macOS Speech framework (WKWebView does not expose the Web Speech API; verify
and record the result). In a plain browser, use `SpeechRecognition` when
present with the on-device preference. Interim text lands in the composer for
review; nothing is sent automatically. Read aloud: a speaker control on any
reply and a per-member "read replies as they land" switch, using
`speechSynthesis` built-in voices with markdown rewritten to a spoken
register (no code fences, paths, tables). Optional ElevenLabs key in Settings
with the key held by the bridge only. Out: calls, voice personas.

### L2 remote-access (ADR-0088)

From: xiryn Telegram bridge; CopilotKit "reach"; OpenMausBot phone pairing.
Scope: Settings → Remote access with a Telegram bot token, Connect, a QR and
pairing code, one paired owner, notify mode (long/all/off). The bridge
long-polls from the machine; commands `/members`, `/channels`, `/new`,
`/stop`, `/status`, `/help`; an inbound message starts a bridge-owned turn
for the chosen member and the reply (with progress edits) returns to the
chat; the turn must appear in that member's conversation in the app. Needs-you
events (handoff, approval, channel proposal) and long finished runs notify the
paired chat with a deep link and inline Approve/Decline where the event has a
decision. Unpaired senders get a refusal. Out: WhatsApp, Slack, Discord
(leave the sink interface ready for them).

### L3 workstations (ADR-0089)

From: xiryn Docker desktop per agent; OpenMausBot cloud desktop / Local VM;
both OpenBots give every coworker its own computer and browser.
Scope: a per-member "Runs on" choice: this Mac (today) or its own
workstation. A workstation is a Docker container built from
`workstation/` (Debian, Xvfb, xfwm4, Chromium with password saving off,
x11vnc + noVNC, xdotool, Node, Python, the vendored Autohand CLI), with the
member's assigned folders mounted and a named home volume. The member's
harness runs inside the container; host Computer Use tools map to the
container display. A Machine tab in the member chat shows the live desktop
(view, Take over, Hand back with a note that makes the member re-read the
screen), Docker status with Start, image build progress, CPU/memory limits,
auto-stop and auto-delete, Reset. A `request_takeover({reason})` tool ends
the turn with a Needs-you item and a notification. Out: cloud providers,
Windows containers, phone links (L12).

### L4 vault (ADR-0090)

From: xiryn vault and payment approvals; CopilotKit saved passwords and
write-only credentials.
Scope: Settings → Vault for logins, cards and personal details sealed with
AES-256-GCM under a key held by the OS keychain (macOS `security`, Windows
DPAPI, Linux secret-tool; a 0600 file fallback outside the data folder).
Members get `vault_list` (labels and masked hints only), `request_secret`
(a secure form in the chat whose values go straight to the vault),
`request_payment_approval` (merchant, amount, site; Approve with a saved
method / I'll pay myself / Decline, in the app and over L2). `vault_fill`
types a value only inside an L3 workstation browser after checking the page
site; on this Mac it is refused with the reason. Out: UPI, autofill on the
host.

### L5 usage-and-system (ADR-0091)

From: xiryn usage ledger and Settings → System.
Scope: `/api/analytics` breaks tokens, steps and duration down by member, by
model and by day; the Usage page shows those tables. Settings → System shows
counts of members, channels, threads, messages and memory entries, the data
folder, and the update-check switch. Out: cost estimates in currency.

### L6 teams-and-member-menus (ADR-0092)

From: OpenMausBot share/import team, presets, right-click bot menu.
Scope: a member row and chat header menu with Pin, Mark unread, Duplicate,
Hide and Remove (Remove keeps its confirm). Share team… writes one JSON file
with members (name, role, instructions, look), skills text, channels,
workflows (paused) and starter notes; the dialog shows what goes in; never
credentials, conversations, permissions, model keys or computers. Import
team reviews the file before creating anything; imported members start on
Ask with skills off. Presets appear in New member's role list. Out: an
organisation library, a hosted catalogue.

### L7 connectors (ADR-0093)

From: OpenMausBot bring-your-own MCP servers and Composio marketplace; xiryn
Firecrawl research with citations; CopilotKit connected accounts.
Scope: Settings → Connectors: add a stdio command or a URL MCP server, Test
(handshake, list tools), enable; a built-in Web research connector backed by
Firecrawl with its key held by the bridge, giving `web_search` and
`web_fetch` with cited sources to every harness through the existing managed
MCP seam. Member enablement sits under the existing `mcp.connectors`
permission. Out: OAuth app marketplace (leave a connector preset list ready
for it).

### L8 responders (ADR-0094)

From: OpenMausBot room responder rules and the decision model; nightly OpenBot
single task owner.
Scope: channel responder setting: Everyone (today's fan-out), Lead (one named
member answers un-mentioned messages), Auto (a bounded fast model call picks
the responder from the roster and the last lines; below 0.6 confidence the
lead answers). Explicit mentions always win. Out: a third-party decision
service.

### L9 control-plane (ADR-0095)

From: OpenMausBot's stdio MCP server for Claude Desktop/Cursor.
Scope: `squad mcp` (sidecar) exposing `list_members`, `list_channels`,
`get_messages`, `search`, `create_member`, `create_channel`,
`send_message`, `wait_for_reply` (settled / needs-you / failed / timed-out
with a redacted tail), `interrupt`, `set_model`. No approvals, deletion,
credentials or computer lifecycle. Out: remote (non-loopback) exposure.

### L10 routines (ADR-0096)

From: OpenMausBot routine schedules; CopilotKit responsibilities.
Scope: member Automations gain real schedules: weekdays, every N minutes,
monthly/yearly, custom cron with an IANA timezone, next three dates shown,
skip when the previous run is still active, optional run limit; asking a
member in chat to schedule something produces a confirmation card and
nothing runs until confirmed. Runs that need the app open say so. Out: a
second scheduler (reuse the workflows one).

### L11 queues (ADR-0097)

From: nightly OpenBot FIFO queues and context monitoring.
Scope: the follow-up queue above the composer becomes durable on the bridge:
pause, resume, reorder, cancel, survives restart; a per-member context gauge
from the harness's reported usage with a warning before the window fills.
Out: automatic compaction (harness-owned).

### L12 phone (ADR-0098)

From: OpenMausBot phone web app and pairing; xiryn phone take-over link.
Scope: pair a phone browser to this bridge over the relay or a Tailscale
address with a one-time code; a responsive layout for Needs you, member chat
and approvals; an L3 live-desktop link that works from the phone. Depends on
L2 and L3. Out: native phone apps.

## Order

Wave A: L1, L2, L5, L7, L9. Wave B: L6, L8, L10, L11. Wave C: L3, then L4
and L12. Each lane rebases on main before merging; the orchestrator merges
fast-forward, runs the full `bun run ci`, then deletes the branch and
worktree.
