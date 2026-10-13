# Integration: remote access over Telegram

ADR-0088. The module owns `server/remote-access/{telegram-api,format,pairing,bridge}.mjs`,
`server/routes/remote-access.route.mjs`, `src/lib/remote-access.js`,
`src/components/settings/RemoteAccessSettings.jsx`, `scripts/check-remote-access.mjs`.
The wiring below is already done in `src/App.jsx`, `package.json` and
`src/locales.js`; this note records it for the next change.

## Bridge

Routes are auto-loaded from `server/routes/remote-access.route.mjs`:

| Route | Purpose |
| --- | --- |
| `GET /api/remote-access/status` | `{ configured, tokenHint, bot: { username, name }, polling, error, lastPollAt, paired: { name, pairedAt }, pairing: { code, link }, notifyMode, target, running }`. Never the token. |
| `PUT /api/remote-access/token` | `{ token }` → calls `getMe`; a rejected token answers 400 and is not saved. On success registers commands and starts long-polling. |
| `DELETE /api/remote-access/token` | Disconnect: stops polling, forgets token, bot and owner. |
| `POST /api/remote-access/unpair` | Forgets the paired account and issues a new code. |
| `POST /api/remote-access/pairing/rotate` | New pairing code while unpaired. |
| `PUT /api/remote-access/settings` | `{ notifyMode: "long" \| "all" \| "off" }`. |
| `GET /api/remote-access/turns?memberId=` | `{ turns: [{ id, memberId, memberName, prompt, reply, status, error, source: "telegram", startedAt, updatedAt, finishedAt, durationMs, workspace }] }`, oldest first, last 200. |

**State file.** `<squadStateDir>/remote-access.json`, mode `0600`, written
through `server/persistent-json.mjs`. Fields: `token`, `bot`, `owner`
(`id`, `name`, `chatId`, `pairedAt`), `pairingCode`, `pairingFailures`,
`notifyMode`, `target.memberId`, `updateOffset`, `turns`,
`notifiedProposals`, `decisions`. Running turns become `failed` with a restart
message when the bridge boots.

**Environment.** `AUTOHAND_SQUAD_TELEGRAM_API_URL` (default
`https://api.telegram.org`; the check points it at a loopback fake),
`AUTOHAND_SQUAD_TELEGRAM_POLL_SECONDS` (default 50), `AUTOHAND_SQUAD_APP_URL`
(deep links and the loopback origin for decision routes; otherwise the Host
header of the last settings request, then `--host`/`--port` from argv).

**Events consumed** (from `ctx.events`): `handoff.pending`,
`approval.pending` (Approve/Decline → `POST /api/workflows/:runId/approve|decline`),
`run.finished` (completed per notify mode using the run's `startedAt`/`finishedAt`
from `ctx.runs`; failed always; stopped never), `chat.finished` (failed always;
completed only under `all`), `channels.changed` (new `proposed` records from
`ctx.agentChannelActions.list()` → Approve/Decline →
`POST /api/channel-actions/:id/approve|decline`). Copy and deep links come
from `server/notify/policy.mjs`'s `notificationFor`.

**Turns.** `ctx.goals.executeTurn(payload, { signal, onEvent })`, the goal
manager's launch path, with the member's `agent` and `profile` from
`channels.json` → `agentChannelAccess[memberId]` and `squadMembers` from the
other records. A member without a record is asked to chat once in the app.
Names come from `web-status.json`.

**Packaging.** All files live under `server/`, which
`scripts/stage-desktop.mjs` and `scripts/package-squad-portable.mjs` copy
whole; no staging list change was needed.

## Web app (`src/App.jsx`)

- `SETTINGS_SECTION_IDS` gained `"remote-access"`; the settings nav lists
  `{ id: "remote-access", icon: Smartphone, label: copy.remoteAccess, detail: remoteAccessDetail(remoteAccess, copy) }`.
- State: `remoteAccess` (from `GET /api/remote-access/status` on mount) and
  `remoteAccessActions` (`refresh`, `connect`, `disconnect`, `unpair`,
  `rotatePairing`, `setNotifyMode`) are passed to `SettingsPage`, which
  renders `<section id="settings-remote-access">` with
  `SettingsSectionHeader` and `<RemoteAccessSettings status onConnect onDisconnect onUnpair onRotatePairing onNotifyMode onRefresh copy />`.
  The component calls `onRefresh` every 3 s while a bot is connected so the
  pairing row turns into the paired-account row on its own.
- The 2.5 s member-work poll also fetches `/api/remote-access/turns` and
  applies `reconcileRemoteTurns(current, turns, membersRef.current, locale)`
  to `messagesByAgent`, the same way goals are reconciled. Each turn becomes
  a user row (`remote-<id>-u`) and a member row (`remote-<id>-a`, patched in
  place as the turn progresses); turns older than the member's
  `conversationStartedAt` stay out.

## `package.json`

`"check:remote-access": "node scripts/check-remote-access.mjs"`, appended to
the `ci` chain after `check:release`.

## Copy keys (`src/locales.js`, `en`)

`remoteAccess`, `remoteAccessDescription`, `remoteAccessOff`,
`remoteAccessError`, `remoteAccessPaired`, `remoteAccessPairing`,
`remoteAccessNotConnected`, `remotePollingAs`, `remoteConnecting`,
`remoteBotToken`, `remoteBotTokenDetail`, `remoteTokenStored`,
`remoteTokenReplace`, `connect`, `disconnect`, `remotePairing`,
`remotePairingDetail`, `openInTelegram`, `newPairingCode`,
`remotePairedAccount`, `remotePairedSince`, `unpair`, `remoteNotify`,
`remoteNotifyLong`, `remoteNotifyLongDetail`, `remoteNotifyAll`,
`remoteNotifyAllDetail`, `remoteNotifyOff`, `remoteNotifyOffDetail`.

## `DESIGN.md`

Under **Settings**: the Remote access lines recorded there.
