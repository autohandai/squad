# ADR-0127: Sessions started outside Squad are recorded through engine hooks; the Model page speaks each engine's language

Date: 2026-10-14
Status: Accepted

## Context and evidence

Two gaps were left open after ADR-0125 and named in the report to the
person: the member Model page still showed the Autohand provider assignment
for Claude Code and Codex members, and lifecycle hooks for Claude Code or
Codex sessions started outside Squad had been offered but not built.

The Model page (`AgentModelPage` in `src/App.jsx`) always rendered
`modelAssignmentForAgent` and `effectiveModelForAgent`, which fall back to
the workspace's default provider (Autohand AI, moa). A Claude Code member
never uses that; its model, effort and access come from its harness
assignment (ADR-0114).

Squad saw only the turns it started. A session the person runs in a
terminal (`claude`, `codex`) left no trace in the app. Both engines have
lifecycle hooks with the same shape, checked on this machine rather than
assumed:

- Claude Code 2.1.296 reads `hooks` from `<CLAUDE_CONFIG_DIR or
  ~/.claude>/settings.json`; the person's file already held hooks from
  another tool (Superset's notify.sh on UserPromptSubmit, Stop,
  PostToolUse, PostToolUseFailure, PermissionRequest).
- Codex 0.162.1 has its own hooks engine reading `<CODEX_HOME or
  ~/.codex>/hooks.json` with the same object shape; the binary's strings
  list `hook_event_name`, `transcript_path` and the events PreToolUse,
  PostToolUse, SessionStart, SessionEnd, UserPromptSubmit, Stop. The
  person's file held another tool's SessionStart and Stop hooks. The
  binary also keeps the older `notify` with `agent-turn-complete`; hooks
  replace it here.

## Decision

**Model page.** For a member whose engine is not Autohand Code,
`EngineModelPage` shows "Alex runs with Claude Code", the effective model
from `engineModelSummary` (member choice, last reply, engine default) with
its source, and the same `HarnessSelect` the engine chip uses, opened, with
model, reasoning effort and access, and Save. One line says the workspace
provider applies only if the member is switched back to Autohand Code.
Autohand members keep the provider page unchanged.

**Hooks.** Settings → Runtime bridge gains "Sessions outside Squad" with a
switch per engine. On adds Squad's entries to that engine's own config for
SessionStart, UserPromptSubmit, PostToolUse (matcher `*`), Stop and
SessionEnd, after copying the file to `<file>.squad-backup-<time>`; Off
removes only entries whose command runs `server/hooks/forward.mjs`, leaving
every other hook and setting exactly as found. The command is the bridge's
own node, the forwarder, the engine and the port. The forwarder reads the
event on stdin, posts a trimmed copy to `POST /api/hooks/<engine>`, never
prints (Claude adds UserPromptSubmit output to the model's context), exits 0
within 2.5 s whatever happens, and skips turns Squad started itself (they
carry `AUTOHAND_SQUAD_MEMBER`). The bridge (`server/hooks/sessions.mjs`)
opens one run per prompt with mode `external`, adds a tool row per
PostToolUse, closes it at Stop with the reply (Codex sends
`last_assistant_message`; for Claude Code the last assistant text is read
from the transcript's tail) and closes an open prompt as stopped at
SessionEnd. Runs carry no member; the app lists them on any member whose
engine matches and whose workspace or folders contain the session's folder,
and in All work, labelled "outside Squad". Finished ones persist like other
runs (route plug-ins gained `ctx.persistRuns`).

## Evidence

- `bun run check:hooks`: pure checks for the merge (the person's hooks and
  settings kept, installing twice does not duplicate, removal restores the
  file exactly, an emptied `hooks` object is dropped), the transcript
  reader, the attribution (a sibling folder with the same prefix does not
  match) and the label. Against a real bridge with config dirs in a temp
  folder: install writes both configs with a backup; the command the
  installer wrote is run through `/bin/sh` with hook JSON on stdin exactly
  as the engines do; a Claude Code session becomes a completed run with the
  Write tool row and the reply from the transcript; a Codex session's reply
  comes from `last_assistant_message`; a turn with `AUTOHAND_SQUAD_MEMBER`
  set adds no run; SessionEnd closes an open prompt; uninstall restores the
  person's settings byte for byte as JSON.
- Real Claude Code: `claude -p "Reply with exactly: HOOK OK" --model haiku
  --settings '<Squad's hooks pointing at a throwaway bridge on 19881>'` from
  a scratch folder printed "HOOK OK" in 9 s, and the throwaway bridge listed
  a completed external run titled with the prompt, reply "HOOK OK", in that
  folder. The person's own `~/.claude/settings.json` was not touched.
- `bun run check:engine-model:browser`: a Claude Code member's Model page in
  headless Chrome shows "Claude default", Engine settings and the provider
  note, and not the Autohand provider form; screenshot looked at.
- Also passing: check:render, check:harness, check:bridge-imports,
  check:execution-panel:browser, check:settings:browser, check:always-on,
  check:chats.

## Consequences

- Codex hooks were verified only with the fixture payloads; no real Codex
  session ran through them, because a temporary CODEX_HOME would have meant
  copying the person's Codex credentials.
- Turning recording on writes the person's own engine config. The backup is
  kept but never cleaned up; repeated toggles leave one backup each.
- The command embeds the bridge's node path and port. Moving the app or
  changing the port leaves stale entries until the switch is turned off and
  on again; the forwarder fails quietly meanwhile.
- Outside sessions are not attributed to exactly one member; every member
  on that engine whose folders contain the session's folder lists it.
- Tool rows carry the tool name and a 600-character input summary, not the
  tool's output; the full transcript stays in the engine's own files.
- PreToolUse and permission events are not recorded, so an outside session
  waiting for approval shows as running, not as needing a decision.
