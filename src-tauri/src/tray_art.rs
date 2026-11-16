//! Small images for the menu-bar menu: usage bars and provider marks.
//!
//! Native menus cannot draw custom views through muda, but every item may carry
//! an image, which macOS shows at a fixed 18 pt height. Bars are therefore drawn
//! as 120×36 px images (60×18 pt at 2×) with a 6 pt capsule centred vertically,
//! so they sit on the text baseline like a gauge. Colours are fixed (not
//! template images), so the track is a translucent grey that reads on light and
//! dark menus alike.

#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use tauri::image::Image;

const BAR_W: u32 = 120;
const BAR_H: u32 = 36;
const BAR_THICKNESS: f64 = 12.0;
const BAR_INSET: f64 = 2.0;
const TRACK: [u8; 4] = [142, 142, 147, 84];
/// At or past this share the bar turns red, whatever the provider colour.
const NEAR_LIMIT: u8 = 90;
const LIMIT_RED: [u8; 3] = [255, 105, 97];

/// Fill colour per provider id; unknown ids fall back to Autohand's.
pub(crate) fn provider_colour(id: &str) -> [u8; 3] {
    match id {
        "claude" => [217, 119, 87],
        "codex" => [110, 139, 255],
        _ => [94, 200, 168],
    }
}

/// How much of the pixel at (x, y) lies inside `inside`, 4×4 supersampled.
fn coverage(x: u32, y: u32, inside: impl Fn(f64, f64) -> bool) -> f64 {
    let mut hits = 0;
    for sy in 0..4 {
        for sx in 0..4 {
            if inside(
                x as f64 + (sx as f64 + 0.5) / 4.0,
                y as f64 + (sy as f64 + 0.5) / 4.0,
            ) {
                hits += 1;
            }
        }
    }
    hits as f64 / 16.0
}

/// Inside a horizontal capsule from `left` to `right`, centred on `cy`.
fn in_capsule(px: f64, py: f64, left: f64, right: f64, cy: f64, radius: f64) -> bool {
    let cx = px.clamp(left + radius, (right - radius).max(left + radius));
    (px - cx).powi(2) + (py - cy).powi(2) <= radius * radius
}

/// Source-over blend of `colour` at `alpha` (0–1) onto an RGBA pixel.
fn blend(pixel: &mut [u8], colour: [u8; 3], alpha: f64) {
    if alpha <= 0.0 {
        return;
    }
    let below = pixel[3] as f64 / 255.0;
    let out = alpha + below * (1.0 - alpha);
    for channel in 0..3 {
        let value =
            (colour[channel] as f64 * alpha + pixel[channel] as f64 * below * (1.0 - alpha)) / out;
        pixel[channel] = value.round() as u8;
    }
    pixel[3] = (out * 255.0).round() as u8;
}

/// Pixel width of the filled part: any use at all shows a full round cap, so
/// 2% never reads as untouched.
pub(crate) fn fill_width(percent: Option<u8>) -> f64 {
    let track = BAR_W as f64 - BAR_INSET * 2.0;
    match percent {
        Some(0) | None => 0.0,
        Some(value) => (track * value.min(100) as f64 / 100.0).max(BAR_THICKNESS),
    }
}

/// RGBA pixels for a usage bar; `percent` None draws only the track.
pub(crate) fn usage_bar_rgba(percent: Option<u8>, colour: [u8; 3]) -> Vec<u8> {
    let colour = if percent.is_some_and(|value| value >= NEAR_LIMIT) {
        LIMIT_RED
    } else {
        colour
    };
    let radius = BAR_THICKNESS / 2.0;
    let cy = BAR_H as f64 / 2.0;
    let left = BAR_INSET;
    let right = BAR_W as f64 - BAR_INSET;
    let fill_right = left + fill_width(percent);
    let mut rgba = vec![0u8; (BAR_W * BAR_H * 4) as usize];
    for y in 0..BAR_H {
        for x in 0..BAR_W {
            let index = ((y * BAR_W + x) * 4) as usize;
            let pixel = &mut rgba[index..index + 4];
            let track = coverage(x, y, |px, py| in_capsule(px, py, left, right, cy, radius));
            blend(
                pixel,
                [TRACK[0], TRACK[1], TRACK[2]],
                track * TRACK[3] as f64 / 255.0,
            );
            if fill_right > left {
                let fill = coverage(x, y, |px, py| {
                    in_capsule(px, py, left, fill_right, cy, radius)
                });
                blend(pixel, colour, fill);
            }
        }
    }
    rgba
}

pub(crate) fn usage_bar(percent: Option<u8>, colour: [u8; 3]) -> Image<'static> {
    Image::new_owned(usage_bar_rgba(percent, colour), BAR_W, BAR_H)
}

