# ADR-0085: One workspace picker in member chat

Date: 2026-10-13

## Context

The user’s native screenshots showed a workspace dropdown, a separate plus
button labelled Add workspace, and another searchable folder picker with a
Path field, Choose folder, and Add workspace. These offered two ways to choose
where one member works. The dropdown changed conversation state only, while
the second path saved a member assignment. The distinction was neither visible
nor useful when the user simply wanted Alex to work in one folder.

## Decision

Use one shadcn Popover and Command picker in the composer. Its trigger names
the active folder; the picker shows its full path and searches only that
member’s assigned folders. Choose another folder opens the existing native
folder chooser and applies its result directly. Pasting an absolute path into
the same search offers Use that folder, without another path form.

Both paths validate the folder through the bridge and save the member’s
primary workspace and projects before changing the composer. A failed save,
invalid path, or cancellation keeps the current folder. The next chat request
uses the selected workspace. Existing project assignments and permission
overrides remain available in the member profile; the composer exposes one
active working folder.

## Evidence

`node scripts/check-member-workspace.mjs` exercises the rendered app with an
isolated real bridge, temporary project folders inside the repository, and a
controlled native chooser response. It checks one control, assigned-folder
search, persistence after reopening, invalid paths, failed bridge saves,
cancelled selection, immediate folder application, and the workspace in the
next chat request. Provider execution and the OS folder dialog are deliberately
outside that check; the request is captured before any provider is invoked.

The installed macOS 0.1.6 candidate was also inspected through its native
accessibility tree and screenshot. Alex’s chat showed one workspace trigger
and the new picker. Selecting the existing
`/Users/igorcosta/Documents/autohand/web/prototypes/dark-web-cli` assignment
updated the header and composer. After quitting the native app, stopping the
bundled runtime, and reopening, the directory still showed nine members and
Alex as GTM APAC Leader in dark-web-cli. The native OS folder chooser itself
was not exercised in this pass.

## Consequences

- The chosen working folder is explicit and consistent after reopening.
- Arbitrary folders remain selectable through the OS chooser or an absolute
  path, but the picker no longer acts as a machine-wide repository explorer.
- Members may retain several assigned project folders for existing work and
  permission scopes. This change does not migrate or delete those assignments.
- The existing project limit still applies to a newly assigned folder. At the
  limit the picker explains how to remove an unused assignment in the profile.
- The chooser runs on the bridge’s machine, as before. This does not introduce
  a different remote-folder or relay-workspace model.
