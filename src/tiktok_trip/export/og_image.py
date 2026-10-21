"""The 1200x630 link-preview card (og:image): brand, city, trip size and a stylised day route.

Drawn offline with Pillow (no map tiles) in the app's dark theme, so the app icon sits on it
seamlessly. Text needs a font with Vietnamese diacritics; without one Pillow's default font is
used and the export goes on.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import cache
from io import BytesIO
from pathlib import Path
from typing import Literal

from PIL import Image, ImageDraw, ImageFont

from tiktok_trip.export.palette import CATEGORY_COLORS
from tiktok_trip.export.site import OG_IMAGE_SIZE
from tiktok_trip.models import Category

logger = logging.getLogger(__name__)

WIDTH, HEIGHT = OG_IMAGE_SIZE
SCALE = 2
"""Drawn at twice the size and downsampled: Pillow draws lines and circles without anti-aliasing."""

BACKGROUND = "#16181D"
"""The manifest background and the app icon's fill."""
TEXT = "#EDEFF1"
TEXT_2 = "#B0B5BB"
ACCENT = "#8797EF"
CASING = "#F3F5F8"
"""Dark-theme --text, --text-2, --accent and --casing of web/src/styles/tokens.css, in sRGB."""

Weight = Literal["bold", "medium"]


@dataclass(frozen=True)
class FontFace:
    path: str
    index: int = 0


FONT_FACES: dict[Weight, tuple[FontFace, ...]] = {
    "bold": (
        FontFace("/System/Library/Fonts/HelveticaNeue.ttc", 1),
        FontFace("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        FontFace("/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"),
        FontFace("/usr/share/fonts/noto/NotoSans-Bold.ttf"),
        FontFace("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        FontFace("C:/Windows/Fonts/segoeuib.ttf"),
        FontFace("C:/Windows/Fonts/arialbd.ttf"),
    ),
    "medium": (
        FontFace("/System/Library/Fonts/HelveticaNeue.ttc", 10),
        FontFace("/System/Library/Fonts/Supplemental/Arial.ttf"),
        FontFace("/usr/share/fonts/truetype/noto/NotoSans-Medium.ttf"),
        FontFace("/usr/share/fonts/noto/NotoSans-Medium.ttf"),
        FontFace("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        FontFace("C:/Windows/Fonts/seguisb.ttf"),
        FontFace("C:/Windows/Fonts/arial.ttf"),
    ),
}
"""System fonts with Vietnamese diacritics, first match wins (macOS, Linux, Windows)."""

Font = ImageFont.FreeTypeFont | ImageFont.ImageFont

ROUTE_STOPS: tuple[tuple[float, float, str], ...] = (
    (140, 512, Category.FOOD),
    (268, 534, Category.CAFE),
    (420, 506, Category.ATTRACTION),
    (560, 470, Category.FOOD),
    (722, 482, Category.OTHER),
    (880, 522, Category.ATTRACTION),
    (1060, 498, Category.CAFE),
)
"""Position and pin colour of each stop on the decorative route."""
ICON_SIZE = 64
ICON_RADIUS = 0.225
CITY_MAX_WIDTH = 1040
CITY_SIZES = (124, 112, 100, 88, 76, 64, 56)


@cache
def face_for(weight: Weight) -> FontFace | None:
    face = next((f for f in FONT_FACES[weight] if Path(f.path).is_file()), None)
    if face is None:
        logger.warning(
            "No font with Vietnamese diacritics found for the preview image; using Pillow's "
            "default font (accents may be missing)."
        )
    return face


def font(weight: Weight, size: int) -> Font:
    face = face_for(weight)
    if face is None:
        return ImageFont.load_default(size * SCALE)
    return ImageFont.truetype(face.path, size * SCALE, index=face.index)


def px(value: float) -> int:
    return round(value * SCALE)


def fitted_city(draw: ImageDraw.ImageDraw, city: str) -> tuple[str, Font]:
    """The largest size that fits the width; at the smallest size the name is cut with '…'."""
    for size in CITY_SIZES:
        city_font = font("bold", size)
        if draw.textlength(city, font=city_font) <= px(CITY_MAX_WIDTH):
            return city, city_font
    text = city
    while len(text) > 1 and draw.textlength(text + "…", font=city_font) > px(CITY_MAX_WIDTH):
        text = text[:-1].rstrip()
    return text + "…", city_font


Point = tuple[float, float]


def catmull_rom(p0: Point, p1: Point, p2: Point, p3: Point, t: float) -> Point:
    def axis(k: int) -> float:
        return 0.5 * (
            2 * p1[k]
            + (p2[k] - p0[k]) * t
            + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t
            + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t**3
        )

    return axis(0), axis(1)


def route_curve(stops: list[Point], steps: int = 24) -> list[Point]:
    """A smooth curve through every stop."""
    padded = [stops[0], *stops, stops[-1]]
    curve: list[Point] = []
    for i in range(1, len(padded) - 2):
        p0, p1, p2, p3 = padded[i - 1 : i + 3]
        curve.extend(catmull_rom(p0, p1, p2, p3, step / steps) for step in range(steps))
    return [*curve, stops[-1]]


def draw_route(draw: ImageDraw.ImageDraw) -> None:
    stops = [(x, y) for x, y, _ in ROUTE_STOPS]
    draw.line([(px(x), px(y)) for x, y in route_curve(stops)], fill=ACCENT, width=px(6))
    for x, y, category in ROUTE_STOPS:
        for radius, fill in ((17, CASING), (12, CATEGORY_COLORS[category])):
            draw.ellipse(
                (px(x - radius), px(y - radius), px(x + radius), px(y + radius)), fill=fill
            )


def rounded_mask(size: int) -> Image.Image:
    """App-icon corners (22.5% radius), drawn 4x and scaled down for a smooth edge."""
    big = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        (0, 0, size * 4 - 1, size * 4 - 1), radius=round(size * 4 * ICON_RADIUS), fill=255
    )
    return big.resize((size, size), Image.Resampling.LANCZOS)


def draw_brand(
    image: Image.Image, draw: ImageDraw.ImageDraw, label: str, icon: Path | None
) -> None:
    brand_font = font("bold", 40)
    text_width = draw.textlength(label, font=brand_font)
    icon_image = Image.open(icon).convert("RGBA") if icon and icon.is_file() else None
    gap = px(16) if icon_image else 0
    icon_width = px(ICON_SIZE) if icon_image else 0
    left = (px(WIDTH) - (icon_width + gap + text_width)) / 2
    center_y = px(108)
    if icon_image:
        resized = icon_image.resize((icon_width, icon_width), Image.Resampling.LANCZOS)
        image.paste(resized, (round(left), center_y - icon_width // 2), rounded_mask(icon_width))
    draw.text((left + icon_width + gap, center_y), label, font=brand_font, fill=TEXT, anchor="lm")


def render_og_image(site_name: str, city: str, stats: str, icon: Path | None = None) -> bytes:
    """PNG bytes of the card; `icon` is the app icon placed before the wordmark when present."""
    image = Image.new("RGB", (px(WIDTH), px(HEIGHT)), BACKGROUND)
    draw = ImageDraw.Draw(image)
    draw_brand(image, draw, site_name, icon)
    city_text, city_font = fitted_city(draw, city)
    draw.text((px(WIDTH / 2), px(250)), city_text, font=city_font, fill=TEXT, anchor="mm")
    draw.text((px(WIDTH / 2), px(366)), stats, font=font("medium", 44), fill=TEXT_2, anchor="mm")
    draw_route(draw)
    final = image.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    buffer = BytesIO()
    final.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()