/// A 5×5 dot glyph in the provider colour, in the spirit of Squad's dotted
/// mark: an asterisk for Claude, a prompt for Codex. Not the providers' logos.
pub(crate) fn provider_mark(id: &str) -> Image<'static> {
    const SIZE: u32 = 36;
    let pattern: [&str; 5] = match id {
        "claude" => ["#.#.#", ".###.", "#####", ".###.", "#.#.#"],
        "codex" => ["#....", ".#...", "..#..", ".#...", "#.###"],
        _ => [".###.", "#...#", "#.#.#", "#...#", ".###."],
    };
    let colour = provider_colour(id);
    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let alpha = coverage(x, y, |px, py| {
                pattern.iter().enumerate().any(|(row, line)| {
                    line.bytes().enumerate().any(|(column, cell)| {
                        let cx = 4.0 + column as f64 * 7.0;
                        let cy = 4.0 + row as f64 * 7.0;
                        cell == b'#' && (px - cx).powi(2) + (py - cy).powi(2) <= 2.9 * 2.9
                    })
                })
            });
            let index = ((y * SIZE + x) * 4) as usize;
            blend(&mut rgba[index..index + 4], colour, alpha);
        }
    }
    Image::new_owned(rgba, SIZE, SIZE)
}

/// Squad's own app mark for the Autohand plan heading.
pub(crate) fn autohand_mark() -> Option<Image<'static>> {
    Image::from_bytes(include_bytes!("../icons/64x64.png"))
        .ok()
        .map(|image| image.to_owned())
}

/// macOS 27 hides menu item images unless each item asks for them
/// (`NSMenuItem.preferredImageVisibility = .visible`, AppKit NSMenuItem.h).
/// muda sets the image but not this property, so bars, marks and member
/// avatars vanished. Walk the status item's menu after every update and mark
/// items that carry an image. Older systems lack the selector and are skipped.
#[cfg(target_os = "macos")]
pub(crate) fn keep_menu_images_visible(tray: &tauri::tray::TrayIcon) {
    let _ = tray.with_inner_tray_icon(|inner| {
        use objc2::{msg_send, sel};
        use objc2_app_kit::NSMenu;
        fn mark(menu: &NSMenu) {
            for item in menu.itemArray().iter() {
                if item.image().is_some() {
                    let supported: bool = unsafe {
                        msg_send![&*item, respondsToSelector: sel!(setPreferredImageVisibility:)]
                    };
                    if supported {
                        // NSMenuItemImageVisibilityVisible = 1
                        let _: () =
                            unsafe { msg_send![&*item, setPreferredImageVisibility: 1isize] };
                    }
                }
                if let Some(submenu) = item.submenu() {
                    mark(&submenu);
                }
            }
        }
        if let Some(status_item) = inner.ns_status_item() {
            let Some(mtm) = objc2_foundation::MainThreadMarker::new() else {
                return;
            };
            if let Some(menu) = status_item.menu(mtm) {
                mark(&menu);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alpha_at(rgba: &[u8], x: u32, y: u32) -> u8 {
        rgba[((y * BAR_W + x) * 4 + 3) as usize]
    }
    fn colour_at(rgba: &[u8], x: u32, y: u32) -> [u8; 3] {
        let index = ((y * BAR_W + x) * 4) as usize;
        [rgba[index], rgba[index + 1], rgba[index + 2]]
    }

    #[test]
    fn any_use_shows_a_round_cap_and_none_shows_only_the_track() {
        assert_eq!(fill_width(Some(0)), 0.0);
        assert_eq!(fill_width(None), 0.0);
        assert_eq!(fill_width(Some(1)), BAR_THICKNESS);
        assert_eq!(fill_width(Some(100)), BAR_W as f64 - BAR_INSET * 2.0);
        let empty = usage_bar_rgba(Some(0), provider_colour("claude"));
        assert_eq!(alpha_at(&empty, 60, 18), TRACK[3]);
        assert_eq!(
            alpha_at(&empty, 60, 2),
            0,
            "nothing drawn above the capsule"
        );
    }

    #[test]
    fn fill_uses_the_provider_colour_until_the_limit_is_near() {
        let half = usage_bar_rgba(Some(50), provider_colour("claude"));
        assert_eq!(colour_at(&half, 20, 18), provider_colour("claude"));
        assert_eq!(alpha_at(&half, 20, 18), 255);
        assert_eq!(
            alpha_at(&half, 100, 18),
            TRACK[3],
            "the unused part stays track"
        );
        let full = usage_bar_rgba(Some(100), provider_colour("codex"));
        assert_eq!(colour_at(&full, 60, 18), LIMIT_RED);
    }
}

#[cfg(test)]
mod preview {
    #[test]
    #[ignore = "writes PNGs for a visual check: TRAY_ART_DIR=<dir> cargo test -- --ignored tray_art"]
    fn tray_art_writes_previews() {
        let dir = std::env::var("TRAY_ART_DIR").expect("TRAY_ART_DIR");
        let save = |name: &str, image: tauri::image::Image<'_>| {
            image::RgbaImage::from_raw(image.width(), image.height(), image.rgba().to_vec())
                .unwrap()
                .save(format!("{dir}/{name}.png"))
                .unwrap();
        };
        for (name, percent, id) in [
            ("claude-8", Some(8), "claude"),
            ("claude-0", Some(0), "claude"),
            ("codex-100", Some(100), "codex"),
            ("plan-45", Some(45), "autohand"),
        ] {
            save(name, super::usage_bar(percent, super::provider_colour(id)));
        }
        save("mark-claude", super::provider_mark("claude"));
        save("mark-codex", super::provider_mark("codex"));
    }
}
