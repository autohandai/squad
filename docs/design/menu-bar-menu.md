# Menu-bar menu: the comb

Status: built, 2026-11-17 (ADR-0236). Deviations from this text are listed in
ADR-0236 §5: the comb is a seven-slot honeycomb in 18×18 pt, ready and you
colours are darker, unlit headroom cells are small dots.
Replaces the provider-section layout recorded in ADR-0229 (capsule bars and
dot-matrix provider marks), which the owner rejected as a copy of Codync.
Implementing this needs a new ADR that supersedes ADR-0229, plus edits to
DESIGN.md lines 37 and 175 (see "Contract changes" at the end).

---

## 1. The idea

**The menu answers one question: is my squad able to keep working without me,
and if not, who needs what?** It is organised around people, not providers:
the squad first, what is waiting on you second, and engine limits only as the
thing that might stop a member.

Squad's mark is a hexagon full of cells. The menu borrows that literally, in
two places and nowhere else:

- **The comb** (top row): one hexagon per member, in a line, filled or
  outlined by what that member is doing. You see your team before you read
  a word.
- **The headroom mark**: the Squad hexagon with ten round cells inside. The
  cells light up for the share of the limit that is *left*, so it shows how
  much is left rather than how much is used. Full means plenty of room; empty
  means the engine has stopped.

Neither is a bar, and neither uses a provider's colour or glyph. Providers
appear only inside one submenu, and only to say whose work they power.

---

## 2. The menu, row by row

Notation: `[img]` = leading image (section 3). `▸` = submenu. `(off)` =
disabled row. Shortcut hints are on the right. Everything else is enabled and
closes the menu when clicked.

### Typical case (services running, two working, one thing needs you, one engine low)

```
[comb]      Squad · 2 working, 3 ready                       ⌘O
[avatar!]   Eva is asking: approve push to main
[avatar•]   Noah · Working on checkout tests
[avatar•]   Eva · Waiting for you
[avatar•]   Chief of Staff · Ready
[avatar•]   Mia · Ready
[avatar•]   Leo · Paused
            All members (9) ▸
[headroom]  Claude Code low · 12% left, resets Fri 9:00 am ▸
──────────
            Quick chat                                       ⌘⇧K
            Settings…                                        ⌘,
            Account ▸
            Services ▸
            Help ▸
──────────
            Quit Autohand Squad                              ⌘Q
```

That is 15 rows against today's 30, and the first nine are about the squad.

### Row-by-row

