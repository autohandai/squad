# ADR-0065: Product information lives in separate native windows

Date: 2026-10-01
Status: Accepted

## Context

The owner asked for Check for upgrades beside About and Settings in the native
application menu, and for a custom Squad About window with policies, changelog,
third-party licenses and checksum information. The existing macOS application
menu used the operating system's predefined About panel, carrying only name
and version. The tray's About action navigated the main Squad window instead
of opening product information independently.

Source inspection showed the native shell already owns window creation and
routes menu actions to the running web app through one DOM event. The local
bridge is also already the source of product assets and metadata. Reusing
those seams avoids a separate process or duplicate implementation of product
information.

## Decision

Replace the predefined About panel with a native window loading the standalone
`/app-info/about` view from the shell's known local bridge origin. Policies,
changelog and licenses each have their own native window and fixed route.
Window labels are fixed per page: reopening a page focuses its existing
window rather than creating copies. Closing an information window closes it;
the main conversation retains its existing hide-to-tray behavior.

Links requesting a native information window use the exact route
`/app-info/{about|policies|changelog|licenses}?window=1`. The native navigation
callback intercepts only a known page on the bridge's exact origin, without
credentials, fragment or additional query instructions. Window construction
is scheduled on the main thread to avoid constructing one webview inside
another webview's navigation callback. Browser fallback renders the same
standalone route normally. No command IPC or broader webview capability is
introduced.

The application menu and tray both use the existing `check-upgrades` DOM action
to focus the running main window, select Updates and request a fresh repository
check. An About-page check link uses the fixed local URL
`/settings?section=updates&check=1`; the information window intercepts it and
dispatches that same action to the main window. It does not replace the About
window's contents or start another app copy.

macOS exposes About, Settings and Check for upgrades in the application menu.
Windows and Linux expose the same actions in Help, since they do not have a
macOS application menu.

Stage the package version, source commit, dirty state, build time, documents
and dependency notices with the desktop runtime. About is a standalone React
root: it does not mount the workspace, subscribe to agents, acknowledge
messages or require account sign-in. Its appearance follows the existing
theme read-only. Hash the installed `autohand-squad` executable at runtime and
label it **Desktop executable SHA-256**. This hash is distinct from a source
commit, the frontend manifest and a downloaded installer's checksum; embedding
an executable's own digest into itself would be self-referential.

The license manifest records the production npm closure, the union of runtime
and desktop Cargo.lock dependencies, the original Node distribution notices,
the exact pinned CLI release license and font notices. Some entries target
other platforms or build tooling. Missing notice text is explicitly recorded
instead of silently claiming a complete set. The CLI's pinned v0.9.7 license
is Apache-2.0; an assumption that the project's MIT license also covered it
was corrected by inspecting the release-tag object. Its exact notice is
checked into `public/legal` for reproducible staging. The missing Sans OFL
text was restored from the sibling file whose hash matches this repository's
existing font attribution.

## Consequences

- About and reference documents do not displace a conversation or running
  work. Each page is reusable and independently closable.
- Information windows use ordinary native titlebars and a small About size;
  document windows can resize. They do not inherit the main window's overlay
  titlebar or translucent sidebar treatment.
- The web app owns information content and bridge-backed metadata, while the
  native shell owns the window. This preserves one content source across the
  browser and installed app.
- About displays local source changes honestly rather than presenting its
  commit as a pristine release. Its executable digest identifies that file's
  bytes; it does not prove signing or integrity of every bundled resource.
- Dependency disclosure includes platform/build entries as a conservative
  superset. Missing upstream texts are visible; this change does not fetch
  every other-platform dependency solely to populate a notice window.
- Only fixed local pages can ask for native windows. Arbitrary URLs, commands
  and destinations remain outside this seam. External document links use a
  native browser opener limited to web and email schemes.
- Information windows depend on the local bridge; this change deliberately
  does not build a second offline metadata renderer. Opening them while the
  bridge is still starting reports a native-shell error rather than guessing
  a destination.
- The separate-window behavior requires native verification. Browser routing
  tests alone cannot establish that a new native window opened or was reused.

## Evidence

`cargo test --manifest-path src-tauri/Cargo.toml info_windows -- --nocapture`
checks exact accepted information routes and rejects other origins, ports,
credentials, unknown pages, extra query instructions and fragments. The fixed
Updates check URL is tested independently. Native menu, window reuse and
content proof require the installed desktop bundle, rather than a browser
fixture alone.

`node scripts/check-app-info.mjs` verified staged source identity, selected
Node version, exact pinned CLI notice attribution, generated frontend file
digests, document inclusion and hashing the desktop executable rather than
Node. The browser verification recorded 36 settled screenshots covering the
combined work/profile changes, update states and standalone information pages,
including 520-by-600 About layouts in light and dark themes, clipboard failure,
missing checksums and metadata loading failures. Those browser states are
fixtures, not proof of native windows or a live installer upgrade.

After `tauri build --bundles app`, the complete app was installed at
`/Applications/Autohand Squad.app` and opened. Its live `/api/app-info` response
reported bundled metadata and executable SHA-256
`5b7a76b01abcd34c9d00f7561121da4372edac17ab7617d6815b198f72ef210f`.
`shasum -a 256` against the installed desktop executable independently matched
that value. The native application menu showed About, Settings and Check for
upgrades; About opened a separately titled native window with version 0.1.5,
the full source commit, Local changes, build time and that same digest.
Reopening About focused its existing window. Policies and Changelog opened
separate document windows with their bundled content. Third-party licenses
opened its own titled native window; the user resumed typing in the main DM
before its content inspection settled, so further focus changes stopped.
Native license content/reuse and the About button's return-to-Updates action
remain unverified; their content and DOM/navigation behavior are covered by
the browser fixtures and focused route tests. The main conversation was
preserved. The fresh installed update check
successfully used `autohandai/squad` and reported stable 0.1.5 current; it did
not download or install an upgrade. The small live metadata proof is retained
in `.codex-artifacts/work-profile/installed-app-info.json`.

Information document links are also handled at the native window boundary:
external HTTP(S) and `mailto` navigation uses the system browser or email app,
and the same handler covers `target="_blank"` through Tauri's `on_new_window`.
The embedded window request is denied after handling it, so the information
window keeps its page. File, JavaScript, data and other custom schemes are
never sent to an opener; credential-bearing web URLs are rejected as well.
The focused native tests cover these scheme and origin guards without
launching external applications.
