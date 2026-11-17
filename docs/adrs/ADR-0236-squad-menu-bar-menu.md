# ADR-0236: the menu-bar menu is about the squad

Status: accepted. Supersedes the look recorded in ADR-0229 (capsule bars and
provider dot glyphs). ADR-0229's macOS 27 finding stands and is kept:
menu images need `NSMenuItem.preferredImageVisibility = visible`
(`tray_art::keep_menu_images_visible`). Implements
`docs/design/menu-bar-menu.md`, with the deviations below.

## Context and evidence

ADR-0229 drew each usage window as a coloured capsule bar under provider
headings with 5×5 dot marks. The owner rejected the look on 2026-11-16 as a
copy of Codync's menu. The menu was also organised around subscriptions: 30
rows, led by the email address, with the squad as one disabled line.

The approved spec turns the menu around: who is working, what waits on the
person, and engine limits only as the thing that might stop a member.

What the tray model had, and what it lacked:

- The daemon's `/status` gives members (status, working, queued) and jobs
  (title, `agentId`, status) and the daemon's `startedAt`. Enough for the
  header, member order, task titles and "Running since".
- Needs-you items, breaks, each member's engines and the paired phone are only
  in the bridge. All are readable with the ownership context header from
  endpoints that already exist, checked against the owner's running bridge on
  2026-11-17: `GET /api/chat/questions`, `GET /api/chat/permissions`
  (`{pending: [...]}` with `agentId`, `question` / `description`, `createdAt`),
  `GET /api/members/breaks`, `GET /api/control-plane/members/:id` (`harness`,
  `modelRouting.fallbacks`), `GET /api/members/:id/model-routing` (`health`
  keyed by the router's route key with `blockedUntil` and `reason`), and
  `GET /api/mobile/status` (`devices`, `routes[].connected`). No server work
  was needed.

Two measurements changed the drawing:

1. **AppKit gives every row one image column, as wide as the widest image.**
   An off-screen `NSMenu` with `preferredImageVisibility` set measured 130 pt
   wide with no images, 154 pt with one 18 pt image, 208 pt with one 72 pt
   image, and still 208 pt with a 72 pt and an 18 pt image (Swift script in
   the session scratchpad, `NSMenu.size`). The spec's single-row comb (up to
   72×18 pt) would therefore have pushed every row's text, Quit included,
   72 pt to the right. The first mock showed exactly that.
2. **The spec's colours miss 3:1 on the light menu.** The preview test
   measures WCAG contrast against `#ECECEC` and `#2C2C2E`: ready `#1E9E5A`
   was 2.92:1 and you `#D9720B` 2.79:1 on light. Darkened to `#1C9354`
   (3.32 / 3.55) and `#CA6A0A` (3.19 / 3.70). Ink 3.52 / 3.35, work 3.09 /
   3.82, out 3.31 / 3.56 were kept.

A third came from looking at the render: unlit headroom cells drawn as 1 px
rings of the full 2.75 px cell read as filled at 18 pt, so the red 0% mark
looked full.

## Decision

1. **The rows are planned as data.** `daemon/src/desktop_tray/menu.rs`
   (`plan_menu`) turns the tray model plus the bridge reads into rows with
   words, an optional drawing, an id and a shortcut. The shell
   (`src-tauri/src/main.rs` `tray_menu`/`tray_item`) maps rows to muda items.
   The spec's states, sentences and order are unit-tested there without a
   menu.
2. **The menu, top to bottom:** comb header `Squad · 2 working, 3 ready` (⌘O,
   opens the window); one needs-you row, or `{n} things need you ▸` with
   `Open Needs you` (⌘1); up to five member rows (`{Name} · {activity}`,
   portrait with presence badge, opens Quick Chat); `All members (n) ▸` above
   five; the headroom row; then Quick chat (⌘⇧K), Settings… (⌘,), Account ▸
   or Sign in…, Services ▸, Help ▸, Quit Autohand Squad (⌘Q).
