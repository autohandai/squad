# ADR-0288: One startup surface

Status: accepted, 2026-11-27

## Context

The owner asked: "Squad desktop has 3 loading check screens, why not just
one?" A cold start of the installed 0.1.26, recorded on his Mac (macOS in
dark mode, Squad set to light in Settings), showed three different screens in
about eight seconds:

1. **~5 s, dark.** The native loading page Tauri serves while the Rust
   bootstrap runs (`src-tauri/loading/index.html`): centred mark, name, three
   birds, "Starting Squad…". It follows the *system* theme, because it runs
   on the shell's own origin and cannot read the app's saved theme.
2. **~2 s, dark, laid out differently.** `OwnershipBootstrap`'s busy state:
   a 48 px mark beside a 20 px title, left-aligned in a 28 rem column, with a
   spinner and "Loading your Squad…". It used the dark root tokens because
   the app had not applied a theme class yet.
3. **~0.5 s, light.** `App`'s `BootChecks`: mark, name, a three-row
   checklist ("Interface loaded / Reading your squad / Starting the local
   bridge") and member avatars, in the app's theme (light).

`index.html`'s inline `#boot` (ADR-0245) already matched screen 1, and the
handover from it to React was designed as a swap of identical pixels. The
two React layers after it broke that: different layout, different theme,
different content. ADR-0047 had made the native page match React's boot
screen; later changes moved React's screens away from it.

## Decision

One startup surface from the first frame to the app.

- **Shared markup.** The inline CSS in `index.html` now styles classes
  (`.boot-surface`, `.boot-mark`, `.boot-name`, `.boot-flock`, `.boot-status`,
  `.boot-actions`) instead of ids. `src/components/shell/StartupScreen.jsx`
  renders exactly those classes with the same three birds (the same seeded
  `pickFlock`, the same `birdFaceSvg`). Because the styles live in the
  document, React's copy is pixel-identical to the static one, and the
  existing "remove `#boot` after React paints" handover is invisible. React's
  copy sets `data-settled`, so the birds keep hopping and do not land again.
- **Every layer uses it.** `OwnershipBootstrap` (verifying, loading, draining
  and their errors, with Retry / owner choices / Sign out under the line) and
  `App` before the bridge answers both render `StartupScreen`. Only the status
  line changes: Starting Squad… → Verifying your Squad… / Loading your
  Squad… → "N members ready · Starting the local bridge…" (or "Reading your
  squad…" before any member is known). `BootChecks.jsx` is deleted. The rows
  it showed were real (ADR-0033); their meaning survives as the status text.
  Quick Chat keeps its one-line form ("Connecting to Squad…").
- **The person's theme, from the first frame.** The app writes its theme mode
  to the owned `settings.json` as `startupTheme` (system / light / dark)
  through `/api/system/settings`. Before building the main window the shell
  reads it (`quick_chat_preferences::read`) and adds an initialization script
  that sets `data-mode` on the loading page, and on that page only (tauri:
  origin). The loading page's CSS honours `data-mode` like `index.html`. The
  web layers read the saved mode from the window's storage, as `#boot` did.
- **No late pieces.** `index.html` preloads Autohand Sans (with
  `font-display: swap`) and both marks, so the name keeps its face and the
  mark is present when the web surface takes over from the native page.

## Consequences

- `scripts/check-one-startup-surface-browser.mjs` (new, `check:one-startup`)
  starts a real bridge with a dark system and a light saved theme, holds the
  ownership and runtime answers back 1.2 s, samples the page every 100 ms and
  photographs it every 150 ms. Three runs passed: 33–38 samples, one surface
  (plus, for one frame, the identical static copy beneath React's during the
  swap), background `rgb(255, 255, 255)` throughout, the mark fixed at
  (612, 329), three birds throughout, status Starting Squad… → Verifying your
  Squad… → 3 members ready · Starting the local bridge…, then the app with no
  blank frame between.
- Checks that waited for "Waking the squad" to disappear now wait for
  `[data-startup]` to go. That marker is on both the static and React
  surfaces.
- **Not verified natively.** The Rust change compiles (`cargo check`) and its
  unit test passes, but no signed app was built and launched. The first start
  after updating still follows the system theme, because `startupTheme` is
  only written once the app has loaded once.
- A theme set to "system" keeps following the system on the native page. A
  read-only Squad cannot save `startupTheme`, so its native page follows the
  system too.
- The member avatars that settled in as the squad was read are gone from the
  startup screen. The count in the status line replaces them, because new
  faces arriving was the movement the owner objected to.
