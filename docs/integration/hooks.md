# Sessions outside Squad (ADR-0127)

Files: `server/hooks/forward.mjs` (the command engines run), `server/hooks/install.mjs` (merge into each engine's config), `server/hooks/sessions.mjs` (events → runs), `server/routes/hooks.route.mjs`, `src/lib/external-sessions.js` (which member lists a run), `src/components/settings/OutsideSessionsSettings.jsx`, `scripts/check-hooks.mjs`.

| Route | Data |
| --- | --- |
| `POST /api/hooks/claude` or `/codex` | a trimmed hook event `{ event, sessionId, cwd, transcriptPath, prompt, toolName, toolInput, toolError, lastAssistantMessage, at }` → `{ runId? }` |
| `GET /api/hooks/status` | `{ claude: { installed, path, exists, error? }, codex: { … } }` |
| `POST /api/hooks/:engine/install` / `uninstall` | the engine's status after the change |

Configs: Claude Code `<CLAUDE_CONFIG_DIR or ~/.claude>/settings.json`, Codex `<CODEX_HOME or ~/.codex>/hooks.json`. Squad's entries are those whose command contains `server/hooks/forward.mjs`.

Runs: `mode: "external"`, `agentId: ""`, `harness` the engine, `workspace` the session's folder, `external: { engine, sessionId, transcriptPath }`.
