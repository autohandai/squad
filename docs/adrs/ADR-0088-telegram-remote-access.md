# ADR-0088: Remote access over Telegram

Date: 2026-10-13

## Context

Squad runs on one machine and the person who runs it is not always at it.
The parity spec (`docs/superpowers/specs/2026-10-13-parity-lanes-design.md`,
lane L2) asks for a way to talk to a member from a phone and to be told when
the squad needs a decision, without exposing the machine to the internet.
The reference behaviour is xiryn's Telegram bridge: the app long-polls the
Bot API from the machine, so the connection always goes outward, exactly one
Telegram account is paired, and needs-you events reach that chat with inline
decisions.

What the bridge already had, and what this change reuses rather than
duplicates:

- `server/notify/policy.mjs` produces a title, body and in-app route for every
  needs-you event. The Telegram sink calls `notificationFor` and only adds the
  decision buttons; the copy and the deep link are the policy's.
- `server/goal-manager.mjs` already runs bridge-owned member turns through
  `executeChatTurn`, and `src/lib/member-goals.js` reconciles their results
  into the browser's conversation. A Telegram turn uses the same
  `executeTurn` function (reached as `ctx.goals.executeTurn`) and the same
  reconciliation shape (`src/lib/remote-access.js`), so the bridge has one
  harness launcher.
- Member launch configuration lives on the bridge in `channels.json` under
  `agentChannelAccess` (ADR-0075): every member the app has ever sent a
  message for has its harness, projects, permissions and profile there. The
  bridge resolves a Telegram target from that record plus the roster mirrored
  in `web-status.json`. A member that has never chatted in the app has no
  launch record; the bot says so and asks for one message from the app first.
- Channel proposals and workflow approvals already have decision routes
  (`POST /api/channel-actions/:id/approve|decline`,
  `POST /api/workflows/:runId/approve|decline`). The Telegram buttons call
  those routes over loopback, so a decision made from the phone is identical
  to one made in the app, including its 409 when it was already resolved.

Evidence from `node scripts/check-remote-access.mjs`, which starts the real
bridge in an isolated state directory against a fake Bot API on loopback and
a Codex-shaped member fixture:

- A rejected token (`401` from `getMe`) returns 400 and leaves no
  `remote-access.json` behind; a valid token answers with `@squad_fixture_bot`,
  an 8-character code and the `https://t.me/<bot>?start=CODE` link, registers
  the six commands with `setMyCommands`, and the state file is mode `0600`.
- A wrong `/pair` rotates the code; `/start CODE` from the deep link pairs
  that account; a second account that sends the old code is refused with one
  line; an unpaired sender gets one line and nothing else.
- One message from the owner produced exactly one harness launch in the
  member's workspace, one status message ending `✓ Kai · N steps · Ns`, the
  typing indicator, and the reply as Telegram HTML with the Markdown table
  rendered as `<i>Step · State</i>` and `• <b>build</b> · ok` lines. The turn
  is listed by `GET /api/remote-access/turns` with `source: "telegram"`.
- A `handoff.pending` event reached the chat as the policy's
  "needs you · handoff" title with `<a href="…/inbox">Open in Squad</a>`.
- Under notify mode `all` a completed `run.finished` notified; under `off` a
  completed run stayed silent and a failed one still notified.
- A member reply carrying a `SQUAD_ACTION` channel proposal produced a
  message with Approve/Decline; tapping Approve turned the record from
  `proposed` to `created` through the decision route and the message was
  edited to "Approved from Telegram" with its buttons removed; a second tap
  answered "already handled".
- `/stop` during a held turn ended it with status `stopped`.
- After killing and restarting the bridge, the token, bot, owner, target and
  all three turns were still there, polling resumed, and the next message was
  answered.

Two things the check caught that the first draft got wrong:

- The first version handled updates strictly in order and awaited each turn
  inside the poll loop. `/stop` was therefore never read until the turn it
  was meant to stop had finished; the check timed out waiting for "Stopped
  Kai". Turns now run detached from the loop, which is also what lets the
  bridge answer "still working, send /stop" to a second message.
- The prompt a harness receives is not the Telegram text alone: the bridge
  wraps it in the member's operating instructions, as it does for the app.
  The check asserts the message is the tail of that prompt rather than the
  whole of it.