3. **Headroom is shown as what is left, never as used.** The row names the
   tightest window among engines that power someone not offline, with the
   spec's sentences ("Claude Code low · 12% left, resets Fri 9:00 am",
   "Claude Code out until 4:10 pm · Noah on Codex", "2 engines out · first back
   …"). The submenu groups engines by whom they power ("Codex · backup for
   Noah", "… · not used by anyone"). Reset times are absolute in local time and
   follow the system's 12/24-hour setting (`NSDateFormatter` `j` template);
   on Windows, where the shell reads no local offset, they stay relative.
4. **Images follow the Squad mark, not a provider.** `tray_art.rs` draws the
   comb, the headroom mark (hexagon with ten cells lit for what is left,
   rounded up), the member portrait with a badge cut out of the corner, and the
   needs-you hexagon with a knocked-out "!". Capsule bars, provider colours and
   provider glyphs are deleted with their tests. Windows and Linux show the
   same rows as text.
5. **Deviations from the spec, each from the evidence above:**
   - The comb is a seven-slot honeycomb inside 18×18 pt (circumradius 5.5 px,
     reading order top → middle → bottom), not a row up to 72 pt. With more
     than seven members the seventh slot is the overflow dots (spec: 7 + 1).
   - Ready and you colours darkened to reach 3:1 on both menus.
   - Unlit headroom cells are 1.25 px faint dots, not 1 px rings.
   - Signed out, the shell has no ownership context and cannot read the squad,
     so the header reads `Squad · signed out` with no member rows; the spec
     expected members to keep showing.
   - Needs you counts questions and permission requests only. Handoffs,
     proposals, vault and folder requests that the web Needs you view also
     shows are not readable from one endpoint; `Open Needs you` reaches them.
   - "Manage plan…" and "Upgrade plan…" open `https://autohand.ai/code/pricing/`
     (`/pricing` redirects there; account, billing and dashboard paths 404).
     Squad has no plan page. Window rows and "Usage settings…" open
     Settings › Quick Chat, where harness usage is switched; there is no
     Settings › Usage section.
   - A member whose primary is cooling down but who is not working reads
     "Ready"; only a working member reads "On Codex until …" with the notched
     badge. Increase Contrast is read on every rebuild (every 5 s) rather than
     on `NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification`.
   - The phone line says whether the computer is reachable on Wi‑Fi or via
     relay (the bridge's route state), not whether the phone is connected now.
6. **Refresh.** Right-click on the status item starts a refresh; usage is
   refetched only if the last read is older than a minute. Engines per member
   are read at most once a minute or when the roster changes; needs-you,
   breaks and phone with every 5 s refresh. Portraits are decoded once per
   avatar source and cached.

## Consequences

- One more set of bridge reads on the 5 s tick (three small GETs) and, once a
  minute, two per member (up to 40). All are local and time out after 3 s;
  a failed read leaves that part of the menu empty, not wrong.
- The fallback "in use" is the router's saved health matched by engine,
  provider and model; it ignores executable paths and whether the fallback
  engine is installed, unlike the chat header's `engineInUse`.
- At 2.75 pt per cell the comb shows state by fill and outline more than by
  colour; the paused bars are 0.5 pt wide and read mainly as "not solid".
- Not done here: the attention variant of the status-item template (spec
  §3.6, marked optional), and `accessibilityPerformShowMenu` on the status
  button (spec §5). Both were taken up by ADR-0249, which built the dot and
  found the second unnecessary: VoiceOver's press already opens this menu.
- The live menu was not opened (it takes over the pointer). Verified by:
  `cargo test` in `src-tauri` (46 passed) and `cargo test --lib` in `daemon`
  (122 passed with `--test-threads=2`; at full parallelism different daemon
  socket tests failed on each run and each passed alone), the 16
  `desktop_tray` tests for every row state, `cargo build --release`, and the
  ignored `tray_art_writes_previews` test, whose PNGs and `menu.json` were
  composed into light and dark mocks and inspected.
