# ADR-0203: Private groups share conversation storage, with explicit lifecycle actions

Status: Accepted

## Context and evidence

The owner asked for genuine private groups, app/MCP parity, retained history
when converting a group to a public/private channel, and a recipient chooser
instead of Direct Messages → + immediately creating a generic member.
The old `create_group_chat` tool only created a private channel. App
normalization discarded any kind metadata, and the sidebar treated every
conversation as a channel.

`scripts/check-group-chats.mjs` first failed at the real owned HTTP boundary
for creation, conversion and deletion. Subsequent regressions exposed a
less obvious risk: adding a kind field alone was insufficient. Legacy PUT
snapshots omitted a group entirely, removing its history without a tombstone;
snapshots retaining the group row could still omit newer messages and threads;
kind-less future-dated sync records could also reverse a conversion's name
and visibility. Preserve these observations: timestamp ordering does not
establish a client's knowledge of a lifecycle transition.

Managed tests also found a valid 128-character request ID plus an 80-character
actor prefix exceeded the first internal 200-character limit. The internal
limit is now 256 while the public schema remains 128. A missing private ID
initially returned 404 while an unassigned group returned 403; both now use
the same managed refusal. Operator not-found remains 404.

The browser regression first timed out waiting for an inline composer, because
the old plus opened the creation popover. The rendered check now exercises
recipient search, multi-selection, group creation/conversion, selecting an
existing chat and explicit named-member creation with automatic execution
defaults. Public tests use isolated owned fixtures, never the person's data.

## Decision

Use additive `kind: group | channel` in the existing serialized channel
store. Do not infer kind from private visibility or migrate historical
private channels. Group creation requires 2–20 distinct saved members.
Conversion and deletion are explicit, serialized actions. Conversion retains
the ID, messages, threads and membership; deleting a group records the
existing channel tombstone. A converted channel cannot be deleted by a stale
group-delete request.

Creation and conversion accept stable request IDs. Persist payload fingerprints
to make identical replay safe without overwriting later edits. Serialize
membership checks with mutations. Managed calls derive actor scope from the
active work credential and reuse current management permissions and deadlines.
List/read only expose assigned groups; mutations default to Ask first.

Preserve lifecycle metadata across ordinary app normalization. The store
protects managed conversations and their history from legacy snapshot
omission. A conversion fingerprint fences stale snapshots that cannot
represent the transition, including kind-less records with later timestamps.

Advertise tool-contract version 2.1.0 on both MCP transports. Add list/get/
create/convert/delete group tools with shared schemas and handlers; existing
channel message/thread tools address the same ID. No parallel transcript,
queue, group database or dispatch engine is introduced.

Direct Messages → + navigates to an inline recipient page with existing
avatars and selection controls. One recipient opens their ordinary chat;
multiple recipients create a private group before opening its ordinary
message composer. New member asks for name, role and responsibilities and
uses the canonical creation API, including connected harness defaults and
failovers. No placeholder or greeting is created on entry or cancellation.

## Consequences and deliberate limits

App and MCP observe one lifecycle/history, and old clients cannot silently
undo it. Groups remain internally compatible with channel message, thread,
workspace and responder machinery; some advanced settings retain channel
terminology. This is not a separate multi-human chat service.

Request IDs are optional for external group tools, so callers omitting them
must inspect saved state after a lost acknowledgement rather than blindly
retry. Ordinary channel sends retain their existing non-idempotent contract;
this decision does not claim exactly-once message delivery. Public conversion
intentionally exposes existing history within the selected Squad and says so
in the app before confirmation. Existing channel deletion semantics remain.

The recipient chooser opens the ordinary conversation composer; it does not
send work during recipient selection. Older conversational member-creation
entries elsewhere remain available. The new DM path does not create a work
folder: the normal chat's explicit default-folder consent still applies.

Verification: `check:group-chats` covers owned lifecycle, private visibility,
legacy snapshots, tombstones, actor filtering, schema bounds, concurrent
conversion/delete and restart/replay. `check:group-chats:browser` covers the
rendered flow at desktop and phone widths. `check:control-plane` and
`check:team` exercise actual operator and managed stdio discovery/calls.
Controlled fixtures do not establish installed-app, live-provider or release
publication proof.
