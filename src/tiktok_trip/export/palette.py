"""Colors shared by map.html and the workbooks so both views match."""

from __future__ import annotations

from tiktok_trip.models import Category

SECTOR_COLORS: dict[str, str] = {
    "N": "#0072B2",
    "NE": "#56B4E9",
    "E": "#009E73",
    "SE": "#F0E442",
    "S": "#E69F00",
    "SW": "#D55E00",
    "W": "#CC79A7",
    "NW": "#6A3D9A",
}
UNASSIGNED = "UNASSIGNED"
UNASSIGNED_COLOR = "#9E9E9E"
CENTER_COLOR = "#212121"

DAY_COLORS: tuple[str, ...] = (
    "#283593",
    "#0B5345",
    "#8E1C8E",
    "#663010",
    "#3A3A40",
    "#8A1546",
    "#56650E",
)
"""Dark route inks (indigo, teal, plum, brown, charcoal, wine, olive): each sits at least
25 CIEDE2000 or 25 degrees of hue away from every sector colour, keeps 3:1 on white and on
the streets basemap, and carries white digits at 4.5:1."""


def sector_color(sector: str | None) -> str:
    return SECTOR_COLORS.get(sector or "", UNASSIGNED_COLOR)


def day_color(day: int) -> str:
    return DAY_COLORS[(day - 1) % len(DAY_COLORS)]


BLACK = "#000000"
WHITE = "#FFFFFF"
MIN_TEXT_CONTRAST = 4.5
"""WCAG AA for normal text."""


def _channel(value: int) -> float:
    srgb = value / 255
    return srgb / 12.92 if srgb <= 0.04045 else ((srgb + 0.055) / 1.055) ** 2.4


def relative_luminance(hex_color: str) -> float:
    """WCAG 2 relative luminance of a #RRGGBB colour (0 = black, 1 = white)."""
    digits = hex_color.lstrip("#")
    red, green, blue = (_channel(int(digits[i : i + 2], 16)) for i in (0, 2, 4))
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def contrast_ratio(first_hex: str, second_hex: str) -> float:
    """WCAG 2 contrast ratio between two #RRGGBB colours, from 1 to 21."""
    lighter, darker = sorted(
        (relative_luminance(first_hex), relative_luminance(second_hex)), reverse=True
    )
    return (lighter + 0.05) / (darker + 0.05)


def readable_text_color(background_hex: str) -> str:
    """White when it reaches WCAG AA (4.5:1) on the fill, else whichever of black and white
    contrasts more."""
    white = contrast_ratio(WHITE, background_hex)
    if white >= MIN_TEXT_CONTRAST:
        return WHITE
    return BLACK if contrast_ratio(BLACK, background_hex) > white else WHITE


SECTOR_INK: dict[str, str] = {
    **{name: readable_text_color(color) for name, color in SECTOR_COLORS.items()},
    UNASSIGNED: readable_text_color(UNASSIGNED_COLOR),
}
"""Text colour on each sector fill (map pins, ray labels, workbook headers)."""


def sector_ink(sector: str | None) -> str:
    return SECTOR_INK.get(sector or "", SECTOR_INK[UNASSIGNED])


CATEGORY_COLORS: dict[str, str] = {
    Category.FOOD: "#C95D52",
    Category.CAFE: "#C59711",
    Category.ATTRACTION: "#0486F4",
    Category.OTHER: "#9699B4",
}
"""Map pin fills (terracotta red, amber, azure, grey-violet; OKLCH L 0.61-0.70). Min CIEDE2000
to the DAY_COLORS route inks 25.1 / 30.3 / 29.9 / 36.3. Pairwise CIEDE2000 >= 21.7 for normal
vision and >= 14.1 under Machado 2009 protan / deutan / tritan (worst: food-cafe, deutan); OKLab
x100 >= 16.4 normal, >= 11.2 protan / deutan. Black icons reach 5.2 / 7.8 / 5.7 / 7.5:1; fills
reach 3.7 / 2.5 / 3.4 / 2.6:1 on the OpenFreeMap background (#F8F4F0), so pins keep a light
casing and shadow. "other" is a deliberate neutral (chroma 0.04)."""

CATEGORY_INK: dict[str, str] = {
    name: readable_text_color(color) for name, color in CATEGORY_COLORS.items()
}
"""Icon colour on each category fill."""


def day_ink(day: int) -> str:
    return readable_text_color(day_color(day))
