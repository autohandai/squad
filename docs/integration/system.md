# Integration: usage ledger and Settings → System

Lane L5 · ADR-0105. The module owns `server/usage/ledger.mjs`,
`server/system/{summary,settings,reveal}.mjs`,
`server/routes/system.route.mjs`, `src/lib/system-settings.js`,
`src/components/settings/UsageBreakdown.jsx`,
`src/components/settings/SystemSettings.jsx`,
`scripts/check-usage-and-system.mjs`. The wiring below is already applied in
this lane; it is listed so a re-integration knows every touch point.

## Bridge

Auto-loaded from `server/routes/system.route.mjs`:

| Route | Purpose |
| --- | --- |
| `GET /api/system/summary` | `{ members, channels, threads, messages, memoryEntries, memoryDocuments, dataFolder, memberStateFolder, membersSource, revealLabel, updatedAt }` |
| `GET /api/system/settings` | `{ autoCheckUpdates }` from `<squadStateDir>/settings.json` (default `true`) |
| `PUT /api/system/settings` | body `{ autoCheckUpdates: boolean }`; other keys ignored, unknown stored keys preserved; 400 on a non-boolean |
| `POST /api/system/reveal` | opens `squadStateDir` with the platform opener; no body; 502 when the opener fails |

`server.mjs` edits (done):

- `routeContext()` exposes `appStateDir` (member folders live at
  `<appStateDir>/agents/<id>/`).
- `analyticsSnapshot()` attaches `usage.byMember`, `usage.byModel`,
  `usage.byDay`, `usage.ledgerWindowDays`, `usage.ledgerSince`,
  `usage.ledgerRecords` to both the analytics-daemon snapshot and the
  fallback, through `usageLedgerSnapshot()` and a stat-keyed cache.
- `usageMetadata()` records `steps` (trace tool calls) and `runId`;
  `usageRecordFromEvent` / `usageRecordFromRun` read them back.
- `GET /api/updates` passes `autoCheck: autoCheckUpdatesEnabled(await
  readSystemSettings(squadStateDir))` to `desktopUpdateStatus`, which answers
  `autoCheck` and `skipped`.

Row shape in every ledger table:
`{ key, label, runs, inputTokens, outputTokens, totalTokens, steps | null, durationMs, lastAt }`.
`byMember.label` is the member's name from `web-status.json` or its id;
`byModel.label` is `model (provider)`; `byDay.key` is a UTC `YYYY-MM-DD`.

## Web app

- `AnalyticsPanel` (Usage page) renders
  `<UsageBreakdown usage={snapshot.usage} locale={locale} />` under the
  existing cards, above the failure list.
- `SETTINGS_SECTION_IDS` includes `"system"`; `settingsSections` has
  `{ id: "system", icon: Database, label: copy.system, detail: copy.systemDetail }`
  after Updates; the DOM section `#settings-system` follows `#settings-updates`
  and renders `<SystemSettings api={api} locale copy onAutoCheckUpdatesChange />`.
  The component fetches the two GET routes on mount.
- `onAutoCheckUpdatesChange` maps to `() => refreshUpdates(false)` so the
  app's `updates` state learns the new `autoCheck`; the 30-minute timer
  checks `shouldAutoCheckUpdates(updates)` through a ref before each tick.
- Copy keys in `src/locales.js` (`en`): `system`, `systemDetail`,
  `systemDescription`, `systemMembers`, `systemChannels`, `systemThreads`,
  `systemMessages`, `systemMemoryEntries`, `systemDataFolder`,
  `systemDataFolderDetail`, `systemAutoCheckUpdates`,
  `systemAutoCheckUpdatesDetail`, `copyPath`, `usageLedger`,
  `usageLedgerDescription`, `usageLedgerEmpty`, `usageByMember`,
  `usageByModel`, `usageByDay`. Each has an inline fallback.

## Scripts

`package.json`: `"check:usage-and-system": "node scripts/check-usage-and-system.mjs"`,
added to the `ci` chain after `check:release`.

## DESIGN.md

See the two lines under Settings about the Usage tables and the System
section.
