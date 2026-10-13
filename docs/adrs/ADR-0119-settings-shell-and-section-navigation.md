# ADR-0119: Settings is its own shell, one section at a time

Date: 2026-10-14
Status: Accepted

## Context and evidence

The person's words: "settings is a massive page that scrolls to the point
where it has the ui for the changes the user wants, i want to actually hide
the side bar when settings are open, and for each control side i click that
and micro animations to reveal or load settings to the other components not
one big view there".

What the page did, read on 2026-10-14 at commit 6fd4364: `SettingsPage` in
`src/App.jsx` rendered all seventeen sections as one stacked column of
`<section>` elements behind the app sidebar. The left list was a column of
`#settings-<id>` anchors; clicking one scrolled the column and an
IntersectionObserver moved the highlight to whichever section crossed the
upper third of the viewport. Two things made it hard to use:

- Every section was always mounted, so Vault, Voice, System, Connectors and
  the provider list all fetched on open and the page was several screens
  tall. Finding "Remote access" meant scrolling past twelve other sections.
- The list in `App.jsx` and the route parser disagreed. `SETTINGS_SECTION_IDS`
  (the parser's copy) lacked `voice` and `vault`, so `/settings?section=vault`
  and `/settings/voice` opened Settings at the top; the "Settings → Vault"
  hint in the payment approval row and "Settings → Voice" in the read-aloud
  setting pointed nowhere.

The section list the person named is exactly the old list's order: Setup
guide, Appearance, Language, LLM Providers, Chat, Notifications, Voice,
Vault, Self-improvement, Handoff retry policy, Needs you, Runtime bridge,
Relay, Remote access, Connectors, Updates, System.

## Decision

Settings becomes its own shell. While the route is `/settings` or
`/settings/<id>`, `App.jsx` renders neither the desktop sidebar nor the
mobile top bar; the main column takes the whole window. The shell
(`src/components/settings/SettingsShell.jsx`) is a header with the Back arrow
from ADR-0088 and the title, a pinned list of section labels on the left, and
exactly one section's content on the right. Only the selected section
renders; the other sixteen are not mounted. The seventeen bodies stay in
`SettingsPage` as a map from id to render function, because ten of them lean
on App-level state and helpers that have no home outside `App.jsx` yet.

The route names the section. `src/lib/settings-navigation.js` now owns
`SETTINGS_SECTION_IDS`, `settingsPath(id)` and `settingsSectionFromRoute()`,
which accepts the three spellings already linked from somewhere:
`/settings/<id>` (the list), `/settings?section=<id>` (the desktop shell's
Updates action and the About window) and `#settings-<id>` (the old in-page
anchors, still used by `check-account-settings-browser`). An unknown id shows
Appearance rather than an empty page. Selecting a row calls the app's
`navigate`, which pushes a history entry, so the browser's Back and Forward
move between sections and each entry carries the ADR-0088 origin; the
page-level Back still returns to where Settings was opened from.

Motion explains the change and nothing else. One 2px bar beside the list
slides to the selected row (`top`/`height` transitions, 180ms, the
`cubic-bezier(0.2, 0.8, 0.2, 1)` curve already used by the effort slider),
and the new content fades up from 5px (`settings-section-in`, 180ms, same
curve). The first measurement after mount lands without a transition so the
page does not open with a bar sliding in from the corner. Under
`prefers-reduced-motion` both are instant. There are no skeletons; sections
that load data keep their one quiet line.

Keyboard: the rows are links, so Tab walks them; Up/Down (and Home/End)
move focus within the list, Enter or Space opens the focused row. Escape
anywhere on the page is Back, except when focus is in a text field or inside
an open menu, select or dialog, which own Escape themselves.

Narrow widths: below the `md` breakpoint (768px) the list becomes one
horizontally scrolling row of the same labels with the bar as an underline,
and the content follows underneath. The selected row is scrolled into view
on every measurement, resizes included. This is the simplest shape that
keeps every section one tap away with no second control; a select would have
hidden sixteen names behind a click and a drawer would have reintroduced the
sidebar the person asked to remove. The two-column layout starts at `md`
rather than at the app's `lg` sidebar breakpoint because the sidebar is gone
and a 208px list fits beside the content at 900px.

The list carries labels only. A first version rendered a second muted line
per row (the old, never-shown `detail` values); the 1440×960 screenshot
showed the pinned list ending at 930px, which on the 1170×760 windows the
account check uses would have hidden the last sections behind the fold while
sticky positioning kept them unreachable. The detail helpers that only fed
those lines were removed with them, and the DESIGN.md sentence about a
Remote access "nav detail" was replaced.

## Evidence

- `bun run build`: passes (JSX import check for 163 files, Vite build).
- `node scripts/check-render.mjs`: passes.
- `node scripts/check-settings-browser.mjs` (new, in the `ci` chain after
  `check:chats:browser`): passes, run three times in a row after the last
  code change. It opens Settings from a member chat through the native-menu
  DOM action and asserts no `.app-sidebar` and no account gear, exactly one
  `section[id^="settings-"]` with one heading, 17 rows in the list, the
  current row marked; clicks Connectors then Vault and checks the path and
  heading each time; `history.back()`/`forward()` move between sections;
  Down from the open row focuses the next without opening it, Enter opens
  it, Escape returns to the member chat and the sidebar is back; a fresh
  `/settings/vault` opens Vault and `?section=updates`, `#settings-voice`,
  `/settings/nope` and `/settings/connectors` resolve through the app's
  popstate handler; a direct link's Back goes to Squad; at 900px the list is
  still a column, at 640px it is a row and clicking Voice works.
- Screenshots, looked at before the design was called done, under
  `.codex-artifacts/lanes/settings-navigation/` (untracked):
  `settings-appearance-1440.png`, `settings-connectors-1440.png`,
  `settings-appearance-900.png`, `settings-connectors-900.png`,
  `settings-connectors-640.png`, `settings-voice-640.png`.
- `node scripts/check-account-settings-browser.mjs` (not in the `ci` chain):
  the eleven skin/layout/narrow-window passes print PASS, including the
  `#settings-chat` hash, reload and return assertions this change keeps. It
  then fails in its origin-screen loop with a fresh document stuck on the
  boot screen. The same script run against an untouched worktree of
  6fd4364 fails at the same point (`Runtime.evaluate timed out` after the
  same eleven PASS lines), so the failure predates this change.

What was learnt while writing the check: in headless Chrome against the
production bridge serving `dist/`, every fourth fresh document loaded in one
tab sits on the boot screen ("Waking the squad…") for about forty seconds.
A probe that loaded eight routes in sequence measured 316–989ms for loads
one to three, a stall at load four, 44s for load five (which then mounted),
normal again for six and seven, and a stall at load eight. During a stall
the page's `document.readyState` was `interactive`, the stylesheet and
manifest had loaded, and the module script was absent from
`performance.getEntriesByType('resource')`, while Node fetched `/` from the
same bridge in 2ms. The request for the bundle is not leaving the browser;
the pattern (three documents, then a stall that clears after the server's
idle timeout) points at per-host connection exhaustion by the previous
documents' event-stream connections, but that was not proven here. The
check therefore makes at most three fresh loads and resolves the remaining
deep links through `history.pushState` plus a `popstate` event, which is the
path the app's own router takes. It also retries a load that has not mounted
after eight seconds, which cannot help for a same-document hash change but
costs nothing.

## Consequences

- After Back from Settings, the browser's own Back may land on an earlier
  Settings section entry, because every section selection is a history
  entry and ADR-0088 replaces only the entry Back is pressed on. The origin
  stored in those entries still makes the page-level Back work from them.
- Ten section bodies still live in `App.jsx`. Only the shell, the header and
  the route helpers moved out; moving Appearance, Language, Providers,
  Chat, Self-improvement, Handoff, Needs you, Setup, Updates and Runtime
  would mean lifting their App-level helpers first.
- The sidebar's keyboard shortcuts and the tray's Members popover still
  work, but there is no sidebar on Settings to click; Back, Escape and the
  native menu are the ways out. The mobile sheet cannot be opened from
  Settings because its menu button lives in the top bar that is hidden.
- The list is labels only; the state a section is in (Off, paired,
  version available) is read inside the section, not from the list.
- The fresh-document stall is documented, worked around in one check and
  not fixed. `check-account-settings-browser` keeps failing on main for that
  reason and is still outside the `ci` chain.
- Voice and Vault were missing from the route parser's id list; that is
  fixed by having one list, but no check guards that the list in
  `settings-navigation.js` and the bodies in `SettingsPage` stay in step
  beyond the browser check's count of 17 rows.
