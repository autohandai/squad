# ADR-0204: Channel creation lives in the main view

Status: Accepted

## Context and evidence

The owner reported two disconnected experiences: sidebar + opened a creation
popup, while deleting a channel showed an empty page with another Create
channel button. They requested the existing name, visibility, member and auto
controls on that page, with current-member avatars, and no creation popup.

`scripts/check-channel-lifecycle.mjs` already exercised the public app and
owned HTTP channel lifecycle. Its fixture still seeded unowned browser keys
and read members from them. Move that fixture to the owned registry/browser
setup and select its known saved Eva identity. The added inline-page assertion
then failed against the real sidebar popup (`role=dialog` was present).

## Decision

Render one ChannelCreateForm in the main Channels view whenever no channel is
selected. Sidebar + and the desktop New channel action navigate there. The
ordinary deletion action already navigates to the same route, so it now shows
the useful form directly rather than another button. Remove the sidebar's
parallel dialog and creation-request counter.

Keep the existing saved-channel API and stable submission ID. Name, explicit
visibility, selected members and auto mode are one form; pending writes disable
its controls, failures retain the draft and successful acknowledgement opens
the saved channel. Member selection uses the actual supported avatar renderer
in a horizontal deck, with pressed state and accessible names. Empty squads
explain that specialists can be prepared after the channel goal is described.
The existing goal/team preparation flow remains the next step after creation.

## Consequences and deliberate limits

The form has more space and one location instead of independent dialog state
in the sidebar and channel page. Leaving it intentionally discards its local
draft; this decision does not introduce cross-window draft synchronization.
The avatar deck scrolls horizontally for larger squads, avoiding a grid of
cards. Ordinary channel settings still open in their existing side sheet.

This slice does not complete the separate requested channel context menu or
notification policy work; those remain on the release checklist. It does not
create members, folders or Git repositories merely by opening the form.

Validation uses the existing owned HTTP/browser lifecycle boundary: sidebar
entry without a dialog, current member avatar, retained duplicate-name error,
successful retry, normal settings edits, member/project changes, restart and
delete returning directly to the inline form. Canonical member registration
can give a channel an initial project, so the fixture checks the newly added
folder rather than assuming the entire project list initially has length zero.
No installed-app or live-model proof is claimed by that browser check.
