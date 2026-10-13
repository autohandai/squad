# ADR-0114: Access, model and reasoning effort per engine, chosen in the composer

Date: 2026-10-13
Status: Accepted

## Context and evidence

A Claude Code member (Alex) answered "Switch plan mode off for Alex again
and I'll write the shortlist…" and did nothing else: it was in plan mode
and had no way out. The person opened the composer settings and found Mode
(Command / Auto / Goal), Policy (restricted / normal prompts / yes mode),
a free-text "model" box and Dry run. Setting Auto changed nothing about
writing; typing a model name was guesswork; there was no reasoning-effort
control at all.

What the code did, read on 2026-10-13:

- `server/harness/claude.mjs` chose the permission mode from two inputs
  and nothing else: the member's permission level (`permissionMode`) and
  the launch policy. `restricted` on either meant `--permission-mode plan`.
  Alex's level was Chat only, so every turn was plan mode whatever the
  composer said; "Auto" only appends "work autonomously" to the prompt.
  `server/harness/codex.mjs` did the same with `--sandbox read-only`.
- The Policy options are Autohand CLI words (`restricted`, `ask`, `yes`);
  nothing in the popover said "plan mode".
- The model box was free text with no source of truth. The installed
  Claude Code (2.1.296) accepts aliases (`fable`, `opus`, `sonnet`,
  `haiku`) and full names, and has `--effort low|medium|high|xhigh|max`;
  the installed Codex (0.162.1) takes `-m` and
  `-c model_reasoning_effort=<minimal|low|medium|high|xhigh>`, and the
  person's `~/.codex/config.toml` already said `model = "gpt-6.1-sol"`,
  `model_reasoning_effort = "xhigh"`. None of that reached the app.

## Decision

**One access vocabulary, shown in each engine's words.** `plan` / `write`
/ `full` on the harness assignment and on every launch payload. Claude Code
shows Plan only / Accept edits / Full access and maps to
`--permission-mode plan|acceptEdits|bypassPermissions`; Codex shows Read
only / Workspace write / Full access and maps to `--sandbox
read-only|workspace-write|danger-full-access`. An explicit choice wins; an
empty one derives from the permission level and policy exactly as before,
and the composer select shows that derived value, so plan mode is visible
and one click away from off. Auto switches a plan-mode member to Accept
edits, because Auto means "do the work". The resolution lives in one leaf
module, `server/harness/access.mjs`, which both adapters import and the
registry re-exports (the first version imported it from the registry and
tripped the registry's own import cycle at boot: "Cannot access 'id'
before initialization").

**Choices come from the installed binary.** `detect` for Claude Code reads
`claude --help` and parses the `--effort` and `--permission-mode` choice
lists and the aliases named in the `--model` paragraph, adds the models
Claude Code cached in `~/.claude.json` and the default from
`~/.claude/settings.json`. Codex has no list command, so its choices are
the model in `config.toml` plus Custom, and the documented effort values.
`/api/harnesses` now carries `models`, `efforts`, `accessModes` and
`defaults` per engine. The adapter only sends `--effort` when the binary
listed that level (an empty list lets the value through for a newer CLI).

**Where it is set.** The composer popover for a Claude Code or Codex
member shows Access, a model select (engine default, the reported models,
Custom… for a typed name) and Reasoning effort when the engine has one; for
Autohand members the popover is unchanged. The same three fields sit under
Advanced in the member's engine settings (`HarnessSelect`) as defaults for
every turn; the composer starts from them. Both travel on `effort` and
`access` beside `model` in chat, queue and run payloads.

## Evidence

`bun run check:harness` covers the resolution: a restricted member with
`access: "write"` gets `acceptEdits`, an unrestricted one with `"plan"`
gets `plan` without the bypass flag, Codex `workspace-write` for one turn,
`-c model_reasoning_effort="high"` including on a resumed thread, an effort
the binary does not list is not sent, and the help and config parsers
against the real texts. `bun run check:chats` drives a real bridge: a
restricted member's turn carries `--permission-mode plan`; the same member
with `access: "write"`, `effort: "high"`, `model: "opus"` carries
`acceptEdits`, `--effort high`, `--model opus`; engine settings `effort:
"low"`, `access: "full"` apply when the turn chooses nothing.
`detect` against the installed CLIs returned fable/opus/sonnet/haiku plus
`claude-fable-5-1[1m]` and efforts low to max for Claude Code, and
gpt-6.1-sol with efforts minimal to xhigh for Codex. `bun run check:render`
passes on the rebuilt bundle.

## Consequences

- A per-turn Full access choice bypasses every Claude Code prompt and every
  Codex sandbox; the popover line says so, but nothing confirms it.
- Access is still not shown on the reply or the run row; the command line
  in Work details is the only place it can be read afterwards.
- The Claude Code model list depends on parsing help text; a wording change
  empties the alias list (the cached models and Custom remain).
- Codex offers only the configured model and Custom, since nothing on this
  machine lists what the account can use.
- Autohand members keep the old Policy select and free-text model; their
  catalog lives elsewhere and was not touched.
- The derived default still follows the permission level, so a Chat-only
  member starts every new conversation in plan mode until the engine
  setting says otherwise.
