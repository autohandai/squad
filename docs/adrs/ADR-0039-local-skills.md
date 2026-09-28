# ADR-0039: Skills you already have

Date: 2026-09-28
Status: Accepted

## Context

A user, on their first day in the app:

> It feels like I have walked into someone else's dev shop. If I can get
> better access to skills that already exist in my $HOME that would help a
> lot, eg .autohand/skills, .agents/skills, .claude/skills.

Skills resolved from one place: the Skilled catalog over the network. A skill
sitting in `~/.claude/skills` was invisible, and a member configured to use it
failed with "not found in Skilled catalog". On the machine this was written
on, 127 skills were present in those folders and none of them were reachable.

That also explains a separate symptom reported the same week: an Inbox buried
under rows reading "Autohand skill X failed to install: not found in Skilled
catalog". Those members were asking for skills the person already had.

## Decision

**Look on the machine first.** `server/skills/local.mjs` scans, in order, the
workspace's `.autohand/skills`, `.claude/skills` and `.agents/skills`, then the
same three under the home directory. The workspace answers first because a
skill checked in beside the code is the more specific answer to which one was
meant. A skill is a directory holding a `SKILL.md`, which is the shape Claude,
Autohand and the agents convention all share, so one reader covers all three.

**Installing copies the whole folder**, not just `SKILL.md`, into the member's
isolated skills directory, so a skill with references or scripts arrives
intact.

**The catalog endpoint offers local skills first**, marked as local, and no
longer returns nothing when the network is unavailable. The skills a person
already has are the ones that always work.

**A failure names where it looked.** "Not in the Skilled catalog, and no
SKILL.md under 3 local skill folders" tells someone what to do next; "not
found in Skilled catalog" did not.

## Consequences

- Squad reads directories the person did not create for it, including
  `~/.claude/skills`. It only reads, and only from three fixed folder names.
- Two skills with the same folder name in different roots are one skill, the
  nearest root winning. There is no namespacing, which matches how the
  underlying tools already behave.
- A skill folder is copied at provisioning time, so later edits to the
  original do not reach a member already provisioned with it. That matches how
  catalog skills behave and keeps a member's skills fixed while it runs.
- Reading is bounded at 200 files and 2 MB per skill, so a folder with a large
  checkout in it cannot stall provisioning.
- Not done: no UI yet for browsing local skills by folder, and no way to point
  at a fourth directory. Three names cover what was asked for.
