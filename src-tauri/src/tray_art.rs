//! Images for the menu-bar menu (docs/design/menu-bar-menu.md §3, ADR-0236).
//!
//! Squad's mark is a hexagon full of cells, and the menu borrows it in two
//! places only: the comb (one hexagon per member, filled or outlined by what
//! that member is doing) and the headroom mark (the Squad hexagon with ten
//! round cells, lit for the share of a limit that is *left*). Member rows show
//! the member's portrait with a presence badge cut into its corner.
//!
//! muda shows every menu image 18 pt tall, so every canvas is 36 px tall
//! (2×) and its width sets the aspect ratio. Shapes are 4×4 supersampled.
//! Colours are fixed, not template images, and each one was chosen to read
//! on both the light and the dark menu; the preview test measures that.
//! Nothing here is a bar and nothing uses a provider's colour or glyph.

#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use autohand_squad_runtime::desktop_tray::menu::{Badge, Cell};
use tauri::image::Image;

const H: u32 = 36;
const SQRT3: f64 = 1.732_050_807_568_877_2;

/// Neutral strokes and lit cells.
pub(crate) const INK: [u8; 3] = [0x7C, 0x7C, 0x80];
/// `INK` at this alpha for unlit cells and offline members: decorative.
const FAINT_ALPHA: f64 = 0x73 as f64 / 255.0;
pub(crate) const WORK: [u8; 3] = [0x0A, 0x84, 0xFF];
/// Spec #1E9E5A measured 2.92:1 on the light menu; darkened to reach 3:1 on both.
pub(crate) const READY: [u8; 3] = [0x1C, 0x93, 0x54];
/// Needs you, and headroom low: "you may want to act". Spec #D9720B measured
/// 2.79:1 on the light menu; darkened to reach 3:1 on both.
pub(crate) const YOU: [u8; 3] = [0xCA, 0x6A, 0x0A];
/// The engine has stopped.
pub(crate) const OUT: [u8; 3] = [0xE5, 0x48, 0x4D];

/// System accessibility settings that change the drawing.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Look {
    /// Increase Contrast: faint becomes full ink, thin strokes become 2 px,
    /// dashes become solid.
    pub increase_contrast: bool,
}

impl Look {
    fn faint(self) -> f64 {
        if self.increase_contrast {
            1.0
        } else {
            FAINT_ALPHA
        }
    }
    fn thin(self, width: f64) -> f64 {
        if self.increase_contrast {
            width.max(2.0)
        } else {
            width
        }
    }
    fn dashed(self, on: f64, off: f64) -> Option<(f64, f64)> {
        (!self.increase_contrast).then_some((on, off))
    }
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

struct Canvas {
    width: u32,
    rgba: Vec<u8>,
}

impl Canvas {
    fn new(width: u32) -> Self {
        Self {
            width,
            rgba: vec![0; (width * H * 4) as usize],
        }
    }

