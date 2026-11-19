# ADR-0264: Desktop requests audit: Inbox wording everywhere, the marketplace's closed state, evidence for dictation and Liquid Glass

Status: accepted, 2026-11-19

## Context

"open a new lane and address all the ux and ui issues for the squad desktop
i asked, i think got lost in the way". A read-only audit went through every
desktop UI/UX request in the session transcript (12–19 Nov) and checked each
against code on main (a95778e), not against what was claimed.

Nothing was entirely lost. These were partly done:

- "Needs you" was renamed to Inbox in the window, sidebar and View menu
  (ADR-0258). The menu-bar menu still said "Open Needs you" and "{n} things
  need you", and the Inbox page's first tab and heading still said "Needs
  you".
  - ADR-0258 kept the tab label on purpose. That was the wrong call: the
    request was to stop saying "Needs you", and the tab is where people read
    it most.
- New member (New message › New member) and New team suggest marketplace
  agents and teams, but render nothing while the marketplace is not open.
  Only the New Squad member page said so. With the production rollout on
  hold, people saw empty space and read it as broken.
- On-device dictation (ADR-0260) and the Liquid Glass sidebar (ADR-0258) were
  never shown working in the signed app.

## Decision

- **Inbox wording everywhere.**
  - Menu bar: "Open Inbox", "{n} things in your Inbox", status item "Autohand
    Squad, 1 thing in your Inbox".
  - Inbox page: heading "Inbox", first tab "Waiting on you".
  - The internal ids (`needs-you`) stay, so settings and links keep working.
- **The marketplace's closed state shows wherever suggestions show.** New
  member and New team pass `showClosed`, and the line names the kind:
  "Agents …" or "Teams … from the marketplace show here once it opens."
- **Dictation evidence.** Recorded in ADR-0260: the installed helper
  transcribes on the device; the first run takes 23.6 s and later runs
  0.52 s.

## What was run

- `cargo test` in `daemon` (128 tests). One test,
  `daemon_serves_status_queue_sync_and_drain_restart`, failed when the
  tests ran in parallel and passed alone, which is how CI runs them
  (`--test-threads=1`).
- `cargo fmt --check`.
- `check:jsx`, `bun run build`, `check:inbox:browser`.
- `check:marketplace:browser` (both scripts PASS).
- The Minified layout spec (11 passed); it now expects the sidebar's Inbox
  button.

## Consequences

- Liquid Glass is still not proven by a screenshot. This shell has no
  screen-recording permission (`screencapture` returned a black frame) and
  the shell does not log which material it applied. Someone has to look at
  the sidebar on macOS 27.
- The painted 3D and clay bird art stays deferred to 23 Nov (ADR-0242).
- The microphone path (`listen`, the macOS prompt) still needs a person.
- "Continue with Apple" still goes through autohand.ai's login page; going
  straight to Apple needs website work (ADR-0245).
- Recipes come from a repeat spotter and from Chief of Staff when it happens
  to notice one. There is no scheduled review (ADR-0259).