| # | Row | Image | State | Click |
|---|-----|-------|-------|-------|
| 1 | **Squad header.** `Squad · {n} working, {m} ready` | comb (3.1) | enabled, ⌘O | Opens and focuses the main Squad window on its current route. This row replaces "Open Autohand Squad". |
| 2 | **Needs you.** Only present when something waits on the person. See 2.1. | avatar with needs-you badge, or needs-you hex | enabled | Opens that item, or the Needs you view. |
| 3–7 | **Member rows**, at most five. See 2.2. | member avatar with presence badge (3.3) | enabled | Opens Quick Chat with that member, anchored to the status item. |
| 8 | `All members ({total}) ▸` only when there are more than five members. | none | submenu | Every member in the same row format, sorted the same way, then a separator, then `Add a member…` (opens the app's New › Agent). |
| 9 | **Headroom.** One sentence about the limit that matters most. See 2.3. | headroom mark (3.2) | submenu | Submenu described in 2.3. |
| — | separator | | | |
| 10 | `Quick chat` | none | enabled, ⌘⇧K | Opens the Quick Chat popover with the last member, the same as left-clicking the icon. Keeps the primary action reachable from the keyboard and VoiceOver. |
| 11 | `Settings…` | none | enabled, ⌘, | Opens Settings in the main window. |
| 12 | `Account ▸` | none | submenu | See 2.4. |
| 13 | `Services ▸` | none | submenu | See 2.5. |
| 14 | `Help ▸` | none | submenu | See 2.6. |
| — | separator | | | |
| 15 | `Quit Autohand Squad` | none | enabled, ⌘Q | Quits. Same behaviour as today. |

The person is never shown as an image. There is no top-level email or plan
line, no "Refresh usage", and no service controls. They moved; nothing was
deleted (see section 6).

### 2.1 Needs you row

- **One item:** the row is the item itself. Text: `{Member} is asking: {short
  question}` or `{Member} needs approval: {action}`, with the subject cut to
  40 characters with a trailing ellipsis. Image: that member's avatar with the
  needs-you badge. Click opens the item in the main window.
- **Two or more:** `{n} things need you ▸` with the plain needs-you hex
  (3.4). The submenu lists each item in the one-item format, newest first, up
  to eight, then a separator and `Open Needs you` (⌘1), which opens the
  Needs you view.
- **None:** no row. A calm menu is how the person can tell nothing is waiting.

### 2.2 Member rows

Order: needs you, then working, then ready, then paused, then offline. Within
each group, most recent activity first. Show the first five at the top level.
The comb uses the same order, so cell n and row n are the same person.

Text is `{Name} · {what they are doing}`. The words carry the state on their
own:

| State (data) | Text after the dot |
|---|---|
| working, with task title | `Working on {task title, cut to 32 chars…}` |
| working, no title | `Working` |
| working on fallback | `On Codex until Claude Code resets 4:10 pm` (engine names are the member's own primary and fallback) |
| has a needs-you item | `Waiting for you` |
| online or idle | `Ready` |
| online with queued jobs | `Ready · 3 queued` |
| working with queued jobs | `Working on {title} · 2 more queued` |
| paused | `Paused` |
| offline | `Offline` |

"Online" and "idle" both become **Ready**. In the menu, both mean the member
can take work now, and splitting them would bring back the amber dot that
collides with the needs-you colour.

### 2.3 Headroom row and submenu

**Which limit drives the row.** Consider every metered window that powers
at least one member who is not offline: the Autohand Code plan windows if any
member runs on Autohand Code, and each connected engine's windows if any
member uses it as primary or saved fallback. Take the window with the least
left. On a tie, pick the one that resets first. `left = 100 − percent used`.

**Row text** (sentence case, absolute reset times; see 6.4):

| Condition | Text |
|---|---|
| no data yet | `Checking headroom…` |
| fetch failed | `Headroom unavailable` |
| tightest window > 50% left | `Plenty of headroom` |
| 21–50% left | `Headroom · Codex 34% left this week` |
| 1–20% left | `Claude Code low · 12% left, resets Fri 9:00 am` |
| 0% left, member on fallback | `Claude Code out until 4:10 pm · Noah on Codex` |
| 0% left, no fallback | `Codex out until Fri 9:00 am` |
| two or more windows at 0% | `2 engines out · first back Fri 9:00 am` |
| Autohand plan window at 0% | `Autohand Code out until Dec 9` |

The row is a submenu with an image. `tauri::menu::Submenu::new_with_icon`
exists in tauri 2.11.6, and muda 0.19.3 has `Submenu::set_icon`, so no custom
view is needed.

**Submenu contents.** Each engine gets a disabled heading that says who it
powers, then one enabled row per window:

```
            Autohand Code Free · Chief of Staff            (off)
[headroom]  This month · 0% left · resets Dec 9
[headroom]  5-hour window · 100% left · resets 4:12 pm
            Upgrade plan…
──────────
            Claude Code · Eva, Noah                        (off)
[headroom]  This week · 92% left · resets Fri 9:00 am
──────────
            Codex · backup for Noah                        (off)
[headroom]  This week · 0% left · resets Sat 6:00 pm
──────────
            Refresh now
            Usage settings…
```

- Engine order: first the engines that power working members, then the
  engines that power anyone else, then engines nobody uses, under the heading
  `{Engine} · not used by anyone`.
- Window labels: `5-hour window`, `Today`, `This week`, `This month`.
  Percent is always shown as **left**, never "used". One direction for every
  number in the menu.
- Window rows are enabled, so they keep full contrast, and clicking one opens
  Settings › Usage. Headings are disabled because they are labels.
- `Upgrade plan…` appears only under the Autohand heading, only when one of
  its windows is at or below 20% left. It opens the plan page.
- `Refresh now` fetches usage and rebuilds the menu. It replaces the
  top-level "Refresh usage".
- When the error note is present: the row says `Couldn't reach {engine}:
  {short reason}` (disabled) under that engine's heading, and `Refresh now`
  stays.
- When the person has turned usage off in Settings › Quick Chat
  (`quick_chat_show_usage = false`), row 9 is removed altogether.

### 2.4 Account submenu

```
            Signed in as igor@example.com                  (off)
            Autohand Code Pro                              (off)
            Manage plan…
            Sign out
```

When signed out, the submenu goes and the top level shows `Sign in…` in its
place, so there is always exactly one account row.

### 2.5 Services submenu

```
            Running since 9:12 am                          (off)
            iPhone reachable via relay                     (off)
            Restart services
            Stop services
──────────
 ✓          Launch at login
            Open logs folder
```

- The first line is `Running since {time}`, `Stopped`, or `Starting…`.
- The phone line appears only when a phone is paired. It reads `{Device name}
  reachable on Wi‑Fi`, `… reachable via relay`, or `… not reachable`. Clicking
  is not needed; Settings › Computers is where you act on it.
- When stopped, the submenu offers `Start services` in place of Restart and
  Stop.
- `Launch at login` keeps today's rule: disabled while services are not
  running.

### 2.6 Help submenu

```
            Check for updates…
            Report a bug…
            Give feedback…
──────────
            About Autohand Squad
```

"Check for upgrades…" becomes "Check for updates…", the macOS wording that
DESIGN.md line 175 already uses.

---

## 3. Images

Every image is drawn in Rust as RGBA at 2× and handed to muda. macOS shows it
18 pt tall, so **all canvases are 36 px tall**, and the width sets the aspect
ratio. Draw with the existing 4×4 supersampled coverage helper in
`src-tauri/src/tray_art.rs` so edges are smooth. The background is always
fully transparent.

### Palette

These colours are fixed: menus are not templates, and these images must read
on the light menu (about `#ECECEC` behind vibrancy) and the dark menu (about
`#2C2C2E`). Each colour was picked to reach roughly 3:1 non-text contrast
against both (WCAG 1.4.11). Figures are relative-luminance estimates;
check them in the preview test before shipping.

| Token | Hex | Use | approx. vs light / dark |
|---|---|---|---|
| `ink` | `#7C7C80` | neutral strokes and lit cells | 3.6 / 3.3 |
| `ink-faint` | `#7C7C80` at α 0x73 (45%) | unlit cells, offline | decorative, intentionally below 3:1 |
| `work` | `#0A84FF` | working | 3.2 / 3.7 |
| `ready` | `#1E9E5A` | ready (online or idle) | 3.0 / 4.0 |
| `you` | `#D9720B` | needs you; headroom low | 3.4 / 3.5 |
| `out` | `#E5484D` | limit reached | 4.0 / 3.0 |

Rule: **orange always means "you may want to act"** (something needs you, or
an engine is nearly out). Red means the engine has stopped. Blue and green
are presence. Nothing else in the menu has colour.

### 3.1 The comb (Squad header)

One pointy-top hexagon per member, laid in a single row, in the member-row
order.

- Canvas: height 36 px; width `18 × cells` px. Up to 8 cells (144 × 36 px,
  72 × 18 pt). With more than 8 members, draw 7 member cells and use the 8th
  slot for an overflow mark: three `ink` dots, 3 px diameter, at x = slot
  centre −6, 0, +6, y = 18.
- Cell geometry: centre `(9 + 18·i, 18)`, circumradius 8 px (16 px tall,
  13.86 px wide), vertices at −90° + 60°·k. That leaves a gap of about 4 px
  between neighbours, so each cell reads as its own member.
- Cell states:

| Member state | Drawing |
|---|---|
| needs you | solid `you` fill |
| working (also on fallback) | solid `work` fill |
| ready | 2 px `ready` stroke, inset so the outer edge sits on the hexagon, empty inside |
| paused | 2 px `ink` stroke plus two vertical `ink` bars, each 2 × 6 px, at x = centre ± 2.5, centred on y = 18 |
| offline | 1.5 px `ink-faint` stroke, empty |
| unknown or loading | 1.5 px `ink-faint` stroke, dashed 3 on, 3 off |

- Services stopped: every cell is drawn offline, and the header text says
  so (section 4).
- No members: the comb is one dashed unknown cell (18 × 36 px).

Why shape and fill instead of colour alone: solid means active, outline means
available, faint means away. That holds in greyscale and for people who
cannot tell blue from green.

### 3.2 The headroom mark

The Squad hexagon with ten round cells inside: the brand mark turned into a
gauge.

- Canvas: 36 × 36 px.
- Hexagon: pointy-top, centre (18, 18), circumradius 16 px, 2 px stroke
  drawn inside the path.
- Cells: circles of radius 2.75 px, in four rows (2, 3, 3, 2) that fit
  inside the hexagon:

| Row | y | x centres |
|---|---|---|
| top | 9.5 | 14.75, 21.25 |
| upper middle | 15.0 | 11.5, 18.0, 24.5 |
| lower middle | 21.0 | 11.5, 18.0, 24.5 |
| bottom | 26.5 | 14.75, 21.25 |

- Lighting: `lit = ceil(left / 10)`, clamped to 0..10, where `left = 100 −
  percent used`. Rounding up means any remaining capacity shows at least one
  cell, and only a window that has really run out goes empty. Light cells
  from the bottom row upward, left to right within each row, the way a comb
  fills.
- Lit cell: solid fill. Unlit cell: 1 px stroke in `ink-faint`, no fill.

| Condition | Hex stroke | Lit cells | Unlit cells |
|---|---|---|---|
| > 20% left | `ink` | `ink` | `ink-faint` outline |
| 1–20% left (1 or 2 cells) | `you` | `you` | `ink-faint` outline |
| 0% left | `out` | none | `out` at α 0x59 (35%) outline |
| unknown, loading or error | `ink-faint`, dashed 4 on, 3 off | none | none (empty hexagon) |

Reference points: 0% used gives 10 lit grey cells. 8% used (92% left) gives
10 lit (ceil 9.2). 55% used gives 5 lit. 88% used gives 2 lit, orange. 100%
used gives 0 lit and a red outline.

On the top-level headroom row, the mark shows the window chosen in 2.3. In
the submenu, each window row shows its own.

The cells are all the same size. The real logo's cells are organic and
uneven, but at 9 pt uniform circles let a glance count how full the mark is.
The hexagon outline and the round cells are enough to read as Squad.

### 3.3 Member avatar with presence badge

- Canvas: 36 × 36 px.
- Portrait: the member's PNG, cover-cropped to a square and clipped to a
  circle at centre (18, 18), radius 17 px. No ring.
- Missing portrait: a `ink` disc at α 0x40 (25%), radius 17, with a
  pointy-top hexagon outline (circumradius 7, 1.5 px `ink` stroke) in the
  centre. Initials are not drawn because the shell has no text rasteriser,
  and the row text names the member anyway.
- Badge cut-out: clear the portrait to α 0 inside a circle at (29, 29),
  radius 7.5 px. Nothing is painted there, so the cut-out shows the menu
  background in both light and dark mode.
- Badge, centred at (29, 29):

| State | Badge |
|---|---|
| needs you | pointy-top hexagon, circumradius 6, solid `you` (the row's "!" in shape form) |
| working | disc radius 5.5, solid `work` |
| working on fallback | disc radius 5.5, `work`, with a 2 px clear notch: a transparent vertical stripe x = 28..30 through the disc, showing the member is running on a substitute |
| ready | disc radius 5.5, solid `ready` |
| paused | disc radius 5.5, 2 px `ink` stroke, two 1.5 × 4 px `ink` bars inside |
| offline | disc radius 5, 1.5 px `ink-faint` stroke, empty; the portrait is also desaturated (luma) and drawn at α 0xA6 (65%) |

Member rows are enabled, so the system never greys the portrait; the offline
look is drawn deliberately.

### 3.4 Needs-you mark (plural row)

- Canvas: 36 × 36 px. Pointy-top hexagon centred (18, 18), circumradius 12,
  solid `you`. Inside it, one vertical "!" knocked out to transparency: a
  rounded rectangle 3 × 10 px from y = 11 to 21, and a 3 px dot centred at
  y = 25. Knocking out keeps it legible on both menu backgrounds without
  needing a white that would glow in dark mode.

### 3.5 What has no image

The footer rows, the submenu headings, Account, Services and Help have no
image. Images belong only to rows about the squad and its headroom.
Decorating actions with icons would compete with the comb.

### 3.6 Status item and the attention dot (built, ADR-0249)

The menu-bar icon is the template `tray-template.png`. While anything needs
you (exactly the items the needs-you row shows), the shell draws the same
template with a 5 pt dot in the lower right, centred 3 pt in from the right
and bottom edges, and a 1.25 pt clear gap around it
(`tray_art::with_attention_dot`). It stays a template, so the dot works
through shape alone and macOS paints it in the bar's foreground on light,
dark and tinted menu bars. In Agent avatars mode the waiting member's
portrait gets the same dot in `you` orange. The icon is replaced only when
the dot's state changes. Settings › Quick Chat › "Show when something needs
you" turns it off, together with the VoiceOver announcement (§5); it is on
by default.

---

## 4. States

Each case shows the rows that differ from the typical menu.

**Everything fine.** `[comb] Squad · 1 working, 4 ready`; member rows; no
needs-you row; `[headroom: 7–10 grey cells] Plenty of headroom ▸`.

**Something needs you.** The needs-you row sits directly under the header
(2.1), the member's comb cell turns solid orange, and that member moves to
the first member row with `Waiting for you`. The status item gains its
attention dot (3.6), its VoiceOver name becomes "Autohand Squad, 1 thing
needs you", and VoiceOver announces the new item (5).

**A limit nearly reached** (Claude Code at 88% used). `[headroom: 2 orange
cells, orange outline] Claude Code low · 12% left, resets Fri 9:00 am ▸`.
Nothing else in the menu changes colour.

**A member on fallback** (Claude Code at 100%, Noah answering via Codex).
Noah's row: `[avatar, blue notched badge] Noah · On Codex until Claude Code
resets 4:10 pm`. Headroom: `[empty, red outline] Claude Code out until 4:10 pm
· Noah on Codex ▸`. His comb cell stays solid blue, because he is still
working.

**Engine out, no fallback.** That member's row: `Mia · Stopped: Codex limit
reached`. The comb cell is drawn paused-style (`ink` stroke with bars), and
headroom reads `Codex out until Fri 9:00 am`.

**Loading** (first fetch after launch). `[comb: dashed cells] Squad ·
connecting…` (still enabled, still opens the app); member rows are left out
until the bridge answers; `[dashed hexagon] Checking headroom…` as an enabled
submenu containing only `Refresh now`.

**Error** (bridge reachable, usage fetch failed). Comb and members as usual;
`[dashed hexagon] Headroom unavailable ▸`, and the submenu leads with the
reason (disabled) followed by `Refresh now`.

**Services stopped.** `[comb: all offline] Squad is stopped`, and
immediately below it a top-level `Start services` (enabled), promoted
because it is the only useful thing to do. Member rows and headroom are left
out.

**No members.** `[comb: one dashed cell] Squad · no members yet`, then `Add a
member…` (opens New › Agent). Headroom still shows if signed in.

**Signed out.** `[comb] Squad · 1 ready` (members can still run on local
engines), member rows as normal, then `Sign in…` at the top level in place of
Account ▸. The headroom row covers only connected engines. When there are
none, the row is replaced by `Sign in to see headroom` (enabled, which starts
sign-in).

**Many members (12).** The comb shows 7 cells plus the overflow dots, there
are 5 member rows, and `All members (12) ▸` lists the rest.

---

## 5. Accessibility

**Words carry everything.** VoiceOver reads the row's title (AXTitle) and,
after a pause, its help (AXHelp). A menu item's image description is never
exposed (measured, ADR-0249), so the drawings are silent. Every row has to
make sense with no image at all:

- `Squad · 2 working, 3 ready`, not a bare count.
- `Noah · On Codex until Claude Code resets 4:10 pm`, not "Noah ⚠".
- `Claude Code low · 12% left, resets Fri 9:00 am`, which spells out both
  the number and the consequence.

The images repeat what the words say, so nobody misses anything if they are
hidden.

**What VoiceOver reads (built, ADR-0249).**

- Row titles are read as sentences: ` · ` becomes a comma ("Noah, Working on
  checkout tests"), so no punctuation name is spoken at any verbosity.
- Where the screen cuts words, VoiceOver gets them whole: the full question
  or approval (up to 160 characters) and the full task title. "Plenty of
  headroom" adds the number its mark shows: "Plenty of headroom, tightest is
  Codex 82% left this week".
- Rows that act say what they do: header "Opens the Squad window.", needs
  you "Opens Eva's chat in Squad to answer." / "… to approve or decline.",
  member "Opens Quick Chat with Noah.", Quick chat, Open Needs you, Start
  services.
- The Squad status item: label "Autohand Squad" (", 1 thing needs you" while
  something waits), value the header ("2 working, 3 ready", "Stopped"), help
  "Opens the Squad menu: your squad, what needs you, and Quick chat."
- A member's own status item (Agent avatars): label the name, value their
  row's state, help "Opens Quick Chat with {name}.", and VoiceOver's press
  opens their Quick Chat like a click.
- When a question or approval appears that was not there at the last read,
  VoiceOver announces "Squad: Eva needs approval: …" ("Squad: 2 things need
  you" for several) at medium priority. Not at launch, and not when
  Settings › Quick Chat › "Show when something needs you" is off.

Check it with `swift scripts/menu-bar-ax-check.swift <pid>` (read-only) or
against `cargo run --example menu_bar_ax` in `src-tauri`. This matters on macOS 27, which hides menu images unless
`preferredImageVisibility` is set, and for anyone with images turned off.

**Not by colour alone.** Every state differs in shape or fill as well as
colour: solid versus outline versus faint, a dot versus a hexagon badge for
needs you, bars for paused, a notch for fallback, a dashed line for unknown.
The menu stays usable in greyscale and with Differentiate Without Colour
switched on.

**Increase Contrast.** At build time, read
`NSWorkspace.accessibilityDisplayShouldIncreaseContrast`. When it is on:
`ink-faint` becomes `ink` at full alpha, the 1 px and 1.5 px strokes become
2 px, and the dashes become solid (unknown is then recognised by the empty
hexagon and the text). Rebuild the menu on
`NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification`.

**Reduce Transparency.** The menu uses the system's own material, so there
is nothing to change. The images never depend on material showing through.
The badge cut-out shows whatever background is behind it, which is the
reason for using a cut-out instead of a painted ring.

**Keyboard.**
- Shortcut hints: ⌘O header (open Squad), ⌘1 Open Needs you (in the
  submenu), ⌘⇧K Quick chat, ⌘, Settings, ⌘Q Quit. These match the app's own
  main menu, so nothing new needs learning.
- Member rows get no number shortcuts. Their order changes every minute, so
  ⌘2 would point at a different person from one hour to the next.
- Arrow keys and type-to-select work natively. Type-to-select lands on the
  first word of each row, which is why member rows start with the name.
- Reaching the menu: a left click opens Quick Chat, but VoiceOver's press
  (VO-Space, AXPress) opens this menu, because the tray crate gives the
  status item its menu and only intercepts mouse events. Quick chat is the
  menu's own row (⌘⇧K). The spec first assumed AXPress opened Quick Chat and
  asked for `accessibilityPerformShowMenu`; that was not needed (ADR-0249).
  Control-click and right-click open the menu too.

**Motion.** None. Menus do not animate, and the pulsing "working" dot from
the app is deliberately not copied.

---

## 6. What was deliberately not done

1. **No provider sections at the top level.** The person runs a team, not a
   collection of subscriptions. Engines show up only where they decide
   whether someone can keep working. The cost is that comparing Claude Code
   with Codex takes one extra hover. Settings › Usage remains the full view.

2. **No bars of any shape.** A hexagon strip of ten would still be a progress
   bar, and capsules read as Codync. The headroom mark is coarse (steps of
   10%), and that is accepted because the exact figure is always in the text
   beside it.

3. **"Left", never "used".** It inverts today's numbers. Headroom is the
   word for what the person is managing, and showing a single direction
   removes the "is 8% good or bad?" pause. The cost is a change from what
   the CLI and the Autohand dashboard show.

4. **Absolute reset times** (`resets Fri 9:00 am`), not relative ones (`in 5d
   8h`). The menu is rebuilt about once a minute, and relative text goes
   stale while the menu is open. Absolute times also say whether a reset lands
   tonight or during work hours. Under 24 hours, show the time only (`4:10
   pm`). Six days or more, show the date (`Dec 9`). Follow the system's
   12/24-hour setting.

5. **Idle merged into Ready.** The app keeps the distinction. The menu drops
   it to save amber for needs you.

6. **No custom view.** Live progress, a typing indicator, or two-line rows
   (name above activity) would all need an `NSView` inside the menu, which
   muda cannot host. The native fallback is used throughout: one line
   `{Name} · {activity}`, refreshed every minute. If two-line member rows are
   ever wanted, they belong in Quick Chat, not in this menu.

7. **Services and logs moved into a submenu.** They matter when something is
   broken and get in the way the rest of the time. When services are
   stopped, `Start services` is promoted to the top level, because then it is
   the main action.

8. **Launch at login moved under Services.** It is less visible than a
   top-level checkbox, but the setting is about the services starting, and
   a person changes it once.

9. **No "Refresh usage" at the top level.** Data refreshes every minute and
   when the menu is about to open. A right-click on the status item should
   start a refresh, so the next opening is current. The manual
   `Refresh now` stays inside Headroom for the person who has just upgraded
   a plan.

10. **No member shortcuts, no Option-key alternates.** Alternates
    (`NSMenuItem.isAlternate`) are not exposed by muda 0.19, and ordering
    that changes every minute makes positional shortcuts misleading.

11. **No email at the top.** The current menu leads with who you are. That
    almost never changes, and the menu bar already knows. It lives in
    Account ▸.

12. **No celebration states.** "All caught up!" and similar would be noise.
    No needs-you row already says that.

---

## Contract changes when this ships

- **DESIGN.md line 37**: replace with: "The menu-bar menu is about the squad:
  a comb header, needs you, up to five member rows, and one headroom row.
  Engine limits appear only in the Headroom submenu, grouped by who they
  power. Footer actions are Quick chat, Settings, Account, Services, Help,
  Quit."
- **DESIGN.md line 175**: replace the status-block description with a
  pointer to this file, and keep the sign-in rule (line 176) unchanged.
- **New ADR** superseding ADR-0229. It should record the rejection (the
  capsule bars and provider glyphs read as Codync's), the people-first
  decision, the "left, not used" inversion, and the trade-offs in section 6.
- **`src-tauri/src/tray_art.rs`**: retire `usage_bar`, `provider_colour` and
  `provider_mark`. Add `comb`, `headroom_mark`, `member_avatar_with_badge`
  and `needs_you_mark`, and extend `tray_art_writes_previews` to write each
  state in 3.1–3.4 to PNG on light and dark backgrounds for review.
- **`daemon/src/desktop_tray.rs`**: add to the tray model, per member, the
  primary engine, the fallback engine, any fallback in use, and the current
  task title. Add the needs-you items (id, member, short text). For the
  headroom choice, the model needs a map from each engine to its members.