    /// How much of the pixel at (x, y) lies inside `inside`, 4×4 supersampled.
    fn coverage(x: u32, y: u32, inside: &impl Fn(f64, f64) -> bool) -> f64 {
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

    /// Source-over `colour` at `alpha` wherever `inside` holds.
    fn paint(&mut self, colour: [u8; 3], alpha: f64, inside: impl Fn(f64, f64) -> bool) {
        for y in 0..H {
            for x in 0..self.width {
                let cover = Self::coverage(x, y, &inside);
                if cover > 0.0 {
                    let index = ((y * self.width + x) * 4) as usize;
                    blend(&mut self.rgba[index..index + 4], colour, cover * alpha);
                }
            }
        }
    }

    /// Erase to transparency wherever `inside` holds (a knock-out).
    fn clear(&mut self, inside: impl Fn(f64, f64) -> bool) {
        for y in 0..H {
            for x in 0..self.width {
                let cover = Self::coverage(x, y, &inside);
                if cover > 0.0 {
                    let index = ((y * self.width + x) * 4 + 3) as usize;
                    self.rgba[index] = (self.rgba[index] as f64 * (1.0 - cover)).round() as u8;
                }
            }
        }
    }

    fn into_image(self) -> Image<'static> {
        Image::new_owned(self.rgba, self.width, H)
    }
}

/// Source-over blend of `colour` at `alpha` (0–1) onto a straight-alpha pixel.
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

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/// Inside a pointy-top hexagon with circumradius `r` centred on (cx, cy).
fn in_hex(px: f64, py: f64, cx: f64, cy: f64, r: f64) -> bool {
    let dx = (px - cx).abs();
    let dy = (py - cy).abs();
    dx <= r * SQRT3 / 2.0 && dy <= r - dx / SQRT3
}

/// A hexagon outline `width` thick, drawn inside the path, optionally dashed
/// (`on`, `off` in pixels along the perimeter).
fn in_hex_stroke(
    px: f64,
    py: f64,
    cx: f64,
    cy: f64,
    r: f64,
    width: f64,
    dash: Option<(f64, f64)>,
) -> bool {
    let inner = (r * SQRT3 / 2.0 - width) * 2.0 / SQRT3;
    if !in_hex(px, py, cx, cy, r) || in_hex(px, py, cx, cy, inner.max(0.0)) {
        return false;
    }
    on_dash(px, py, cx, cy, 6.0 * r, dash)
}

fn in_disc(px: f64, py: f64, cx: f64, cy: f64, r: f64) -> bool {
    (px - cx).powi(2) + (py - cy).powi(2) <= r * r
}

fn in_ring(
    px: f64,
    py: f64,
    cx: f64,
    cy: f64,
    r: f64,
    width: f64,
    dash: Option<(f64, f64)>,
) -> bool {
    let d2 = (px - cx).powi(2) + (py - cy).powi(2);
    d2 <= r * r
        && d2 >= (r - width).max(0.0).powi(2)
        && on_dash(px, py, cx, cy, std::f64::consts::TAU * r, dash)
}

/// Dash test by position along the perimeter, measured as an angle from the
/// top, clockwise.
fn on_dash(px: f64, py: f64, cx: f64, cy: f64, perimeter: f64, dash: Option<(f64, f64)>) -> bool {
    let Some((on, off)) = dash else {
        return true;
    };
    let angle = (px - cx).atan2(-(py - cy)).rem_euclid(std::f64::consts::TAU);
    let along = angle / std::f64::consts::TAU * perimeter;
    along.rem_euclid(on + off) < on
}

fn in_rect(px: f64, py: f64, left: f64, top: f64, width: f64, height: f64) -> bool {
    px >= left && px <= left + width && py >= top && py <= top + height
}

/// A rectangle with fully rounded ends along its long side.
fn in_rounded_bar(px: f64, py: f64, cx: f64, top: f64, width: f64, height: f64) -> bool {
    let radius = width / 2.0;
    let cy = py.clamp(top + radius, top + height - radius);
    in_disc(px, py, cx, cy, radius)
}

// ---------------------------------------------------------------------------
// The comb (§3.1)
// ---------------------------------------------------------------------------

/// Slot centres of the comb: a honeycomb of seven small hexagons inside
/// 18×18 pt, read like text (top row, middle row, bottom row; left to right),
/// so cell n is member row n.
///
/// The spec drew one hexagon per member in a single row up to 72 pt wide.
/// AppKit gives every row of a menu one image column as wide as its widest
/// image (measured: 130 pt menu → 154 pt with an 18 pt image, 208 pt with a
/// 72 pt one), so a wide comb would indent every row by 72 pt (ADR-0236).
const COMB_R: f64 = 5.5;
const COMB_SLOTS: [(f64, f64); 7] = [
    (12.5, 8.474),
    (23.5, 8.474),
    (7.0, 18.0),
    (18.0, 18.0),
    (29.0, 18.0),
    (12.5, 27.526),
    (23.5, 27.526),
];

pub(crate) fn comb(cells: &[Cell], look: Look) -> Image<'static> {
    comb_canvas(cells, look).into_image()
}

fn comb_canvas(cells: &[Cell], look: Look) -> Canvas {
    // Unknown (loading, no members yet): the whole comb is dashed.
    let unknown = [Cell::Unknown; 7];
    let cells = if cells.is_empty() || cells == [Cell::Unknown] {
        &unknown[..]
    } else {
        cells
    };
    let mut canvas = Canvas::new(36);
    let r = COMB_R;
    for (cell, (cx, cy)) in cells.iter().zip(COMB_SLOTS) {
        match cell {
            Cell::NeedsYou => canvas.paint(YOU, 1.0, |x, y| in_hex(x, y, cx, cy, r)),
            Cell::Working => canvas.paint(WORK, 1.0, |x, y| in_hex(x, y, cx, cy, r)),
            Cell::Ready => {
                canvas.paint(READY, 1.0, |x, y| in_hex_stroke(x, y, cx, cy, r, 1.5, None))
            }
            Cell::Paused => {
                canvas.paint(INK, 1.0, |x, y| in_hex_stroke(x, y, cx, cy, r, 1.5, None));
                canvas.paint(INK, 1.0, |x, y| {
                    in_rect(x, y, cx - 1.5 - 0.5, cy - 1.75, 1.0, 3.5)
                        || in_rect(x, y, cx + 1.5 - 0.5, cy - 1.75, 1.0, 3.5)
                });
            }
            Cell::Offline => canvas.paint(INK, look.faint(), |x, y| {
                in_hex_stroke(x, y, cx, cy, r, look.thin(1.0), None)
            }),
            Cell::Unknown => canvas.paint(INK, look.faint(), |x, y| {
                in_hex_stroke(x, y, cx, cy, r, look.thin(1.0), look.dashed(2.0, 2.0))
            }),
            Cell::Overflow => canvas.paint(INK, 1.0, |x, y| {
                [-3.5, 0.0, 3.5]
                    .iter()
                    .any(|offset| in_disc(x, y, cx + offset, cy, 1.0))
            }),
        }
    }
    canvas
}

