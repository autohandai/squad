# First-run feedback: what changed, item by item

The report "Squad first-run experience: hurdles and recommendations" (Squad
0.1.14, bundled Autohand Code 0.9.7) listed fourteen hurdles and a side
note, and asked for three things. This is the response, with where each fix
lives and how it was verified. The reasoning and evidence are in ADR-0161,
ADR-0162 and ADR-0163.

Verification: `node scripts/check-first-run-live.mjs --demo --runtime=…`
passed end to end on the installed app on 2 November 2026 (run 12), every
step from a fresh install to Reset Squad. The node and browser checks named
below pass on `main`.

## 1. Permissions

| Item | Status | What changed | Where |
| --- | --- | --- | --- |
| 1.1 New agents inherit personal approvals | Fixed | A new member's config is seeded without `permissions`; the save replaces the rule lists and `allowList`/`denyList` instead of merging. | `seedMemberConfig`, `permissionSettingsFromAgent` in `server.mjs`; `check-permissions` |
| 1.2 Team tools denied on the Autohand engine | Fixed | The bridge writes `mcp__<server>__<tool>` names for the team, vault, Computer Use and web research servers into `availableTools`, `allowPatterns` and `rules` at every ladder level. The walkthrough's first step asserts the names are in the saved config. | `managedToolPolicies` in `src/lib/permission-policy.js`; `check-permission-policy`, `check-first-run-live` |
| 1.3 Rows that look like team tools | Fixed | A "Squad team tools" group in Built-in tool rules lists every team tool and maps to the real names. | `SQUAD_TEAM_TOOLS`; `check-permission-policy` |
| 1.4 Rules off keeps the old lists | Fixed | Turning rules off removes `availableTools`, `excludedTools`, `allowPatterns` and `rules` from the file. | `builtInRuleKeys` in `server.mjs`; `check-permissions` |
| 1.5 A ladder level turns rules back on | Addressed | A level still applies its preset (the ladder is the preset); the ladder now says so in its sentence, and team-tool access no longer depends on the level. | `src/App.jsx` ladder copy |
| 1.6 Config preview reads as the real config | Fixed | The preview reads the member's saved `config.json` through the bridge, shows it beside the form, and says when they differ. | `GET /api/members/:id/runtime-permissions`; the walkthrough's config-preview step |
| 1.7 No route to the team builder | Fixed | `squad_propose_team` records a proposal; the chat shows the roster with Create team, which runs the same import as New team. The CLI's own `create_team`/`add_teammate` are blocked and excluded. | `server/team/service.mjs`, `src/lib/team-proposals.js`, `TeamProposalCard.jsx`; `check-team-proposals`, `check-first-run-cards-browser` |

## 2. Conversation

| Item | Status | What changed | Where |
| --- | --- | --- | --- |
| 2.1 Questions answered "Yes" | Fixed | `ask_followup_question` is blocked and excluded. Members ask with `squad_ask`: the question shows as a card under the running reply with its options and an answer field, and the answer returns as the tool's result; on an unwatched turn the tool refuses and the member asks in its reply. The walkthrough has the member ask one question and answers it from the card. | `server/questions.mjs`, `POST /api/chat/question`, `QuestionCard.jsx`; `check-questions`, `check-team` |
| 2.2 Permission requests time out as declined | Fixed | Every request is acknowledged at once; the chat shows a card with Allow once, Allow for this reply and Deny, answered over RPC; unanswered requests are denied when the reply ends. The walkthrough answers one and checks the file exists. | `server/permission-approvals.mjs`, `POST /api/chat/permission`, `PermissionApprovalCard.jsx`; `check-permission-approvals` |
| 2.3 Conversation lost on a new engine session | Fixed | The first prompt of a fresh session carries the recent conversation; the chat says "The engine session restarted; replaying…". The walkthrough idles sixteen real minutes and checks the member still knows what it wrote. | `server/chats/replay.mjs` |
| 2.4 Saved chats reach the agent as short notes | Fixed | `squad_read_chat` reads a saved chat in full by the id the recall list now carries. | `server/team/service.mjs`, `server/chats/recall.mjs` |
| 2.5 Channel threads carry text only | Fixed | Thread history names the tools each reply used, and a thread's turns reuse one warm engine session on the Autohand engine (team and vault scoped per thread), so tool state carries across a thread's replies. Codex and Claude Code members still run one process per turn. | `withSavedMember`, `prepareTeamWork`/`prepareVaultWork` in `server.mjs`; `check-thread-warmth` |

## 3. Operations

| Item | Status | What changed | Where |
| --- | --- | --- | --- |
| 3.1 No clean-install reset | Fixed | Settings › System › Reset Squad moves Squad's data aside and returns to first run, keeping the Autohand Code sign-in; SETUP_GUIDE lists every location. Keychain and privacy grants stay a hand step. | `POST /api/system/reset`, `SystemSettings.jsx`; `check-system-reset` |
| 3.2 No conversation export | Fixed | Export conversation in the chat menu, Markdown and JSON with tools, permission decisions and written files. | `src/lib/conversation-export.js`; `check-conversation-export` |
| Side note: bundled CLI behind | Addressed | The pin is 0.9.9; `bun run check:cli-pin` fails while the pin is behind the latest release and is part of the release preflight. Releases are not cut automatically when Autohand Code ships. | `scripts/check-cli-pin.mjs`, `docs/release.md` |

## What the report asked for

- **The cleanup sprint, demo items first.** 1.2, 2.2, 2.1, 2.3, 1.7 and 1.1 are above, each with a check.
- **A first-run walkthrough in release checks.** `scripts/check-first-run-live.mjs` is that walkthrough; `docs/release.md` names it as the release rehearsal. It covers the fresh install, a member on each engine, the team designed and written to the repo, a question answered from the chat and a conversation past fifteen minutes.
- **Keeping the bundled CLI current.** `check:cli-pin` in the preflight, and the rehearsal as the gate for moving the pin.

## Found on the way

The walkthrough surfaced things the report could not have seen; they are
fixed and recorded in ADR-0161 §7–§13 and ADR-0163: the engine's automatic
specialists stalling a two-sentence reply, file writes staged and never
applied in RPC preview mode, `--yes` silencing Ask rules, a reply that
"Working…" for twenty minutes after the engine went silent, Work details
counting one permission request as several answered rows, a member editing
its work plan instead of working, and the Runs tab and a member's transcript
now reading like the conversation from any window.

One thing stays outside Squad: the default model (Autohand AI, fantail) can
repeat itself in a long tool-using turn until the provider truncates the
response. The engine reports it; the demo should run its members on a model
that holds up in long tool turns.