## Decision

- Add `server/remote-access/` (`telegram-api.mjs`, `format.mjs`,
  `pairing.mjs`, `bridge.mjs`) and `server/routes/remote-access.route.mjs`.
  The bridge long-polls `getUpdates` with plain `fetch`; there are no inbound
  ports and no webhook. The base URL and poll timeout are environment
  overrides so the check can point it at a fake server.
- State is `<squadStateDir>/remote-access.json`, written at mode `0600`
  through `writePersistentJson`. It holds the token, the bot, the paired
  owner, the pairing code, the notify mode, the chosen member, the update
  offset, the last 200 turns, and pending decisions. The browser-facing
  status carries only a masked hint of the token (its last four characters).
- Exactly one owner. Pairing is a single-use 8-character code from an
  unambiguous alphabet, accepted as `/pair CODE` or through the deep link's
  `/start CODE`. A wrong code rotates the code. Anyone else gets one line.
- Commands: `/members` (inline buttons), `/channels`, `/new`, `/stop`,
  `/status`, `/help`, registered with `setMyCommands`. Plain text runs a turn
  for the chosen member; one status message is edited with the step count,
  the checklist progress and the last few steps, at most once every 1.5 s;
  the reply is Markdown converted to Telegram HTML, tables as readable lines,
  split under 4096 characters, with a plain-text fallback when Telegram
  rejects the HTML.
- Needs-you events always notify: `handoff.pending`, `approval.pending`,
  failed `run.finished` and `chat.finished`, and channel proposals (detected
  on `channels.changed` by reading the action list). Completed runs follow
  the notify mode: long (a minute or more, measured from the run record),
  all, or off. Approvals and proposals carry Approve/Decline buttons that
  call the existing decision routes; the message is edited with the outcome.
- The app reconciles remote turns into the member's conversation the way it
  reconciles goals: `reconcileRemoteTurns` in `src/lib/remote-access.js`,
  polled from the same 2.5 s loop as `/api/goals`. Messages started from the
  app are untouched.
- Settings → Remote access (`src/components/settings/RemoteAccessSettings.jsx`)
  follows the Settings contract: a token row with Connect, a status sentence
  with Disconnect, a pairing row with the code, Open in Telegram and New code,
  a paired-account row with Unpair, and three check-mark choice rows for the
  notify mode. The settings nav shows Off, Waiting to pair, Needs attention,
  or the paired name.

## Consequences

- Other channels (WhatsApp, Slack, Discord) are not built. The bridge's
  `notify`, `say` and decision handling are Telegram-specific; a second
  channel would need its own API module and a shared sink interface, which
  this change does not extract.
- No QR code. `node_modules` has no QR library and new dependencies are not
  allowed in this lane, so the pairing step shows the code and the deep link
  only. Scanning would need a vendored encoder.
- No phone take-over links and no screenshots over Telegram; those depend on
  the workstation lane (L3) and L12.
- A member must have sent one message from the app before it can be reached
  from Telegram, because launch configuration is registered on first chat.
  The bot explains this; the roster still lists the member.
- `/new` resets the member's warm session on the bridge but does not move
  the app's `conversationStartedAt`; the app conversation keeps its history
  while the member starts from a clean context. A `/new` in the app does hide
  older remote turns, as it hides older goals.
- `chat.finished` carries no duration, so under notify mode "long" a
  completed chat never notifies; only runs have a measured duration. Under
  "all" a completed chat notifies with its preview. Failed chats always do.
- A turn started from Telegram is stopped by `/stop` or by the bridge
  shutting down; the app's Stop member button does not reach it because the
  turn is not registered as a browser chat. The member's break and
  availability rules still apply at launch.
- Deep links point at the app URL the bridge knows (`AUTOHAND_SQUAD_APP_URL`,
  else the Host header of the last settings request, else loopback). On a
  phone that URL only opens when the person is at the machine, as the spec
  intends; a remote-reachable address is L12's job.
- Telegram's inline URL buttons are not used for the deep link because
  Telegram rejects some non-public URLs in buttons; the link is an HTML
  anchor in the message text instead.