// ---------------------------------------------------------------------------
// The headroom mark (§3.2)
// ---------------------------------------------------------------------------

/// Cell centres in lighting order: bottom row first, left to right, the way
/// a comb fills.
const HEADROOM_CELLS: [(f64, f64); 10] = [
    (14.75, 26.5),
    (21.25, 26.5),
    (11.5, 21.0),
    (18.0, 21.0),
    (24.5, 21.0),
    (11.5, 15.0),
    (18.0, 15.0),
    (24.5, 15.0),
    (14.75, 9.5),
    (21.25, 9.5),
];
const HEADROOM_CELL_R: f64 = 2.75;
const UNLIT_R: f64 = 1.25;

/// Lit cells for `left` percent: rounded up, so any capacity shows one cell
/// and only a window that has run out is empty.
pub(crate) fn lit_cells(left: u8) -> usize {
    (left.min(100) as usize).div_ceil(10).min(10)
}

/// The Squad hexagon with ten cells lit for the share of a limit that is
/// left. `None` draws the dashed, empty hexagon of unknown or loading.
pub(crate) fn headroom_mark(left: Option<u8>, look: Look) -> Image<'static> {
    headroom_canvas(left, look).into_image()
}

fn headroom_canvas(left: Option<u8>, look: Look) -> Canvas {
    let mut canvas = Canvas::new(36);
    let (cx, cy, r) = (18.0, 18.0, 16.0);
    let Some(left) = left else {
        canvas.paint(INK, look.faint(), |x, y| {
            in_hex_stroke(x, y, cx, cy, r, 2.0, look.dashed(4.0, 3.0))
        });
        return canvas;
    };
    let lit = lit_cells(left);
    let (tone, unlit, unlit_alpha) = match left {
        0 => (OUT, OUT, if look.increase_contrast { 1.0 } else { 0x59 as f64 / 255.0 }),
        1..=20 => (YOU, INK, look.faint()),
        _ => (INK, INK, look.faint()),
    };
    canvas.paint(tone, 1.0, |x, y| in_hex_stroke(x, y, cx, cy, r, 2.0, None));
    for (index, (px, py)) in HEADROOM_CELLS.iter().enumerate() {
        if index < lit {
            canvas.paint(tone, 1.0, |x, y| in_disc(x, y, *px, *py, HEADROOM_CELL_R));
        } else {
            // An unlit cell is a small faint dot: at 18 pt a 1 px ring of the
            // full cell reads as filled, and an empty mark looked full.
            canvas.paint(unlit, unlit_alpha, |x, y| {
                in_disc(x, y, *px, *py, UNLIT_R)
            });
        }
    }
    canvas
}

// ---------------------------------------------------------------------------
// Member avatar with presence badge (§3.3)
// ---------------------------------------------------------------------------

pub(crate) const PORTRAIT: u32 = 36;
const BADGE: (f64, f64) = (29.0, 29.0);

/// The member's portrait (a 36×36 RGBA square, already cover-cropped) clipped
/// to a circle, with the badge cut out of the lower-right corner so the menu's
/// own background shows around it in light and dark mode alike.
pub(crate) fn member_avatar(portrait: Option<&[u8]>, badge: Badge, look: Look) -> Image<'static> {
    avatar_canvas(portrait, badge, look).into_image()
}

fn avatar_canvas(portrait: Option<&[u8]>, badge: Badge, look: Look) -> Canvas {
    let mut canvas = Canvas::new(PORTRAIT);
    let offline = badge == Badge::Offline;
    let portrait = portrait.filter(|pixels| pixels.len() == (PORTRAIT * PORTRAIT * 4) as usize);
    match portrait {
        Some(pixels) => {
            for y in 0..H {
                for x in 0..PORTRAIT {
                    let cover =
                        Canvas::coverage(x, y, &|px, py| in_disc(px, py, 18.0, 18.0, 17.0));
                    if cover <= 0.0 {
                        continue;
                    }
                    let index = ((y * PORTRAIT + x) * 4) as usize;
                    let mut colour = [pixels[index], pixels[index + 1], pixels[index + 2]];
                    let mut alpha = pixels[index + 3] as f64 / 255.0 * cover;
                    if offline {
                        let luma = (0.2126 * colour[0] as f64
                            + 0.7152 * colour[1] as f64
                            + 0.0722 * colour[2] as f64)
                            .round() as u8;
                        colour = [luma; 3];
                        alpha *= 0xA6 as f64 / 255.0;
                    }
                    blend(&mut canvas.rgba[index..index + 4], colour, alpha);
                }
            }
        }
        None => {
            let dim = if offline { 0xA6 as f64 / 255.0 } else { 1.0 };
            canvas.paint(INK, 0x40 as f64 / 255.0 * dim, |x, y| {
                in_disc(x, y, 18.0, 18.0, 17.0)
            });
            canvas.paint(INK, dim, |x, y| in_hex_stroke(x, y, 18.0, 18.0, 7.0, 1.5, None));
        }
    }
    let (bx, by) = BADGE;
    canvas.clear(|x, y| in_disc(x, y, bx, by, 7.5));
    match badge {
        Badge::NeedsYou => canvas.paint(YOU, 1.0, |x, y| in_hex(x, y, bx, by, 6.0)),
        Badge::Working => canvas.paint(WORK, 1.0, |x, y| in_disc(x, y, bx, by, 5.5)),
        Badge::Fallback => {
            canvas.paint(WORK, 1.0, |x, y| in_disc(x, y, bx, by, 5.5));
            canvas.clear(|x, y| (28.0..=30.0).contains(&x) && in_disc(x, y, bx, by, 6.0));
        }
        Badge::Ready => canvas.paint(READY, 1.0, |x, y| in_disc(x, y, bx, by, 5.5)),
        Badge::Paused => {
            canvas.paint(INK, 1.0, |x, y| in_ring(x, y, bx, by, 5.5, 2.0, None));
            canvas.paint(INK, 1.0, |x, y| {
                in_rect(x, y, bx - 1.25 - 0.75, by - 2.0, 1.5, 4.0)
                    || in_rect(x, y, bx + 1.25 - 0.75, by - 2.0, 1.5, 4.0)
            });
        }
        Badge::Offline => canvas.paint(INK, look.faint(), |x, y| {
            in_ring(x, y, bx, by, 5.0, look.thin(1.5), None)
        }),
    }
    canvas
}

