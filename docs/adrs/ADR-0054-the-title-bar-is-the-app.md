# ADR-0054: The title bar is part of the app, not a band above it

Date: 2026-09-29
Status: Accepted

## Context

The owner, with a screenshot of Squad beside a screenshot of another app: "top
bar of the app is annoying doesn't match which looks like uses the same app
foreground colours."

The window is already a full-size content view — `TitleBarStyle::Overlay`,
`hidden_title`, `transparent` — so the page does extend under the title bar.
What it then did with that space was the problem. `.app-shell-root` carried
`padding-top: var(--titlebar-inset)` while the shell root, `#root`, `body` and
`html` are all `background: transparent !important` in the desktop shell.

Twenty-eight pixels of padding on a transparent element is twenty-eight pixels
of nothing. What showed through was the window's own vibrancy material, which is
a light grey. In a black app that reads as a grey bar sitting above the sidebar
and the main column rather than as part of either — exactly the seam the other
app does not have, because there each column's own colour runs to the top edge
and the traffic lights sit on it.

## Decision

**The columns reach the top edge; only their content is inset.** The padding
moves off `.app-shell-root` and onto `.app-sidebar` and `.app-main`. Their
backgrounds now paint from y=0, so the band is the app's own surface, and the
brand row and the channel header still start below the traffic lights.

**The full-height rewrites stay, and the sidebar opts out.** `h-screen` inside
the shell is still one inset too tall for a padded column, so the rewrite that
subtracts it is still needed — removing it cost the page a 28px scrollbar, which
is how this was caught. The sidebar column is the exception: it starts at the
top edge rather than below the band, so it is genuinely a whole viewport tall
and asks for `h-[100svh]` by hand, which the rewrite does not match.

## Consequences

- Measured in a headless browser with `data-shell="desktop"`, `data-platform="mac"`,
  813px window: both columns at top 0 and height 813, content at 28, page
  overflow 0. The web shell is unchanged — everything at 0 and no inset.
- `--titlebar-inset` is still 0 off macOS, so Windows and Linux are unaffected.
- The drag strip is untouched: still fixed at the top, full width, the height of
  the inset, and still the only drag region (ADR-0040). It now sits over the
  app's own surface instead of over a strip of window.

## Profile sidebar correction — 2026-10-01

The owner's profile screenshot showed the brand overlapping the macOS traffic
lights while the same brand was correctly positioned in a direct message.
Reading `MemberProfileSidebar` and the desktop selectors in `src/styles.css`
showed that the profile variant did not carry `app-sidebar`; the inset rule
therefore never matched it. The collapsed rails had the same omission.

All sidebar variants now carry the same shell class. The profile brand uses
the workspace brand's size and header spacing, and its header cannot shrink
when the section list is long. The profile section list scrolls independently.
The inset still belongs to the inner sidebar root, so adding it to the outer
column would apply the inset twice on the ordinary workspace sidebar.

This amends the existing titlebar decision rather than choosing a separate
profile-only offset. Browser geometry and keyboard checks are tracked with
the current change; source inspection is evidence for the cause, not native
window verification.

The 2026-10-01 browser run (`node scripts/verify-work-profile-browser.mjs`)
measured normal and profile logos at x=16, y=40, 32 by 32 pixels, with the same
28px desktop inset and 56px brand header. Both collapsed variants measured
y=32, 28 by 28 pixels. None were clipped; default, soft, and grut skins retained
normal/profile alignment. The report is in `.codex-artifacts/work-profile/`.
These are Chrome measurements with desktop/mac attributes, not a native
Tauri window or a packaged-app test.

The final clean macOS bundle was then compiled with `tauri build --bundles app`,
installed in `/Applications/Autohand Squad.app`, and opened through the native
window. Native screenshots confirmed the logo and brand text visible below
the traffic lights on both the workspace and Eva's profile. Refreshing only
the web assets in the previous running bundle did not establish this proof:
its profile still appeared without the brand. The clean bundle and runtime
restart were necessary to verify what the owner actually sees.
