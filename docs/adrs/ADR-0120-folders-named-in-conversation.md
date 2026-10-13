# ADR-0120: A folder named in conversation is allowed or asked for, never silently refused

Date: 2026-10-14
Status: Accepted

## Context and evidence

After ADR-0116 a refused folder became a question under the reply. The
person went further: "if the user mention by just plain english in their
prompts files or folders not in available with existing folder on a dm, we
should ask the user to give us access and also be part of the notifications
and inbox when agent ask for input, but honestly if auto and full access are
enabled by default we shouldn't ask." And, the same night: "by default
anyone using claude code and codex as harness or autohand code they have
full access."

Two facts found on the way. The composer's Access and effort choices never
reached the bridge from the main send path: `sendPromptNow` built the launch
with policy and model only, so a person switching Alex from Plan only to
Accept edits changed nothing (Alex kept saying "once I'm out of planning
mode"). And a Claude Code turn that failed in 62 ms with "An unknown error
occurred (Unexpected)" happened while the disk had 222 MiB free; Claude
Code could not write its own state.

## Decision

**Full access by default on every engine.** `derivedAccess()` and the
bridge's `resolveAccess()` return `full` unless the turn or the member's
engine settings say otherwise; the permission level no longer forces plan
mode or a read-only sandbox (it still feeds Autohand's own flags), and the
composer's default policy for Autohand is `yes`. Plan only and Read only
remain one click away per message or per member. The main send path now
forwards `effort` and `access`.

**Folders named in plain English.** Before a message goes, the app finds
path-looking mentions (`~/…`, `/Users/…`, `/home/…`, `/Volumes/…`,
`C:\…`), asks the bridge what they are (`POST /api/folders/check`: a file
resolves to its folder, `allowed` is the bridge's home-directory rule), and
keeps the ones the member cannot already reach. With Full access they are
added to the member's folders at once with one quiet line in the chat, and
the message goes. With any other access the message is held in the
composer, the chat shows the folder block with Allow and continue / Not now,
a pending request appears under **Folder access** in Needs you, and the
bridge emits `folder.request.pending`, which the notification feed and the
native notification treat like a vault request. Allow adds the folder and
sends the held message; Not now settles the request. Requests persist in
the browser (50 most recent).

## Evidence

`bun run check:chats`: path mentions are found with globs and punctuation
trimmed, covered and disallowed folders are left out, held requests stay
pending until decided, Needs-you rows read "Alex needs /a"; against a real
bridge `/api/folders/check` resolves `~/x/y.md` to `~/x`, marks `/etc`
disallowed, and a request lands in `/api/notifications` with "needs a
folder" in the title. `check:render` and the browser checks pass on the
rebuilt bundle.

## Consequences

- Full access by default means a Claude Code member bypasses every
  permission prompt and a Codex member runs without a sandbox unless the
  person chooses otherwise; this is what was asked for, on a personal
  machine. The Access row still says what the level allows.
- Only path-looking mentions are detected; "the plans folder" in words
  alone is not. The refusal path of ADR-0116 still catches those.
- Folders outside the home directory are never offered; the bridge's rule
  stands.
- Requests are per member and per browser profile; another window of the
  app does not see them until it reloads storage.