// ---------------------------------------------------------------------------
// Needs-you mark (§3.4)
// ---------------------------------------------------------------------------

/// A solid orange hexagon with a "!" knocked out to transparency, so it reads
/// on both menu backgrounds without a white that glows in dark mode.
pub(crate) fn needs_you_mark() -> Image<'static> {
    needs_you_canvas().into_image()
}

fn needs_you_canvas() -> Canvas {
    let mut canvas = Canvas::new(36);
    canvas.paint(YOU, 1.0, |x, y| in_hex(x, y, 18.0, 18.0, 12.0));
    canvas.clear(|x, y| in_rounded_bar(x, y, 18.0, 11.0, 3.0, 10.0) || in_disc(x, y, 18.0, 25.0, 1.5));
    canvas
}

// ---------------------------------------------------------------------------
// The attention dot on a status item (ADR-0248)
// ---------------------------------------------------------------------------

/// The Squad status item's template: a hexagon of cells, 72 px for 18 pt.
pub(crate) const SQUAD_TEMPLATE: &[u8] = include_bytes!("../icons/tray-template.png");

/// The dot, in points of an 18 pt tall status icon: a 5 pt disc in the lower
/// right, the spec's size (§3.6), with a 1.25 pt clear gap cut around it so it
/// reads as a mark on the icon rather than a blob attached to it.
const DOT_CENTRE: f64 = 18.0 - 3.0;
const DOT_RADIUS: f64 = 2.5;
const DOT_GAP: f64 = 1.25;

/// `rgba` (straight alpha, `width` × `height`) with the attention dot. The
/// pixels under the dot and its gap are replaced, everything else is kept.
///
/// On the Squad icon the colour is black and the image stays a template, so
/// macOS draws the dot in the menu bar's own foreground: right on light, dark
/// and tinted menu bars, with no colour to clash. On a member's portrait
/// (Agent avatars) it is `YOU`, the menu's "you may want to act" orange, and
/// the gap shows the menu bar between dot and portrait.
pub(crate) fn with_attention_dot(rgba: &[u8], width: u32, height: u32, colour: [u8; 3]) -> Vec<u8> {
    let mut out = rgba.to_vec();
    let scale = height as f64 / 18.0;
    let cx = width as f64 - (18.0 - DOT_CENTRE) * scale;
    let cy = DOT_CENTRE * scale;
    let dot = DOT_RADIUS * scale;
    let clear = (DOT_RADIUS + DOT_GAP) * scale;
    for y in 0..height {
        for x in 0..width {
            let cleared = Canvas::coverage(x, y, &|px, py| in_disc(px, py, cx, cy, clear));
            if cleared == 0.0 {
                continue;
            }
            let index = ((y * width + x) * 4) as usize;
            let pixel = &mut out[index..index + 4];
            pixel[3] = (pixel[3] as f64 * (1.0 - cleared)).round() as u8;
            let cover = Canvas::coverage(x, y, &|px, py| in_disc(px, py, cx, cy, dot));
            blend(pixel, colour, cover);
        }
    }
    out
}

/// The Squad status icon as RGBA, with or without the attention dot.
pub(crate) fn squad_status_icon(attention: bool) -> Option<Image<'static>> {
    let base = Image::from_bytes(SQUAD_TEMPLATE).ok()?;
    if !attention {
        return Some(base.to_owned());
    }
    let (width, height) = (base.width(), base.height());
    Some(Image::new_owned(
        with_attention_dot(base.rgba(), width, height, [0, 0, 0]),
        width,
        height,
    ))
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

