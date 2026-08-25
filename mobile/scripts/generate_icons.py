#!/usr/bin/env python3
"""Build the launcher icons from the extracted BETTHAT mark.

Source of truth is mobile/assets/logo-mark-dark.png, which extract_logo_pack.py
lifts off the supplied logo sheet. Deriving the icons from that same file keeps
the launcher icon and the in-app logo identical.

    python mobile/scripts/extract_logo_pack.py   # first, to cut the artwork
    python mobile/scripts/generate_icons.py      # then, to build the icons

RESOLUTION: the mark comes off a 1536x1024 contact sheet at roughly 257x134, so
a 1024 icon is about a 4x upscale and will be softer than artwork rendered at
size. Supplying the pack's real 1024 files (or a vector) and re-running fixes
that with no other change.
"""

import os
import sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MOBILE = os.path.dirname(HERE)
ASSETS = os.path.join(MOBILE, "assets")
MARK = os.path.join(ASSETS, "logo-mark-dark.png")

GROUND = (10, 10, 12, 255)   # #0A0A0C, the app's dark ground


def crisp(img, size):
    """Upscale flat artwork without the mush a plain resample leaves.

    The mark is flat colour with hard edges, so after resampling the alpha
    ramp is stretched over several pixels. Steepening it around the midpoint
    puts the edge back without the jaggies a hard threshold would give.
    """
    img = img.resize(size, Image.LANCZOS)
    a = img.getchannel("A").point(lambda v: 0 if v < 96 else (255 if v > 168 else int((v - 96) * 255 / 72)))
    img.putalpha(a)
    return img


def app_icon(size: int, cap_ratio: float, background) -> Image.Image:
    mark = Image.open(MARK).convert("RGBA")
    target_h = max(1, int(size * cap_ratio))
    target_w = max(1, int(target_h * (mark.width / mark.height)))
    # Never let the mark run past the square.
    if target_w > size * 0.92:
        target_w = int(size * 0.92)
        target_h = max(1, int(target_w * (mark.height / mark.width)))

    mark = crisp(mark, (target_w, target_h))
    img = Image.new("RGBA", (size, size), background)
    img.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return img


def main() -> int:
    if not os.path.exists(MARK):
        print("missing " + MARK + "\nrun extract_logo_pack.py first", file=sys.stderr)
        return 1

    for name, size, cap, bg in [
        ("icon.png", 1024, 0.46, GROUND),
        ("splash-icon.png", 1024, 0.36, (0, 0, 0, 0)),
        # Android masks the adaptive foreground hard: everything must sit
        # inside the middle two-thirds or the mark gets its edges cropped.
        ("adaptive-icon.png", 1024, 0.30, (0, 0, 0, 0)),
        ("favicon.png", 96, 0.52, GROUND),
    ]:
        app_icon(size, cap, bg).save(os.path.join(ASSETS, name), "PNG")
        print("wrote %s  %dx%d" % (name, size, size))
    return 0


if __name__ == "__main__":
    sys.exit(main())
