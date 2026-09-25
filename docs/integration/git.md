# Git in channels — integration note

Module files (ADR-0022): `server/git/status.mjs`, `server/git/events.mjs`,
`server/routes/git.route.mjs`, `src/lib/git-events.js`,
`src/components/channels/GitEventRow.jsx`,
`src/components/channels/RepositorySettings.jsx`, `scripts/check-git.mjs`.

## Routes (auto-loaded from `server/routes/git.route.mjs`)

| Route | Body / query | Returns |
| --- | --- | --- |
| `GET /api/git/status?workspace=&branch=&remote=&fetch=1` | | `{ branch, head, ahead, behind, upstream, dirty, changedFiles, recentCommits: [{ sha, short, title, author, at, url }], remoteUrl, webUrl, pullRequests, gh: { available, error }, error? }` |
| `POST /api/git/watch` | `{ channelId, repoPath, remote?, branch? }` | `{ binding, status, events, added }` — polls immediately, so `added` already holds the last five commits |
| `GET /api/git/watch/:channelId` | | `{ binding, status, lastPollAt, events }` |
| `GET /api/git/watch` | | `{ bindings, watching }` |
| `DELETE /api/git/watch/:channelId` | | `{ channelId, removed }` (events are kept) |
| `POST /api/git/pr` | `{ workspace, title, body?, base?, head?, draft?, push?, permissionLevel, channelId? }` | `{ url, number, head }`; **403** below the ladder level, **502** when `gh`/`git push` fail |

`permissionLevel` is the member's ladder id from `AUTONOMY_LADDER_LEVELS`
(`permissions.ladderLevel`, or `recipe.permissionLevel` for a recipe run).
PR creation needs **`open-pr`** (rank 5) or `auto-merge-disabled` (rank 6);
`ladderAllowsPullRequest()` in the route is the single check. Pass it as
the id string; a numeric rank is also accepted.

Polling is every 30 s per bound channel (`POLL_INTERVAL_MS`), fetches
`remote/branch` first (so commits pushed elsewhere are seen), and diffs the
snapshot (commits on the branch and its upstream, PRs whose base or head is
the branch via `gh pr list --state all`, CI for the two newest commits via
`gh run list --commit`). Without `gh` the channel still gets commit rows.

## Events

- Emitted on the bus: `git.event { channelId, change: "added"|"updated", event, at }`.
  Notifications/audit modules may subscribe; nothing else is required.
- Event shape: `{ id, role: "event", kind: "commit"|"pr"|"ci", ref, title, url, status, author, createdAt, updatedAt, sha?, number?, branch? }`.
  Ids are deterministic (`git-commit-<sha>`, `git-pr-<n>`, `git-ci-<sha>`); a
  PR or CI row keeps its id and updates `status` in place (open → merged).
- Persistence: `~/.autohand/squad/git-watch.json` (owned by the route) and
  mirrored into `channels.json` as `channel.git = { repoPath, remote, branch, boundAt }`
  and `channel.events = [...]`.

**Monolith change needed (one line each):** `normalizeChannel()` in
`server.mjs` and `normalizeChannelCopy()` in `src/App.jsx` currently drop
unknown fields, so the app's own `PUT /api/channels` mirror erases `git` and
`events` until the next poll. Add to both:

```js
git: item.git && typeof item.git === "object" ? item.git : undefined,
events: Array.isArray(item.events) ? item.events : undefined,
```

Until then, read events from `GET /api/git/watch/:channelId` (below).

## Web app wiring