/// Increase Contrast, read when the menu is built (every refresh).
#[cfg(target_os = "macos")]
pub(crate) fn system_look() -> Look {
    use objc2::{class, msg_send};
    let increase_contrast: bool = unsafe {
        let workspace: *mut objc2::runtime::AnyObject =
            msg_send![class!(NSWorkspace), sharedWorkspace];
        !workspace.is_null() && msg_send![workspace, accessibilityDisplayShouldIncreaseContrast]
    };
    Look { increase_contrast }
}

/// Whether the person's clock shows am/pm: the localized `j` skeleton
/// contains `a` exactly when the system is set to a 12-hour clock.
#[cfg(target_os = "macos")]
pub(crate) fn system_hour12() -> bool {
    use objc2::rc::Retained;
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;
    unsafe {
        let locale: *mut objc2::runtime::AnyObject = msg_send![class!(NSLocale), currentLocale];
        let template = NSString::from_str("j");
        let format: Option<Retained<NSString>> = msg_send![
            class!(NSDateFormatter),
            dateFormatFromTemplate: &*template,
            options: 0usize,
            locale: locale
        ];
        format.is_none_or(|format| format.to_string().contains('a'))
    }
}

/// macOS 27 hides menu item images unless each item asks for them
/// (`NSMenuItem.preferredImageVisibility = .visible`, AppKit NSMenuItem.h).
/// muda sets the image but not this property, so the comb, avatars and
/// headroom marks vanished. Walk the status item's menu after every update and
/// mark items that carry an image. Older systems lack the selector and are
/// skipped (ADR-0229, kept by ADR-0236).
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

    fn pixel(canvas: &Canvas, x: u32, y: u32) -> [u8; 4] {
        let index = ((y * canvas.width + x) * 4) as usize;
        [
            canvas.rgba[index],
            canvas.rgba[index + 1],
            canvas.rgba[index + 2],
            canvas.rgba[index + 3],
        ]
    }

    #[test]
    fn headroom_lights_what_is_left_rounding_up() {
        // Spec reference points: 0% used → 10, 8% → 10, 55% → 5, 88% → 2, 100% → 0.
        assert_eq!(lit_cells(100), 10);
        assert_eq!(lit_cells(92), 10);
        assert_eq!(lit_cells(45), 5);
        assert_eq!(lit_cells(12), 2);
        assert_eq!(lit_cells(1), 1);
        assert_eq!(lit_cells(0), 0);
    }

    #[test]
    fn headroom_tone_follows_how_much_is_left() {
        let look = Look::default();
        let plenty = headroom_canvas(Some(92), look);
        assert_eq!(&pixel(&plenty, 15, 26)[..3], &INK, "bottom-left cell lit grey");
        let low = headroom_canvas(Some(12), look);
        assert_eq!(pixel(&low, 15, 26), [YOU[0], YOU[1], YOU[2], 255]);
        assert_eq!(pixel(&low, 21, 7)[3], 0, "top cells are not lit");
        let dot = pixel(&low, 21, 9)[3];
        assert!(dot > 0 && dot < 255, "unlit cells are a faint dot");
        let out = headroom_canvas(Some(0), look);
        assert_eq!(&pixel(&out, 18, 3)[..3], &OUT, "red outline");
        assert!(pixel(&out, 15, 24)[3] == 0, "no cell lit");
        let unknown = headroom_canvas(None, look);
        assert_eq!(pixel(&unknown, 18, 18)[3], 0, "empty hexagon");
        assert_eq!(pixel(&unknown, 0, 0)[3], 0, "transparent corners");
    }

    #[test]
    fn comb_cells_differ_by_fill_not_colour_alone() {
        let look = Look::default();
        let comb = comb_canvas(&[Cell::Working, Cell::Ready, Cell::Offline], look);
        assert_eq!(comb.width, 36, "18 pt whatever the squad size");
        assert_eq!(pixel(&comb, 12, 8), [WORK[0], WORK[1], WORK[2], 255], "solid");
        assert_eq!(pixel(&comb, 23, 8)[3], 0, "ready is an outline");
        assert_eq!(&pixel(&comb, 23, 3)[..3], &READY);
        assert!(pixel(&comb, 7, 13)[3] < 255, "offline is faint");
        assert_eq!(pixel(&comb, 18, 27)[3], 0, "no member, no cell");
        let contrast = comb_canvas(&[Cell::Offline], Look { increase_contrast: true });
        assert_eq!(pixel(&contrast, 8, 8)[3], 255, "Increase Contrast drops the faint ink");
    }

    #[test]
    fn avatar_badges_are_cut_out_of_the_portrait() {
        let portrait: Vec<u8> = [200u8, 200, 200, 255].repeat((PORTRAIT * PORTRAIT) as usize);
        let ready = avatar_canvas(Some(&portrait), Badge::Ready, Look::default());
        assert_eq!(pixel(&ready, 29, 29), [READY[0], READY[1], READY[2], 255]);
        assert_eq!(pixel(&ready, 23, 31)[3], 0, "the ring around the badge is clear");
        assert_eq!(pixel(&ready, 18, 18), [200, 200, 200, 255]);
        let fallback = avatar_canvas(Some(&portrait), Badge::Fallback, Look::default());
        assert_eq!(pixel(&fallback, 28, 29)[3], 0, "the notch shows a substitute");
        assert_eq!(pixel(&fallback, 26, 29)[3], 255);
        let missing = avatar_canvas(None, Badge::Offline, Look::default());
        assert!(pixel(&missing, 18, 3)[3] > 0 && pixel(&missing, 18, 3)[3] < 0x40);
    }

    #[test]
    fn the_attention_dot_is_cut_into_the_corner() {
        let size = 72;
        let solid = [10u8, 20, 30, 255].repeat((size * size) as usize);
        let dotted = with_attention_dot(&solid, size, size, [0, 0, 0]);
        let at = |x: u32, y: u32| {
            let index = ((y * size + x) * 4) as usize;
            [
                dotted[index],
                dotted[index + 1],
                dotted[index + 2],
                dotted[index + 3],
            ]
        };
        // 4 px per point: centre (60, 60), dot radius 10, gap to radius 15.
        assert_eq!(at(60, 60), [0, 0, 0, 255], "the dot is solid");
        assert_eq!(at(60, 47)[3], 0, "a clear gap rings the dot");
        assert_eq!(
            at(20, 20),
            [10, 20, 30, 255],
            "the rest of the icon is untouched"
        );
        assert_eq!(at(71, 60)[3], 0, "the gap runs to the icon's right edge");
        // A 22 px portrait keeps the same geometry in points.
        let portrait = [200u8, 200, 200, 255].repeat(22 * 22);
        let badge = with_attention_dot(&portrait, 22, 22, YOU);
        let centre = ((18 * 22 + 18) * 4) as usize;
        assert_eq!(&badge[centre..centre + 4], &[YOU[0], YOU[1], YOU[2], 255]);
        assert_eq!(&badge[..4], &[200, 200, 200, 255]);
    }

    #[test]
    fn the_squad_icon_keeps_its_size_with_the_dot() {
        let plain = squad_status_icon(false).unwrap();
        let dotted = squad_status_icon(true).unwrap();
        assert_eq!(
            (plain.width(), plain.height()),
            (dotted.width(), dotted.height())
        );
        assert_ne!(plain.rgba(), dotted.rgba());
        let index = ((60 * plain.width() + 60) * 4 + 3) as usize;
        assert_eq!(dotted.rgba()[index], 255);
    }

    #[test]
    fn needs_you_knocks_the_mark_out() {
        let mark = needs_you_canvas();
        assert_eq!(pixel(&mark, 18, 15)[3], 0, "the stem is clear");
        assert_eq!(pixel(&mark, 18, 25)[3], 0, "the dot is clear");
        assert_eq!(pixel(&mark, 12, 18), [YOU[0], YOU[1], YOU[2], 255]);
    }
}

