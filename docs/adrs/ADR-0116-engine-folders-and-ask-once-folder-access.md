# ADR-0116: The engine's own folders are always allowed; any other folder is one question that sticks

Date: 2026-10-13
Status: Accepted

## Context and evidence

A Claude Code member in plan mode showed a failed step in Work details:

    /Users/igorcosta/.claude/plans is outside /Users/igorcosta/Documents/autohand/leads,
    /Users/igorcosta/.autohand/squad/web-state/agents/asq_mv639pn2/profile, …;
    --restricted confines the file tools to the working directory.

The person's rule: that is not acceptable; a folder that belongs to the
engine (Claude Code's own `~/.claude/plans`, on any OS) must work without
asking, and any other folder should be one question whose answer is added
to the member's permissions.

What the code did, read on 2026-10-13: `server/harness/claude.mjs` passes
`--restricted` for plan mode (Claude Code 2.1.296: "removes the built-in
tools that run commands or code" and confines the file tools to the working
directory plus `--add-dir` folders). The bridge's `--add-dir` list was the
member's profile folder, the canvases folder and the member's projects.
Claude Code writes its plan to `~/.claude/plans` in plan mode, so plan mode
refused its own plan file. Nothing in the app turned a refusal into a
question; the only way to a new folder was the member's profile editor.

## Decision

**Engine folders by default.** The Claude Code adapter exposes
`engineDirs()`: `<CLAUDE_CONFIG_DIR or ~/.claude>/plans`, created if
missing, added as `--add-dir` on every turn. Only that subfolder: the
rest of `~/.claude` holds credentials and settings. Codex needs nothing;
its sandbox already covers its own home.

**One question that sticks.** The refusal text is the request.
`src/lib/folder-access.js` reads the failed tool rows of a reply and lifts
the folder out of "<path> is outside …; --restricted confines …" (globs
trimmed, a file reduced to its folder). Under that reply the chat shows a
plain block, one line per folder, with **Allow and continue** and **Not
now**. Allow adds the folder to the member's folders (`projects`, kind
`folder`), which the bridge already turns into `--add-dir` on every later
turn, then sends "You now have access to <folder>. Continue where you
stopped." as a normal message. Not now is remembered on the message. A
folder already in the member's folders is never asked about again.

## Evidence

`bun run check:chats`: a Claude Code turn carries `--add-dir
<CLAUDE_CONFIG_DIR>/plans` and the folder exists afterwards; the pure
checks parse the refusal above into `/Users/igor/.claude/plans`, reduce
`/Users/igor/notes/todo.md` to its folder, ignore other failures, add a
folder once, and stop asking once it is granted or dismissed.
`bun run check:render` passes on the rebuilt bundle.

## Consequences

- Only Claude Code's refusal text is recognised. Codex sandbox denials have
  their own wording and are not yet turned into a question.
- Allow is per member, not per squad: another member asking for the same
  folder is asked again.
- The continuation is a new message, so a member mid-reply gets it queued
  behind the current one; the folder itself is allowed immediately.
- The block lives under the reply only; it is not in Needs you and not on
  the phone.
- Folders outside the home directory are still refused by the bridge's own
  rule (`isRunnableWorkspace`), so Allow on such a path adds nothing.
