# ADR-0229: menu-bar usage drawn as bars

Status: accepted. Amends the tray status block in DESIGN.md (Desktop Shell).

## Context and evidence

The menu-bar menu showed plan and harness limits as disabled text lines with
a Unicode gauge: `Weekly ▰▱▱▱▱▱▱▱ 8% used · resets in 5d 8h`. On the owner's
Mac (screenshot, 2026-11-16) every line was greyed out, the ▰/▱ glyphs varied
in weight and spacing with the system font, and nothing told Claude Code from
Codex at a glance. The owner pointed at Codync's menu, which shows a provider
mark on a heading row and a coloured capsule bar per window at full contrast.

The menu is built with Tauri's muda, which cannot host custom views. Reading
muda 0.19.3 (`platform_impl/macos/mod.rs`), every `IconMenuItem` image is
shown at a fixed 18 pt height with its width scaled to keep the aspect ratio,
and a disabled `NSMenuItem` dims both its text and its image.

## Decision

1. **Bars are images.** `src-tauri/src/tray_art.rs` draws each window as a
   120×36 px RGBA image (60×18 pt at 2×): a 6 pt capsule track in translucent
   grey, filled in the provider colour, 4×4 supersampled for smooth caps. Any
   use at all shows a full round cap, so 1% never reads as untouched. At 90%
   and above the fill turns red whatever the provider, because "nearly out" is
   the one thing the bar must say.
2. **Headings carry a mark.** The plan heading uses Squad's own app icon.
   Claude Code and Codex get a 5×5 dot glyph in their colour (an asterisk and
   a prompt). These are our drawings, not the providers' logos: the repo has no
   licensed logo assets, and the dot style matches Squad's own mark.
3. **Rows are enabled.** Disabled items would grey the bars, which defeats the
   change. Choosing a usage row or heading opens Settings, where usage
   visibility is controlled. The account line, notes and the squad line stay
   disabled.
4. **The daemon passes data, not prose.** `DesktopTrayModel.usage_bars` carries
   title, percent and detail per window (`5-hour`, `Daily`, `Weekly`,
   `Monthly`). The text `usage_lines` remain for Windows and Linux, which keep
   the previous text gauges.

## Consequences

- Colours are fixed, not template images, so they do not follow the menu's
  light or dark appearance; the grey track was chosen to read on both.
- Usage rows highlight on hover like actions. That is a small departure from
  "quiet, disabled lines" and is the price of full-contrast bars.
- Windows and Linux are unchanged and still show the text gauges.
- Verified by unit tests (`tray_art`, `zero_usage_is_not_unknown`,
  `desktop_tray`) and by opening the installed app's menu; see the commit.
