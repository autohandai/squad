# ADR-0015: Folder profiles and squad recruiting

Date: 2026-09-24 · Status: accepted

## Context

Channels can hold project folders and members have roles and skills, but the
two never met: a channel with a frontend developer and a newly added Rust
service kept quiet. The bridge already knows how to find workspaces by marker
files; it did not describe what a folder is.

## Decision

- **Folder profile** (`server/workspace-profile.mjs`, `POST
  /api/workspaces/profile {path}`): a cheap, deterministic description built
  from marker files, `package.json` dependencies, and file extensions in the
  top two directory levels. Output: `languages`, `frameworks`, `needs`
  (`frontend`, `backend`, `mobile`, `infra`, `tests`, `docs`, `data`,
  `security`, `ai`), a one-sentence `summary`, and a `signature` (stable hash
  of the inputs) used to key proposals and cached suggestions. No file
  contents are read except `package.json`; `node_modules`, build output, and
  dotfolders are skipped; a scan stops after 4000 entries.
- **Matching** (`src/lib/squad-recruiting.js`, pure): each role template maps
  to the needs it serves. `proposeMembers({ profiles, members, candidates })`
  returns candidates who serve a need that no current member serves, ranked
  by how many uncovered needs they serve, capped at two. The same function
  ranks role templates for onboarding (`suggestRoles`).
- **Proposals** live in local channel state keyed by `channelId + agentId +
  signature`, with status `open`, `accepted`, or `dismissed`. They render as a
  user-only notice in the channel stream (`JoinProposal`): "Kai wants to join
  #client-abc — DevOps engineer. He can help with the Dockerfile and CI in
  api; nobody in the channel covers that." Add calls the existing
  `toggleChannelMember`; Not now dismisses for that signature. Proposals are
  never sent to members, never enter teammate context, never appear in
  exports, and never count as unread.
- **Trigger**: when a channel's projects change and when a channel opens
  while a project has no proposal computed for its signature. Profiles are
  cached in memory per path and signature for the session.
- **Setting**: `chatSettings.squadSuggestions` (default `true`), exposed in
  Settings → Chat.
- **Chat timeouts** (same release): `collectSdkPrompt` treats its timeout as
  an inactivity window that resets on every SDK event, with a 45-minute hard
  ceiling, so a member running tools is not cut off mid-turn.

## Consequences

- Recruiting is advisory. Membership only changes through the user's click.
- Profiles are approximate by design; a wrong guess costs one dismissed
  notice. Precision improves by extending the marker table, not by reading
  more files.
- The profile endpoint is reusable by future features (member creation
  defaults, workspace cards).
