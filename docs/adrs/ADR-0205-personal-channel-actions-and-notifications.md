# ADR-0205: Personal channel actions and notification preferences

## Context and evidence

The owner requested equivalent right-click/ellipsis rename/delete actions and
All new posts, Just mentions, and Mute and hide choices with Settings defaults.
Inline creation already exists (ADR-0204); preferences must not change a
conversation's saved roster, dispatch work, or become shared agent authority.

The first rendered check could not find a channel action trigger. The first
owned HTTP check found no inherited notification default. Existing notification
events covered run/approval/handoff outcomes, but no canonical saved-post
observer. The browser's old mention emitter used `hasMentions`, so mentioning
an agent could incorrectly notify the person. A focused regression also showed
that using a member's direct-chat route to suppress a channel post hid a
notification for a different conversation.

Evidence is executable in `scripts/check-channel-actions-browser.mjs` and
`scripts/check-channel-notifications.mjs`. They use the owned HTTP boundary
and an actual browser rather than component internals. A disk-write fault
proves failed settings return 500 and retain the earlier values. The actual
stdio control-plane check exercises the new operator tools and a refused
unconfirmed deletion. An initial assertion expected a tool error for the
schema-invalid `confirm_delete:false`; the protocol correctly rejects it as
JSON-RPC -32602, so the assertion was corrected, without weakening validation.
The 390px screenshot then exposed squeezed conversation names overlapping
their selects even though the page had no horizontal overflow. Names now take
their own line on small screens; the rendered check verifies separation.
Review also caught that a team-owned dataset is shared by successive human
actors. Keeping its single `notifications.json` would share personal hiding
and feed state. A real broker/worker regression first reproduced adoption of
the old team's muted default, then verifies Alice/Bob/Alice isolation on the
same team and shared conversation.

## Decision

- Define channel preference normalization once for browser and server. Store
  defaults and per-ID mode/visibility overrides in the selected owner's existing
  notification file. Ignore replacement override maps from global/legacy writes.
  Serialize read-modify-write and acknowledge settings only after persistence.
  For team datasets, select `notifications-<verified actorKey>.json` using the
  existing issuer/subject digest; personal datasets keep `notifications.json`.
  Old team files remain untouched rather than assigning them to the next actor.
- Compose one action definition into registry shadcn ContextMenu and DropdownMenu
  primitives. Rename preserves history and roster; delete requires a second
  selection. Recover hidden conversations through Hidden channels and Settings;
  showing one does not enable alerts. Groups use the same preferences/actions.
- Observe saved completed member messages through existing `channels.changed`.
  Baseline complete history and receipt IDs prevent startup/replay alerts.
  Derive personal mentions from the verified owner, not another member's handle.
  Suppress a post when its channel is visible, never merely the author's DM.
- Publish preference changes on the existing scoped live stream. Add operator
  read/default/override tools and confirmed channel deletion, versioned as MCP
  contract 2.2.0. Managed agents receive no personal-preference authority.
  Contract version is distinct from app, backup and MCP wire-protocol versions.

## Consequences and limits

Hiding is reversible and local to the selected owner's preferences; it never
leaves a channel or stops its agents. Global muted defaults do not hide every
channel automatically. Explicit overrides survive later default changes.
Legacy clients keep the previous five boolean settings and cannot erase the
new override map with an older snapshot.
Team notification files are private to the acting account as well as the team
and dataset. Historical team files have no reliable human attribution; they
are preserved but not auto-imported into a human's new feed or preferences.
There is no automatic migration or new recovery UI for those old preferences.

Saved-post alerts are at most once per running observer, not guaranteed durable
delivery. A failure during publication has no new retry worker; OS permission,
Focus and system configuration still control visible banners. The existing
independent run/approval/handoff policies remain: a run finishing and a member
publishing in a channel are separate events. Muted preferences suppress only
events carrying that conversation ID, not unrelated work or Needs you.

The stdio catalog stays fixed for the process lifetime. `initialize` supplies
`serverInfo.version`; upgrading files does not update an existing process.
Reconnect and reload tools after upgrading. This change does not claim live
upgrade notifications or a Desktop version comparison UI, and does not
advertise unsupported `tools.listChanged` notifications.

Browser/HTTP/stdio evidence is separate from installed-app, visible native
notification and published-release proof. No installed app is replaced here.