1. **Channel settings › Repository.** In the channel header settings popover
   (`App.jsx`, the `PopoverContent` holding Auto mode and Projects), add a
   `<Separator />` and render:

   ```jsx
   <RepositorySettings
     channel={channel}
     status={gitStatusByChannel[channel.id]}
     busy={gitBusy}
     error={gitError}
     copy={copy}
     onPickFolder={async (start) => (await api("/api/workspaces/pick", { method: "POST", body: JSON.stringify({ title: `Bind a repository to #${channel.name}`, start }) })).path}
     onBind={async (binding) => {
       const data = await api("/api/git/watch", { method: "POST", body: JSON.stringify(binding) });
       onUpdateChannel(channel.id, { git: data.binding, events: data.events });
       setGitStatusByChannel((s) => ({ ...s, [channel.id]: data.status }));
     }}
     onUnbind={async (channelId) => {
       await api(`/api/git/watch/${channelId}`, { method: "DELETE" });
       onUpdateChannel(channelId, { git: null });
     }}
   />
   ```

   `data.events` from the bind response already contains the last five
   commits, so the stream fills the moment the folder is bound.

2. **Events in the stream.** Where `ChannelStream` receives `messages`, pass
   `mergeEventsIntoStream(messages, channel.events)` (from
   `@/lib/git-events`) instead. In `ChannelStream`, before the ordinary
   `<article>`, render an event row for `message.role === "event"`:

   ```jsx
   if (isGitEvent(message)) return (
     <Fragment key={message.id}>
       {showDay ? <Divider label={day} /> : null}
       <GitEventRow event={message} copy={copy} locale={locale} onReview={onReviewPr} onOpen={onOpenUrl} />
     </Fragment>
   );
   ```

   Keep the day divider logic; skip the compact-author grouping for events
   (they carry no author row). `onReview(event)` should start a run for the
   channel's reviewer member with `event.url` in the prompt (same path as
   "Ask a member"); `onOpen(event)` opens `event.url` in the system browser
   (`window.open` fallback is built in when `onOpen` is omitted).

3. **Keeping events fresh.** On channel open and every 30 s while it is
   visible, `GET /api/git/watch/${channel.id}` and
   `onUpdateChannel(channel.id, { events: data.events })` when the length or
   last `updatedAt` differs. Once `git.event` is forwarded over SSE by the
   notifications module, replace the interval with that subscription.

4. **PR from a run.** The run action "Open PR" calls
   `POST /api/git/pr { workspace, title, body, base: channel.git?.branch, permissionLevel: permissions.ladderLevel, channelId }`
   and posts the returned `url` as a member message. The route refuses
   below `open-pr`, so the button should be disabled with the ladder hint at
   lower levels rather than surface a 403.

5. **Run-trace commit links.** When rendering a run's trace or a reply in a
   bound channel, wrap the markdown with
   `linkCommitsInTrace(text, channel.git?.remoteUrl || status.remoteUrl, { knownShas: channel.events.filter(e => e.kind === "commit").map(e => e.sha) })`
   so each sha becomes a link to the remote commit page.

## Scripts and copy

- `package.json`: `"check:git": "node scripts/check-git.mjs"`.
- `src/locales.js` (`en`), all with literal fallbacks in the components:
  `gitRepository` "Repository", `gitRepositoryDetail`, `gitFolder`
  "Repository folder", `gitFolderPlaceholder` "Folder path", `gitBranch`
  "Branch", `gitRemote` "Remote", `gitBind` "Bind", `gitUpdateBinding`
  "Update", `gitUnbind` "Unbind", `gitNotBound` "Not bound to a repository.",
  `gitWatching` "Watching", `gitAt` "at", `gitAhead` "ahead", `gitBehind`
  "behind", `gitChangedFiles` "changed files", `gitLastCommit` "last commit",
  `gitReview` "Review", `gitOpen` "Open", `gitStatusCommitted` "Committed",
  `gitStatusDraft` "Draft", `gitStatusOpen` "Open", `gitStatusApproved`
  "Approved", `gitStatusChangesRequested` "Changes requested",
  `gitStatusMerged` "Merged", `gitStatusClosed` "Closed", `gitStatusRunning`
  "Running", `gitStatusPassed` "Passed", `gitStatusFailed` "Failed",
  `justNow` "just now", `yesterday` "yesterday".

## DESIGN.md addition (Squad Channels)

- Git events (commits, pull requests, CI) are one-line muted rows between
  messages, indented to the message text column: icon, short ref, title,
  a dot-and-word status, time on the right. No cards, no coloured fills;
  status colour follows the presence dots. Pull request rows reveal Review
  and Open on hover. The Repository section in channel settings is two
  inputs, one status sentence, and Bind/Unbind.
