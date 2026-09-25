# ADR-0022: Git as a first-class object in channels

Date: 2026-09-26 · Status: accepted

## Context

Channels hold project folders and members run against them, but branches,
commits, pull requests, and CI only ever appeared as prose ("we're five
behind origin/main"). Nothing was linkable, nothing updated on its own, and
a review could not point back at the PR it judged. The bridge already
shells out to `git` for context packs; `gh` is on most developer machines
and already gates GitHub work through the permission ladder.

## Decision

- **Binding.** A channel may bind one repository: `channel.git =
  { repoPath, remote, branch }`, chosen in channel settings › Repository
  (folder picker, branch, remote). Binding validates the folder with
  `git rev-parse` and the branch with `rev-parse --verify`; the first poll
  runs immediately so the last five commits appear at once.
- **Events, not messages.** Git facts enter the stream as
  `{ role: "event", kind: "commit"|"pr"|"ci", ref, title, url, status,
  createdAt }` rows in `channel.events`, merged into the message list by
  time on the client. They are never sent to members as messages, never
  count as unread, and never carry a body for a model to read.
- **Deterministic ids.** `git-commit-<sha>`, `git-pr-<number>`,
  `git-ci-<sha>`. A poll that sees the same object again produces the same
  id and is dropped; a pull request whose state moved keeps its id and its
  row updates in place (open → approved → merged), which is how "PR events
  update status on merge" holds without a growing tail of rows.
- **Polling.** One 30 s poller per bound channel in
  `server/routes/git.route.mjs`: fetch `remote/branch`, log the branch and
  its upstream, `gh pr list --state all` filtered to the branch, and
  `gh run list --commit` for the two newest commits (terminal CI results are
  cached). Each poll diffs against the previous snapshot, merges into the
  persisted events, mirrors into `channels.json`, and emits `git.event`.
- **Degrade, never throw.** Every helper in `server/git/status.mjs` returns
  `{ error }` when `git` or `gh` is missing, signed out, or the folder is
  not a repository. Without `gh` a channel still gets commit rows; the
  status endpoint reports `gh.available` so the UI can say why PRs are
  missing.
- **Pushing and PRs stay behind the ladder.** `POST /api/git/pr` refuses
  below `open-pr` (rank 5) with a 403 that names the level; the level
  comes from the request, because members and their permissions live in
  the browser. The route pushes the head branch first (`git push -u`) and
  then `gh pr create`; both are approvals at that level in the ladder, so
  the client asks before calling.
- **Source of truth.** Bindings and events persist in
  `~/.autohand/squad/git-watch.json`, owned by the route, and are mirrored
  into `channels.json` (`channel.git`, `channel.events`). The monolith's
  channel normalizers must learn the two fields for the mirror to survive
  the app's own writes (`docs/integration/git.md`).

## Consequences

- The poller shells out synchronously; with `fetch` and three `gh` calls it
  can hold the event loop for a second or two every 30 s per bound channel.
  Acceptable for a handful of channels; move to async spawns before making
  binding a default.
- Events are per channel, not per repository: two channels bound to the
  same branch each poll and each keep their own rows. Simple and isolated;
  revisit if many channels share one repository.
- Only GitHub is understood for PRs and CI (through `gh`). Other hosts get
  commits and remote links only.
- Rewritten history (rebases) can surface old-dated commits as new rows;
  the ids stay unique so nothing duplicates, but the stream shows them at
  their author time.