/// Writes every drawing, and the rows of a typical menu, for a visual check:
/// `TRAY_ART_DIR=<dir> cargo test -- --ignored tray_art_writes_previews`.
/// `scripts`-free on purpose: the composite is made from these files.
#[cfg(test)]
mod preview {
    use super::*;
    use autohand_squad_runtime::desktop_tray::menu::{
        self, Art, EngineUsage, EngineWindow, MemberEngines, MenuInputs, NeedsKind, NeedsYouItem,
        QuickChat, Row, RowKind,
    };
    use autohand_squad_runtime::desktop_tray::{DesktopTrayModel, TrayMember};

    fn relative_luminance(rgb: [u8; 3]) -> f64 {
        let linear = |value: u8| {
            let c = value as f64 / 255.0;
            if c <= 0.04045 {
                c / 12.92
            } else {
                ((c + 0.055) / 1.055).powf(2.4)
            }
        };
        0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])
    }
    fn contrast(a: [u8; 3], b: [u8; 3]) -> f64 {
        let (la, lb) = (relative_luminance(a), relative_luminance(b));
        (la.max(lb) + 0.05) / (la.min(lb) + 0.05)
    }

    fn save(dir: &str, name: &str, image: &Image<'_>) {
        image::RgbaImage::from_raw(image.width(), image.height(), image.rgba().to_vec())
            .unwrap()
            .save(format!("{dir}/{name}.png"))
            .unwrap();
    }

    /// A stand-in portrait: a soft two-tone circle, so the clip and cut-out show.
    fn portrait(seed: u8) -> Vec<u8> {
        let mut rgba = Vec::with_capacity((PORTRAIT * PORTRAIT * 4) as usize);
        for y in 0..PORTRAIT {
            for x in 0..PORTRAIT {
                let head = (x as f64 - 18.0).powi(2) + (y as f64 - 14.0).powi(2) < 49.0;
                let body = (x as f64 - 18.0).powi(2) / 144.0 + (y as f64 - 34.0).powi(2) / 100.0 < 1.0;
                let (r, g, b) = if head || body {
                    (238, 214, 196)
                } else {
                    (60 + seed, 110 + seed / 2, 160 - seed)
                };
                rgba.extend_from_slice(&[r, g, b, 255]);
            }
        }
        rgba
    }

    fn row_json(row: &Row, dir: &str, look: Look, counter: &mut usize) -> serde_json::Value {
        let image = row.art.as_ref().map(|art| {
            *counter += 1;
            let name = format!("row-{counter:02}");
            let drawn = match art {
                Art::Comb(cells) => comb(cells, look),
                Art::Headroom(left) => headroom_mark(*left, look),
                Art::Avatar { member_id, badge } => {
                    let seed = member_id.bytes().map(|b| b as u32).sum::<u32>() as u8 % 60;
                    let photo = portrait(seed);
                    member_avatar((member_id != "leo").then_some(&photo[..]), *badge, look)
                }
                Art::NeedsYou => needs_you_mark(),
            };
            save(dir, &name, &drawn);
            name
        });
        let (kind, children) = match &row.kind {
            RowKind::Separator => ("separator", Vec::new()),
            RowKind::Submenu(rows) => (
                "submenu",
                rows.iter().map(|row| row_json(row, dir, look, counter)).collect(),
            ),
            RowKind::Check(on) => (if *on { "checked" } else { "check" }, Vec::new()),
            RowKind::Item => ("item", Vec::new()),
        };
        serde_json::json!({
            "text": row.text, "enabled": row.enabled, "shortcut": row.shortcut,
            "kind": kind, "image": image, "children": children,
        })
    }

    #[test]
    #[ignore = "writes PNGs for a visual check: TRAY_ART_DIR=<dir> cargo test -- --ignored tray_art"]
    fn tray_art_writes_previews() {
        let dir = std::env::var("TRAY_ART_DIR").expect("TRAY_ART_DIR");
        std::fs::create_dir_all(&dir).unwrap();
        let look = Look::default();
        let strong = Look { increase_contrast: true };

        // Contrast of each colour against the menu backgrounds (§3 palette).
        let light = [0xEC, 0xEC, 0xEC];
        let dark = [0x2C, 0x2C, 0x2E];
        let mut report = String::new();
        for (name, colour) in [("ink", INK), ("work", WORK), ("ready", READY), ("you", YOU), ("out", OUT)] {
            report.push_str(&format!(
                "{name:<6} #{:02X}{:02X}{:02X}  light {:.2}  dark {:.2}\n",
                colour[0], colour[1], colour[2], contrast(colour, light), contrast(colour, dark)
            ));
        }
        std::fs::write(format!("{dir}/contrast.txt"), &report).unwrap();
        println!("{report}");

        // Every state of every drawing.
        let cells = [
            Cell::NeedsYou, Cell::Working, Cell::Ready, Cell::Paused, Cell::Offline, Cell::Unknown,
            Cell::Overflow,
        ];
        save(&dir, "comb-states", &comb(&cells, look));
        save(&dir, "comb-states-contrast", &comb(&cells, strong));
        for left in [None, Some(100), Some(92), Some(45), Some(34), Some(12), Some(1), Some(0)] {
            let name = left.map(|left| left.to_string()).unwrap_or_else(|| "unknown".into());
            save(&dir, &format!("headroom-{name}"), &headroom_mark(left, look));
            save(&dir, &format!("headroom-{name}-contrast"), &headroom_mark(left, strong));
        }
        let photo = portrait(20);
        for badge in [Badge::NeedsYou, Badge::Working, Badge::Fallback, Badge::Ready, Badge::Paused, Badge::Offline] {
            let name = format!("{badge:?}").to_lowercase();
            save(&dir, &format!("avatar-{name}"), &member_avatar(Some(&photo), badge, look));
            save(&dir, &format!("avatar-{name}-missing"), &member_avatar(None, badge, look));
        }
        save(&dir, "needs-you", &needs_you_mark());

        // The status item with and without the attention dot (ADR-0248), as
        // macOS draws a template: alpha only, in the bar's foreground. Light,
        // dark and a tinted bar, plus a portrait with the orange dot.
        let plain = squad_status_icon(false).unwrap();
        let dotted = squad_status_icon(true).unwrap();
        let photo22 = image::imageops::resize(
            &image::RgbaImage::from_raw(PORTRAIT, PORTRAIT, portrait(20)).unwrap(),
            22,
            22,
            image::imageops::FilterType::Triangle,
        );
        let avatar = with_attention_dot(photo22.as_raw(), 22, 22, YOU);
        let avatar = image::imageops::resize(
            &image::RgbaImage::from_raw(22, 22, avatar).unwrap(),
            72,
            72,
            image::imageops::FilterType::Triangle,
        );
        let bars: [([u8; 3], [u8; 3]); 3] = [
            ([0xF2, 0xF2, 0xF2], [0x1D, 0x1D, 0x1F]),
            ([0x1E, 0x1E, 0x20], [0xFF, 0xFF, 0xFF]),
            ([0x3A, 0x6E, 0xA5], [0xFF, 0xFF, 0xFF]),
        ];
        let mut mock = image::RgbaImage::new(3 * 96 + 24, bars.len() as u32 * 96);
        for (row, (bar, ink)) in bars.iter().enumerate() {
            for x in 0..mock.width() {
                for y in 0..96 {
                    mock.put_pixel(
                        x,
                        row as u32 * 96 + y,
                        image::Rgba([bar[0], bar[1], bar[2], 255]),
                    );
                }
            }
            for (column, icon) in [&plain, &dotted].iter().enumerate() {
                for y in 0..72 {
                    for x in 0..72 {
                        let alpha = icon.rgba()[((y * 72 + x) * 4 + 3) as usize] as f64 / 255.0;
                        let target = mock
                            .get_pixel_mut(12 + column as u32 * 96 + x, row as u32 * 96 + 12 + y);
                        for channel in 0..3 {
                            target[channel] = (ink[channel] as f64 * alpha
                                + target[channel] as f64 * (1.0 - alpha))
                                .round() as u8;
                        }
                    }
                }
            }
            image::imageops::overlay(&mut mock, &avatar, 12 + 2 * 96, row as i64 * 96 + 12);
        }
        mock.save(format!("{dir}/status-item-attention.png")).unwrap();

        // A typical menu (spec §2), rows as JSON beside their images.
        let member = |id: &str, name: &str, status: &str, working: bool, task: Option<&str>, minutes: u64| TrayMember {
            id: id.into(),
            name: name.into(),
            label: name.into(),
            status: status.into(),
            working,
            task: task.map(str::to_string),
            queued: 0,
            last_activity: Some(1_794_900_000 - minutes * 60),
        };
        let now = autohand_squad_runtime::account_usage::now_unix();
        let model = DesktopTrayModel {
            loaded: true,
            signed_in: true,
            email: Some("you@example.com".into()),
            usage: Some(autohand_squad_runtime::account_usage::AccountUsage {
                display_name: "Autohand Code Free".into(),
                month: autohand_squad_runtime::account_usage::UsageWindow {
                    used: 100,
                    limit: Some(100),
                    reset_at: Some("2026-12-09T00:00:00Z".into()),
                    ..Default::default()
                },
                ..Default::default()
            }),
            usage_error: None,
            daemon_running: true,
            running_since: Some(now - 3 * 3600),
            launch_at_login: true,
            members: vec![
                member("noah", "Noah", "online", true, Some("checkout tests"), 1),
                member("eva", "Eva", "online", true, None, 2),
                member("chief", "Chief of Staff", "online", false, None, 3),
                member("mia", "Mia", "idle", false, None, 4),
                member("leo", "Leo", "paused", false, None, 5),
                member("ana", "Ana", "offline", false, None, 6),
                member("kai", "Kai", "offline", false, None, 7),
                member("zoe", "Zoe", "offline", false, None, 8),
                member("ian", "Ian", "offline", false, None, 9),
            ],
        };
        let mut engines = std::collections::HashMap::new();
        let engine = |primary: &str, fallbacks: &[&str]| MemberEngines {
            primary: primary.into(),
            fallbacks: fallbacks.iter().map(|id| id.to_string()).collect(),
            ..Default::default()
        };
        engines.insert("noah".to_string(), engine("claude", &["codex"]));
        engines.insert("eva".to_string(), engine("claude", &[]));
        engines.insert("chief".to_string(), engine("autohand", &[]));
        let harnesses = vec![
            EngineUsage {
                id: "claude".into(),
                name: "Claude Code".into(),
                heading: "Claude Code".into(),
                windows: vec![EngineWindow { label: "This week".into(), left: Some(12), resets_at: Some(now + 3 * 86_400) }],
                error: None,
            },
            EngineUsage {
                id: "codex".into(),
                name: "Codex".into(),
                heading: "Codex".into(),
                windows: vec![EngineWindow { label: "This week".into(), left: Some(66), resets_at: Some(now + 4 * 86_400) }],
                error: None,
            },
        ];
        let needs = vec![NeedsYouItem {
            member_id: "eva".into(),
            kind: NeedsKind::Question,
            subject: "approve push to main".into(),
            at: "2026-11-17T01:00:00Z".into(),
        }];
        let breaks = std::collections::HashSet::new();
        let inputs = MenuInputs {
            model: &model,
            engines: &engines,
            engines_known: true,
            needs: &needs,
            on_break: &breaks,
            show_usage: true,
            harnesses: Some(&harnesses),
            phone: Some("iPhone reachable via relay".into()),
            quick_chat: QuickChat::Enabled,
            generation: "preview",
            clock: menu::Clock::system(true),
        };
        let rows = menu::plan_menu(&inputs);
        let mut counter = 0;
        let json: Vec<_> = rows.iter().map(|row| row_json(row, &dir, look, &mut counter)).collect();
        std::fs::write(
            format!("{dir}/menu.json"),
            serde_json::to_string_pretty(&json).unwrap(),
        )
        .unwrap();
    }
}
