#!/usr/bin/env python3
"""Cut the BETTHAT logo assets out of the supplied logo-pack contact sheet.

The pack arrived as ONE flattened image, not as the eight files its captions
name — "01_full_logo.png" and friends are labels drawn inside the picture, so
there was nothing to download. This lifts each mark off the sheet instead, so
the app ships the real artwork rather than a re-drawing of it.

Each mark sits on a flat panel (black, or near-white), so alpha is recovered
from the pixel's distance from that panel colour and the colour is then
un-premultiplied. A plain colour-key would leave a hard fringe on the
anti-aliased edges; this keeps them smooth on any background.

    python mobile/scripts/extract_logo_pack.py [path-to-sheet.png]

Writes the six logo-* assets into mobile/assets/. Run generate_icons.py
afterwards to rebuild the launcher icons from the extracted mark.
"""

import os
import sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MOBILE = os.path.dirname(HERE)
ASSETS = os.path.join(MOBILE, "assets")

DEFAULT_SHEET = os.path.join(
    os.path.expanduser("~"), "Downloads",
    "ChatGPT Image Aug 24, 2026, 10_03_44 PM.png",
)

# Search windows, verified against the 1536x1024 sheet. Each is inset from its
# panel so the panel's own caption text is never picked up as ink.
#   name                      window (x0,y0,x1,y1)      panel background
REGIONS = [
    ("logo-full-dark.png",   (10, 140, 500, 400),      (0, 0, 0)),
    ("logo-mark-dark.png",   (480, 150, 830, 345),     (0, 0, 0)),
    ("logo-word-dark.png",   (800, 215, 1230, 315),    (0, 0, 0)),
    ("logo-full-light.png",  (20, 470, 380, 670),      (248, 247, 247)),
    ("logo-mark-light.png",  (780, 480, 1140, 670),    (248, 248, 248)),
]

SHEET_SIZE = (1536, 1024)


def ink_bbox(arr, window, bg, tol=26):
    """Bounding box of everything in `window` that isn't the panel colour."""
    x0, y0, x1, y1 = window
    diff = np.abs(arr[y0:y1, x0:x1] - np.array(bg)).sum(axis=2)
    ys, xs = np.where(diff > tol)
    if len(xs) == 0:
        return None
    box = (x0 + int(xs.min()), y0 + int(ys.min()),
           x0 + int(xs.max()) + 1, y0 + int(ys.max()) + 1)
    touching = [n for n, hit in (("left", box[0] <= x0), ("top", box[1] <= y0),
                                 ("right", box[2] >= x1), ("bottom", box[3] >= y1)) if hit]
    return box, touching


def lift(arr, box, bg):
    """Recover straight (un-premultiplied) RGBA for a mark on a flat panel."""
    x0, y0, x1, y1 = box
    reg = arr[y0:y1, x0:x1].astype(np.float64)
    bg = np.array(bg, dtype=np.float64)

    if bg.max() < 40:
        # On black, how bright a pixel is IS its coverage.
        alpha = reg.max(axis=2) / 255.0
    else:
        # On white, coverage is how far the darkest channel falls below it.
        alpha = (bg.max() - reg.min(axis=2)) / bg.max()

    alpha = np.clip(alpha, 0.0, 1.0)
    safe = np.maximum(alpha, 1e-4)[..., None]
    rgb = (reg - bg * (1.0 - safe)) / safe
    rgb = np.clip(rgb, 0, 255)

    out = np.dstack([rgb, alpha[..., None] * 255.0]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def main() -> int:
    sheet = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SHEET
    if not os.path.exists(sheet):
        print("sheet not found: " + sheet, file=sys.stderr)
        return 1

    img = Image.open(sheet).convert("RGB")
    if img.size != SHEET_SIZE:
        print(f"expected a {SHEET_SIZE[0]}x{SHEET_SIZE[1]} sheet, got "
              f"{img.size[0]}x{img.size[1]} — the windows below are calibrated "
              "to that layout and would cut in the wrong places.", file=sys.stderr)
        return 1

    arr = np.asarray(img).astype(np.int16)
    os.makedirs(ASSETS, exist_ok=True)

    failed = False
    for name, window, bg in REGIONS:
        found = ink_bbox(arr, window, bg)
        if found is None:
            print(f"  {name}: NOTHING FOUND in {window}", file=sys.stderr)
            failed = True
            continue
        box, touching = found
        if touching:
            # A mark flush against its window means the crop is cutting into
            # the artwork; better to fail loudly than ship a clipped logo.
            print(f"  {name}: window too tight, ink touches {touching}", file=sys.stderr)
            failed = True
            continue
        lift(arr, box, bg).save(os.path.join(ASSETS, name), "PNG")
        print(f"wrote {name}  {box[2]-box[0]}x{box[3]-box[1]}")

    # The wordmark only ships in one colourway on the sheet; recolour the dark
    # one for light grounds by swapping white ink for the light theme's.
    dark_word = os.path.join(ASSETS, "logo-word-dark.png")
    if os.path.exists(dark_word):
        w = np.asarray(Image.open(dark_word).convert("RGBA")).astype(np.float64)
        rgb, a8 = w[..., :3], w[..., 3:]
        # Whites become near-black; the orange half is left alone.
        lum = rgb.mean(axis=2, keepdims=True)
        whiteness = np.clip((lum - 140.0) / 115.0, 0.0, 1.0)
        rgb = rgb * (1 - whiteness) + np.array([21.0, 21.0, 23.0]) * whiteness
        Image.fromarray(np.dstack([rgb, a8]).astype(np.uint8), "RGBA").save(
            os.path.join(ASSETS, "logo-word-light.png"), "PNG")
        print("wrote logo-word-light.png  (recoloured from the dark wordmark)")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
