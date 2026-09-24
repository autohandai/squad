#!/usr/bin/env python3
"""Build the desktop icon sources from public/icon-1024.png.

  src-tauri/icon-source.png          macOS-style app icon: the hexagon glyph on a
                                     black rounded tile with transparent margins
                                     (Apple's 824/1024 grid, ~22.4% corner
                                     radius), so the Dock and Launchpad show a
                                     native squircle instead of a black square.
  src-tauri/icons/tray-template.png  Menu bar template icon: the glyph as black
                                     with alpha from the artwork's luminance,
                                     72px (4x the 18pt slot) so Retina stays
                                     crisp. macOS recolours template images for
                                     light and dark menu bars.

Then run `npx tauri icon src-tauri/icon-source.png -o src-tauri/icons`.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public" / "icon-1024.png"
APP_ICON = ROOT / "src-tauri" / "icon-source.png"
TRAY_ICON = ROOT / "src-tauri" / "icons" / "tray-template.png"

CANVAS = 1024
TILE = 824  # Apple's icon grid: content sits inside 824x824 centred in 1024
RADIUS = int(TILE * 0.2237)


def rounded_tile(size: int, radius: int, colour) -> Image.Image:
    """A rounded-rectangle tile with anti-aliased corners (4x supersampled)."""
    scale = 4
    big = Image.new("L", (size * scale, size * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        (0, 0, size * scale - 1, size * scale - 1), radius=radius * scale, fill=255
    )
    mask = big.resize((size, size), Image.LANCZOS)
    tile = Image.new("RGBA", (size, size), colour)
    tile.putalpha(mask)
    return tile


def glyph_bounds(image: Image.Image) -> tuple[int, int, int, int]:
    """Bounding box of the non-black artwork."""
    grey = image.convert("L").point(lambda v: 255 if v > 24 else 0)
    box = grey.getbbox()
    if not box:
        raise SystemExit(f"{SOURCE} has no visible artwork")
    return box


def build_app_icon(source: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    offset = (CANVAS - TILE) // 2
    canvas.alpha_composite(rounded_tile(TILE, RADIUS, (10, 10, 10, 255)), (offset, offset))

    left, top, right, bottom = glyph_bounds(source)
    glyph = source.crop((left, top, right, bottom)).convert("RGBA")
    # The glyph spans ~64% of the tile, the proportion Apple's own icons use.
    target = int(TILE * 0.64)
    ratio = target / max(glyph.width, glyph.height)
    glyph = glyph.resize((round(glyph.width * ratio), round(glyph.height * ratio)), Image.LANCZOS)
    # Black in the artwork is the tile colour, so only the light parts remain.
    alpha = glyph.convert("L").point(lambda v: 0 if v < 12 else 255).filter(ImageFilter.GaussianBlur(0.6))
    glyph.putalpha(alpha)
    position = ((CANVAS - glyph.width) // 2, (CANVAS - glyph.height) // 2)
    canvas.alpha_composite(glyph, position)
    return canvas


def build_tray_icon(source: Image.Image, size: int = 72) -> Image.Image:
    left, top, right, bottom = glyph_bounds(source)
    glyph = source.crop((left, top, right, bottom)).convert("L")
    side = max(glyph.width, glyph.height)
    square = Image.new("L", (side, side), 0)
    square.paste(glyph, ((side - glyph.width) // 2, (side - glyph.height) // 2))
    # Leave a little breathing room inside the slot.
    inner = int(size * 0.92)
    # Only the white shell survives: the grey cells turn to mush at 18pt.
    shell = square.point(lambda v: 255 if v > 150 else 0)
    luminance = shell.resize((inner, inner), Image.LANCZOS)
    alpha = Image.new("L", (size, size), 0)
    alpha.paste(luminance, ((size - inner) // 2, (size - inner) // 2))
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    icon.putalpha(alpha)
    return icon


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    build_app_icon(source).save(APP_ICON)
    TRAY_ICON.parent.mkdir(parents=True, exist_ok=True)
    build_tray_icon(source).save(TRAY_ICON)
    print(f"wrote {APP_ICON.relative_to(ROOT)} and {TRAY_ICON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
