# ADR-0023: Canvases

Date: 2026-09-26 · Status: accepted

## Context

Plans, specs, and reports that a person and squad members work on together
had nowhere to live: they were chat text, or a file somewhere in a
workspace that the app could not show, attribute, or revert. Members already
receive extra folders on a run through `--add-dir`, and the bridge already
diffs nothing after a run. Issue #31 asks for a shared Markdown document per
channel or member, with attributed and reviewable member edits, attachable to
a prompt.

## Decision

- **One store, one file per run.** `server/canvases/store.mjs` keeps every
  canvas in `~/.autohand/squad/canvases.json` (`id, ownerType, ownerId, title,
  body, createdAt, updatedAt, revisions[]`). A member does not talk to the
  store: `materialize` writes the body to `<stateDir>/canvas/<id>.md`, the run
  receives that directory as an extra `--add-dir`, and `absorb` reads the file
  back afterwards. Members edit a plain file with the tools they already have;
  nothing is taught about a canvas API.
- **A revision is a whole body, appended only on change.** `update` and
  `absorb` compare normalized bodies (LF, capped size) and append exactly one
  `{ id, authorId, at, body, summary }` when they differ. Title edits, identical
  saves, and re-absorbing an untouched file record nothing. `revert` restores
  an earlier body as a new revision, so history is append-only and every
  state the canvas was in is still reachable. Two hundred revisions are kept.
- **Attribution by construction.** The user's edits carry `authorId: "user"`;
  a run's absorb carries the member id from `run.finished`. The route plug-in
  subscribes to `run.finished` and absorbs when the run object carries
  `canvasId`, so member edits become revisions without a second round trip.
  Chat replies, which have no run object, absorb from the web app.
- **Review is a line diff, not a merge.** `src/lib/diff.js` is an LCS line
  diff with prefix/suffix trimming; the panel shows a selected revision against
  the one before it with Accept (keep) and Revert (restore the previous body).
  No CRDT, no concurrent editing: the last write wins, and the rail makes
  every write visible.
- **Mentions are slugs.** `@canvas:<slug>` fits the composer's existing
  trigger character set, so the picker and keyboard insertion work unchanged.
  The first mentioned canvas is materialized and passed as `canvasId` /
  `canvasDir`; others are inlined read-only.
- **Search by event.** Plug-ins do not fetch the bridge; every body change
  emits `canvas.updated` and the search module indexes from the bus.

## Consequences

- Concurrent edits (a user save during a member run) resolve to two revisions
  in order; neither is lost, but the second wins the body. Acceptable for the
  stated non-goal of real-time collaboration.
- Whole-body revisions make `canvases.json` grow with document size times
  edits; the 512 KB body cap and 200-revision cap bound it. A future move to
  per-canvas files would keep the same store API.
- The materialized file lives outside any workspace, so a member sees it only
  when a run is launched with the canvas attached; it is not a persistent
  project file.
- `server.mjs` gains three one-line `--add-dir` additions and a `canvasId`
  field on runs (see `docs/integration/canvases.md`); nothing else changes.
