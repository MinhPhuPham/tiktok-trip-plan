"""Launch screens for the trip installed on an iPhone Home Screen (`apple-touch-startup-image`).

iOS ignores the manifest for its launch screen and shows a blank page unless the head links one
image per exact screen size. Each is the app icon centred on the manifest background, portrait,
for the iPhones of the last years; other screens keep the blank launch.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from html import escape
from io import BytesIO
from pathlib import Path

from PIL import Image

from tiktok_trip.export.og_image import BACKGROUND, rounded_mask

logger = logging.getLogger(__name__)

SPLASH_DIR = "splash"
ICON_SHARE = 0.3
"""The icon's width as a share of the screen width (about iOS's own launch icon size)."""


@dataclass(frozen=True)
class Screen:
    """A portrait iPhone screen in CSS pixels and its device pixel ratio."""

    width: int
    height: int
    ratio: int

    @property
    def pixels(self) -> tuple[int, int]:
        return self.width * self.ratio, self.height * self.ratio

    @property
    def path(self) -> str:
        width, height = self.pixels
        return f"{SPLASH_DIR}/apple-splash-{width}x{height}.png"

    @property
    def media(self) -> str:
        return (
            f"(device-width: {self.width}px) and (device-height: {self.height}px) and "
            f"(-webkit-device-pixel-ratio: {self.ratio}) and (orientation: portrait)"
        )


SCREENS: tuple[Screen, ...] = (
    Screen(440, 956, 3),
    Screen(430, 932, 3),
    Screen(428, 926, 3),
    Screen(420, 912, 3),
    Screen(414, 896, 3),
    Screen(414, 896, 2),
    Screen(402, 874, 3),
    Screen(393, 852, 3),
    Screen(390, 844, 3),
    Screen(375, 812, 3),
    Screen(375, 667, 2),
)
"""16/17 Pro Max, 14 Pro Max to 16 Plus, 12/13 Pro Max and 14 Plus, Air, XS Max and 11 Pro Max,
XR and 11, 16 Pro and 17, 14 Pro to 16, 12 to 14, X to 13 mini, SE and 8."""


def render_splash(icon: Image.Image, screen: Screen) -> bytes:
    width, height = screen.pixels
    image = Image.new("RGB", (width, height), BACKGROUND)
    size = round(width * ICON_SHARE)
    resized = icon.resize((size, size), Image.Resampling.LANCZOS)
    image.paste(resized, ((width - size) // 2, (height - size) // 2), rounded_mask(size))
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def write_splash_screens(app_dir: Path, icon_path: Path) -> str:
    """Writes the launch images into `app_dir`; returns their <link> tags, empty without an icon."""
    if not icon_path.is_file():
        logger.debug("No %s: the installed app keeps iOS's blank launch screen.", icon_path)
        return ""
    icon = Image.open(icon_path).convert("RGBA")
    (app_dir / SPLASH_DIR).mkdir(parents=True, exist_ok=True)
    links = []
    for screen in SCREENS:
        (app_dir / screen.path).write_bytes(render_splash(icon, screen))
        links.append(
            f'<link rel="apple-touch-startup-image" href="{screen.path}" '
            f'media="{escape(screen.media)}">'
        )
    return "\n".join(links)
