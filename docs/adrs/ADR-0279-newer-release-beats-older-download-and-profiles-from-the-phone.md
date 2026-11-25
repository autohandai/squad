# ADR-0279: A newer release beats an older download; the card's pen edits; phones edit profiles

Status: accepted, 2026-11-26

Three judgements from one owner report (26 Nov), recorded together because
they shipped together.

## 1. A newer release beats an older download

### Context

The owner's Mac had 0.1.22 installed. 0.1.22 could not Install and restart
while another app used Squad's MCP server (ADR-0277), so it fell back to the
system installer for 0.1.23. 0.1.24 then shipped the fix. Settings › Updates
showed "Installer opened · Open installer again · Check for updates" with
"Installed version 0.1.22, Latest public release 0.1.24", and the sidebar
showed the same. Their saved operation
(`owners/<hash>/datasets/<id>/app/updates/operation.json`) read
`{"phase":"installer-open","version":"0.1.23","verified":true,...}`.

What the old code did with that:

- `updateView` titled the `installer-open` phase "Installer opened" whatever
  the latest release was. Only `complete` and `cancelled` receipts yielded to
  a newer release.
- `updateInstallAction` offered "Open installer again", which reopened the
  0.1.23 DMG: the release the fix replaced.
- `automatic-updates.mjs` skipped any phase except idle, complete, failed or
  cancelled, so automatic download never fetched 0.1.24 while a 0.1.23
  installer was "open". The installer state never expires on its own.
- "The update didn't finish" offered Try again, which retried 0.1.23.

### Decision

- A `ready`, `failed` or `installer-open` download whose version is older
  than the latest allowed release is superseded: `updateView` treats it as
  idle (`superseded: true`), so every surface says "Version 0.1.24 is
  available" with Download.
- Automatic download treats a superseded `ready` or `installer-open` like
  idle and fetches the newer release. It still never installs.
- While the installer for the latest release is open, the title is
  "Version X is available"; the installer sentence is the description. The
  person has not updated until the installed version changes.
- The failed-update screen offers "Download X" instead of Try again for a
  superseded download.

### Consequences

- Only copies with this change behave this way. 0.1.22 and 0.1.23 users who
  are stuck on an old installer need the release page once, as ADR-0277
  already says.
- Checked with `check-desktop-updates.mjs` (stale installer-open, ready and
  failed for 0.1.5 under 0.1.6; open installer for the latest) and
  `check-automatic-updates.mjs` (an open 0.1.17 installer, then 0.1.18:
  downloaded, not installed). `verify-work-profile-browser.mjs` now looks for
  the installer sentence instead of the old title.

## 2. The member card's pen edits the profile; the face changes the avatar

### Context

The member card (the chat header's name) had a pen that opened the bird
picker and an eye that opened the profile. The owner: "when I click edit
icon I want to go and check the profile, and when I hover show the edit icon
for the profile picture, to change the avatar". Hovering the face showed
only a native "Change avatar" tooltip.

### Decision

The pen goes to the profile with Edit Profile open
(`/squad-members/<id>/home?edit=profile`; the query is dropped after opening
so Back and reload show the profile). Hovering or focusing the card's face
shows a pen over it, and clicking the face opens the bird picker. The
profile's photo card shows the pen beside "Change avatar" on hover.

### Consequences

The card has no direct "change avatar" button any more; the face is the
only way to change it from the card, as it already was on the profile
(ADR-0243). Checked in `check-read-aloud-browser.mjs` 4c (pen over the face,
pen lands on the profile with Edit Profile open, no query left).

## 3. Phones read and edit member profiles

### Context

The owner wanted to see and edit a member's profile from Squad for iPhone,
believing profiles were already stored per account in the cloud. They are
stored per signed-in account on each computer (the owner's dataset, with
`profileRevision`). `server/squad-cloud/` syncs team memory only.

### Decision

Mobile contract 0.10, capability `profiles`. `member.profile` returns the
control-plane profile shaped for the phone. `member.update` patches name,
role, description and instructions through
`PATCH /api/control-plane/members/:id` with the phone's `expectedRevision`.
That is the endpoint the desktop and MCP use, so the profile limits and the
stale-revision refusal are shared. A read-only Squad refuses the edit. The
desktop picks up the change through the existing bridge-profile merge
(`mergeMemberProfile`), as it does for a voice changed on the phone.

### Consequences

- The phone cannot change avatar, personality or skills. The avatar sits
  outside the revisioned profile and only a member may set it through a
  patch (ADR-0243), so a phone avatar needs its own decision.
- Profiles are not synced to Squad's cloud or between computers. Doing that
  needs an API and storage on squad.autohand.ai and a conflict policy; it was
  not built here.
- Checked in `check-mobile-host.mjs`: read, edit (revision bumped, saved on
  the computer, in the next snapshot), stale revision refused, empty name
  refused, unknown fields refused, empty edit refused.
