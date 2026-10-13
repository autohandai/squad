# ADR-0062: Preview a teammate where the conversation is

Date: 2026-10-01
Status: Accepted

## Context

The owner asked to click a teammate's name or photograph in a direct message
and see a small card with their name, role, status and details, with a route to
the full profile. The existing name button opened a large central dialog;
the photograph was not interactive. Source inspection of
`AgentProfilePreviewDialog` showed a framed portrait, statistics, strengths,
brain-card panels and capabilities: a second profile page interrupting the
conversation rather than a quick identity check.

The existing shadcn Popover already provides an anchored surface, keyboard
activation, Escape dismissal and focus restoration. No new primitive or data
request is needed.

## Decision

The photograph and name share one labeled button opening a compact popover
anchored to the conversation header. It shows name, role, description and
live status, then workspace, model and execution harness as plain detail rows.
View profile opens the existing full profile route. The harness switcher stays
a separate control outside the profile trigger.

Presence uses the same render-time value as the header, including the working
override while a chat is sending and runtime-unavailable state. Changing the
active teammate remounts the popover so an open preview cannot silently become
another teammate's card.

## Consequences

- The conversation remains visible while checking who the teammate is.
- Both photograph and name are keyboard-accessible through one trigger and
  one focus stop; the preview has an accessible heading.
- The popover uses the existing neutral tokens, small corners and dividers;
  it is the requested contextual card, not a new dashboard surface.
- Statistics, strengths and deeper configuration are deliberately left to
  the full profile. The preview is bounded by viewport width and height and
  scrolls for long descriptions rather than showing a full profile summary.
- This is an interaction change to the web view. Native drag behavior still
  requires a native-window check; browser checks cannot establish it.

## Validation

`bun run build` passed. `node scripts/verify-work-profile-browser.mjs`
passed with isolated Chrome and mocked APIs: clicking the avatar or name opens
the anchored card; an open card updates from Idle to Working; Escape restores
trigger focus; View profile opens the existing profile route. The card fits
390px and 768px viewports in both light and dark themes without horizontal
overflow. Screenshots and the report are in `.codex-artifacts/work-profile/`
(local, ignored by Git), with the full screenshot set under
`/tmp/autohand-work-profile-browser/`.

`cargo check --manifest-path src-tauri/Cargo.toml` passed. Those initial checks
used Chrome's desktop user agent and did not establish a native result.
The final macOS bundle was subsequently compiled, installed in Applications,
and opened: Eva's DM trigger displayed the compact card, and View profile
opened the full profile with its logo below the traffic lights. Native
screenshots verified those actual surfaces. No drag interaction was tested.
