# Natural Squad workflows: implementation and verification

This work follows the eight screenshots attached on 2026-10-21. It builds on
`3faa6a7` without changing the active goal's scope. The installed public 0.1.8
and the source work are separate evidence until a new build is verified.

## Required behavior

1. A direct chat request such as “create yourself a reminder to say hi to me
   every 2 minutes” creates a real scheduled Automation without a second
   confirmation. The member reports the persisted outcome. Suggestions that
   the person has not requested remain distinguishable from authorized work.
2. Every member's Automations profile and the Execution → Automations tab
   show the same saved schedules, including chat-created reminders, their
   enabled state, next run and outcomes. Reminders do not disappear into a
   blocked plan task. Existing automations remain usable across restart.
3. Autohand, Codex and Claude Code default to automatic execution. A direct
   request must not be stopped by an invented Squad confirmation requirement.
   Explicitly selected user restrictions continue to be represented honestly.
4. Natural requests to teach/share with the team cause real teammate
   communication and knowledge sharing, with persisted delivery evidence.
5. Creating a channel asks its goal; the person's answer designs and prepares
   a specialized team appropriate to that goal, connects it to the channel,
   and starts useful work. Roles come from the goal rather than a fixed team.
6. The signed-in account photo appears consistently in the sidebar/footer
   and account menu, with a working fallback when no photo exists.
7. Messages offer Reply and create persistent threads. Independent thread
   work can proceed in parallel without mixing sessions or losing replies.
8. Quick Chat follows the main app's current skin and light/dark theme,
   including changes while both windows remain open (2026-10-22 screenshot).

## Evidence and status

- Baseline: `main` was clean at `3faa6a7`; other registered worktrees were
  preserved. All eight local screenshot files were inspected.
- Screenshots 1–3, 6–7: Eva's requested reminder is reported as a routine
  proposal and a blocked plan task, while Automations lists show another
  entry or none. Source `server/team/service.mjs` explicitly tells every
  engine to wait for confirmation after `squad_schedule`.
- Screenshot 4 supplies the reference for chat-created schedules and
  per-member schedule visibility, not a request to copy that app's styling.
- Screenshot 5 shows initials in both signed-in account locations.
- Screenshot 8 shows a message menu with Copy and Show what it did, without
  a Reply action.

### Completed implementation and proof

| Requirement | Evidence |
| --- | --- |
| Natural reminders | `check-natural-automations.mjs --browser`: a real bridge saves an enabled two-minute reminder, confirmed receipt and next occurrence; retries do not duplicate it; editor drafts stay inert; explicit Ask/Block remain effective. A real Autohand SDK/fantail request also scheduled it; Run now used the same executor and produced saved reply text. Automatic due-time firing is verified separately by the scheduler checks below. |
| One Automation agenda | The same browser check renders the schedule in Execution and the member profile, pauses it from Execution, verifies the profile agrees, then closes the browser and restarts the bridge. The actual saved reminder answer appears after reopening. Repeated legacy imports preserve the original id and cannot undo a later title edit or Pause; deletion persists. |
| Automatic execution | The bridge defaults an omitted policy to `yes`, including agent-less work, and hydrates the registered member's settings. The regression checks an actual `--yes` invocation and retained saved `--restricted`. `check-harness-adapters.mjs` verifies Codex/Claude defaults and explicit access choices; `check-permission-policy.mjs` passes. |
| Teaching | `check-team-operations.mjs` and `check-team.mjs` exercise actual managed MCP transport with controlled execution: shared memory, per-recipient delivery, deduplication, strict arguments and cycle rejection. Real Autohand/fantail saved the lesson and returned both Noah's and Iris's actual answers after the compatibility and isolation changes. |
| Channel goals | `check-channel-goals.mjs --browser` designs different mobile/release and sales/copy rosters, preserves names/roles, claims one setup owner, resumes stable prepared ids after restart, registers/joins members to the original channel, and starts four real executor turns. Bridge-only work completes without a browser, Ready retries do not duplicate it, and actual answers survive restart in the original thread. The real designer also selected goal-specific mobile/release/UX/QA specialties after the system-contract fix. |
| Account photo | The natural-workflows browser check verifies a loaded account photo in both footer and the actual open menu. Broken and absent images both render initials in those same locations. `AccountAvatar` is shared with messages. |
| Independent replies | `check-member-threads.mjs --browser`: Reply exists on user and member messages; roots/retries persist; two held turns for one member start concurrently in separate engine sessions; stopping one preserves the other. Both channel and DM lanes exclude the other thread's context, and the saved answer renders after restart in the thread sheet. Scoped team/Vault credentials do not retarget the main conversation. |
| Quick Chat appearance | `check-quick-chat-theme.mjs`: two real app documents share a disposable browser profile. An already-open 380×520 Quick Chat follows Soft/light → Grut/dark → Default/light → Soft/light; computed background/radius tokens match the main window, its document does not reload and its draft remains intact. |

### Regressions and build

Passed in this change:

- `node scripts/check-routines.mjs` — 34 checks: calendar/DST arithmetic,
  fire, skip while busy, run limits, app dispatch, explicit proposal
  confirmation, persistence and interrupted-work recovery.
- `node scripts/check-run-channel-actions.mjs` — 13 checks across controlled
  SDK/CLI/Codex execution, including permission revocation and stopped work.
- `node scripts/check-channel-lifecycle.mjs --api-only` — concurrent writes,
  membership, threads, history larger than one MiB, restart, stale snapshots,
  deletion and damaged-file recovery.
- `node scripts/check-channel-replies.mjs`, `check-team.mjs`,
  `check-team-operations.mjs`, `check-vault.mjs`, `check-sdk-sessions.mjs`,
  `check-harness-adapters.mjs`, `check-permission-policy.mjs` and
  `check-member-draft.mjs`.
- `node scripts/check-computer-use-bridge.mjs` — existing private-grant,
  proxy framing, per-work config/cleanup and revoke behavior; native OS and
  provider interactions are mocked in this check.
- `bun run build` — JSX import check and production frontend build.
- `env CARGO_INCREMENTAL=0 TAURI_CONFIG='{"bundle":{"externalBin":[],"resources":[]}}' cargo check --manifest-path src-tauri/Cargo.toml`
  — desktop shell compile; no bundled sidecars or installable release produced.

This is focused and affected-seam validation, not a run of the entire `ci`
chain. Controlled transports establish execution and persistence behavior;
the live sample establishes Autohand SDK/fantail behavior, not every offered
model or real Claude/Codex account. All verification uses disposable Squad
and browser state; it does not send messages to the installed squad.

### Evidence artifacts and release boundary

Screenshots under `.codex-artifacts/natural-workflows/` were visually
inspected: `quick-chat-theme.png`, `channel-goal-team.png`,
`member-thread.png`, `account-photo.png`, `account-photo-fallback.png`,
`member-automations.png` and `execution-automations.png`.

Live observations: `live-autohand-initial.json` retains the initial reminder
success and failed teaching attempt; `live-autohand-teaching.json` and
`live-autohand-design.json` contain the passing focused follow-ups. These
are local ignored artifacts, not published account/provider records.

Native Computer Use twice returned `Sky Computer Use native pipe startup
failed`. The browser proof and compile are not native-window observation.
The installed public **0.1.8** has not been replaced by these source changes;
no new public release, signed installer or updater installation is claimed.
The standing decisions and known tradeoffs are ADR-0138 through ADR-0142.
