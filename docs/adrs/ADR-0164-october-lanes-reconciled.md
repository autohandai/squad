# ADR-0164: The October bug-hunt lanes, reconciled into 0.1.16

Date: 2026-11-03
Status: Accepted.

## Context and evidence

Asked to check which branches were merged into main and to fold the rest
into the next release, the repository had, besides `main`:

- three lane branches from the 18–19 October bug hunt, `lane/agents-100`,
  `lane/hunt-explore` and `lane/hunt-leftovers`, never merged; the last
  contains the other two except four commits;
- `cto/device-login-recovery-20261023`, local and on GitHub;
- `fix/grut-light-mode`, a 19 October snapshot;
- two Codex snapshot branches, `wip/memory-inbox-3297` and
  `wip/project-access-eecf`;
- four open Dependabot pull requests;
- twelve local branches already merged (`codex/rc5-windows-smoke-hotfix`
  and eleven `worktree-agent-*` branches).

`git merge-tree` put 22 files and about 130 hunks in conflict for the lane,
mostly in `server.mjs`, `server/team/service.mjs` and `src/App.jsx`. `git
cherry` found none of the 88 lane commits patch-identical on main. The first
reading was that they were all missing. That was wrong: main's ADR-0134
("integrated and extended 2026-10-20") and commit 71cc097 had re-implemented
much of the lane in rewritten form, so a plain merge would have laid the old
implementation back over the newer one. The merge was aborted.

Each of the 88 commits was then checked by behaviour against main's current
code, in three read-only passes of about thirty commits. Roughly half were
already present on main (the team MCP server, squad_message waits, former
names, the 200-entry memory limit, concurrent MCP requests, ACP team server,
Autohand turn context and many smaller ones), a few were docs or obsolete,
and about 45 behaviours were missing.

## Decision

1. **Port what is missing, one commit per fix, onto a branch from main**
   (`merge/0.1.16`), with the lane's message and author, rather than merging
   the lanes. Main's `CHANGELOG.md` and `DESIGN.md` win on conflict; the
   lane's built `dist/` and its report fragments are left out; this record
   and the changelog carry the docs instead.
2. **Rewrite where main moved on**, and say so in the commit:
   - quiet notifications for agenda runs and automation drafts are keyed on
     `payload.agenda` and `automationDraft`, not on `ephemeralSession` as on
     the lane, because main's scheduled routine runs are ephemeral too and
     their notification is the reminder itself;
   - removing a member deletes its bridge routines and declines its schedule
     proposals, then reloads routines; main has no local removed-routine list;
   - only routine answers from the last two days, and from the current
     conversation, become direct messages, inside main's
     `reconcileAutomationReplies`;
   - Team memory keeps a load error apart from a failed save and says when a
     fact was already saved, in main's scoped section;
   - the routine dispatch keeps main's member launch policy where the lane
     had hard-coded "restricted".
3. **Guard a side effect the lane did not have to think about.** Recording a
   teammate's squad_message answer as `chat.finished` would also have woken
   two listeners: a failed delivery posted "could not reply" to the desktop
   for a message the person never sent, and the agenda counted it as the
   person being active. Both now ignore events that carry `teamFromName`.
4. **Merge the Dependabot bumps that build**: GitHub Actions (setup-node
   7.1.0, upload-artifact 7.0.2, download-artifact 8.0.2, with the release
   check's pins moved to match), the rust-runtime group and base64 0.23 in
   the daemon. The lockfile keeps base64 0.22 where hyper-util needs it.
   **sha2 0.11 stays out**: its pull request fails every runtime check
   because the digest API changed.
5. **Delete what is merged or superseded**, tagging each tip as
   `archive/<branch>` locally first: the twelve merged local branches, the
   sign-in recovery branch (its tree is identical to PR #44's merge,
   99150bb), the light-mode snapshot (main's ADR-0146 fixes Grut in light
   mode and the blobs' eyes) and, after this lands, the three lanes.

## Consequences

- 0.1.16 carries about 45 fixes from the October hunt: Codex resume, tool
  approval, MCP results and stream retries; engine option errors; the
  "Reflection:" preamble; routine prompts, claims, past Once times, loose
  times and replies; schedule parsing ("6.30pm"); memory, proposals and
  handoffs; channel ordering, settling and chips; a member-not-found page.
- Left out on purpose: the lanes' report fragments (their findings are in
  the commit messages and here), the optional Team memory "full" line from
  8ef9998, and posting failed or missed routine runs into direct messages
  (the gap noted under e5343a6).
- Not merged and not deleted: the two Codex `wip/*` snapshots. They sit on a
  rewritten older history with no common ancestor and change `App.jsx` by
  about 1,500 lines; whether anything in them is still wanted is the owner's
  call. Their worktrees under `~/.codex/worktrees` belong to that app.
- `bun run ci` stops locally at `check:acp`, on main as well, at a skill
  scope guard added by another session this morning (f1962fa). GitHub's CI
  workflow does not run that check. It is left to that work.
- Porting by commit kept each fix reviewable and kept each lane commit's
  author and date; the history shows them as new commits on main, not as
  merges of the lanes, so `git branch --merged` will never list the lanes.
