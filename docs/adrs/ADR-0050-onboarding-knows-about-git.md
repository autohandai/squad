# ADR-0050: Onboarding says what git knows

Date: 2026-09-29
Status: Accepted

## Context

The owner, on setting up a new user:

> I want one of the onboarding to set a local folder and if not .git repo we
> start tracking right away, detect their git user name, in addition to the
> existing steps.

Onboarding already asks for a folder and profiles it, which is where the
teammate suggestion comes from. What it never mentioned was version control.
`.git` is in the profiler's skip list, so the profile could not tell a
repository from a bare directory, and neither could the person.

That matters at exactly this moment and no other. A squad member edits files.
In a tracked folder every edit is recoverable; in an untracked one nothing is.
Finding that out after a member has worked is finding out too late.

## Decision

**The folder profile reports git.** `server/workspace-git.mjs` reads whether
the folder is inside a work tree, its root and branch, and the configured user
name and email. The identity is read even for an untracked folder, because it
answers "who will these commits be from" before there are any commits.

**Onboarding says it in one line, and offers one action.** A tracked folder
reads "Tracked by git on main. Commits here will be from Igor Costa." An
untracked one reads "Not tracked by git, so nothing a teammate changes here
can be undone", with a **Start tracking** text button that runs `git init`.
Neither blocks going on: this is information and an offer, not a gate. Someone
who means to point a squad at a scratch directory is allowed to.

**Starting refuses a nested repository.** If the folder is already inside a
work tree, `git init` would create a repository within a repository, which is
rarely meant and awkward to undo. The call returns the existing context
instead.

**Every git call is bounded and silent.** Four seconds, `GIT_TERMINAL_PROMPT=0`
and `GIT_OPTIONAL_LOCKS=0`, so a repository with an unreachable remote or a
held lock cannot hang the first screen someone ever sees.

## Consequences

- The profile cache is invalidated when tracking starts, or the screen would
  keep saying "not tracked" for up to a minute after it was.
- Git missing from the machine is handled by saying nothing rather than
  showing a broken offer; `available: false` hides the line.
- `git init` is the whole action. No first commit, no `.gitignore`, no remote.
  Those are choices about a person's project that an onboarding screen has no
  business making, and the recoverability that matters starts at `init`.
- Verified end to end against a real untracked folder: the line appears with
  its button, the click initialises, and the line becomes "Tracked by git on
  main. Commits here will be from Igor Costa."
