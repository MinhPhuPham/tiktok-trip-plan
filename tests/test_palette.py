"""Category pin colours: distinct for every reader, clear of the route inks, readable."""

from __future__ import annotations

import itertools
import math

import pytest

from tiktok_trip.export.palette import (
    BLACK,
    CATEGORY_COLORS,
    CATEGORY_INK,
    DAY_COLORS,
    MIN_TEXT_CONTRAST,
    contrast_ratio,
    readable_text_color,
)
from tiktok_trip.models import Category

Lab = tuple[float, float, float]
Matrix = tuple[tuple[float, float, float], ...]

MACHADO_2009: dict[str, Matrix] = {
    "protan": (
        (0.152286, 1.052583, -0.204868),
        (0.114503, 0.786281, 0.099216),
        (-0.003882, -0.048116, 1.051998),
    ),
    "deutan": (
        (0.367322, 0.860646, -0.227968),
        (0.280085, 0.672501, 0.047413),
        (-0.011820, 0.042940, 0.968881),
    ),
    "tritan": (
        (1.255528, -0.076749, -0.178779),
        (-0.078411, 0.930809, 0.147602),
        (0.004733, 0.691367, 0.303900),
    ),
}
"""Severity 1.0 colour-vision-deficiency transforms, applied in linear sRGB."""

BASEMAP_BACKGROUNDS = ("#F8F4F0", "#F2EFE9")
"""OpenFreeMap Liberty and Esri Streets land colour."""


def linear_rgb(hex_color: str) -> tuple[float, float, float]:
    digits = hex_color.lstrip("#")
    srgb = (int(digits[i : i + 2], 16) / 255 for i in (0, 2, 4))
    r, g, b = (c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)
    return r, g, b


def lab(rgb: tuple[float, float, float]) -> Lab:
    r, g, b = (min(1.0, max(0.0, c)) for c in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116

    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def simulate(rgb: tuple[float, float, float], kind: str) -> tuple[float, float, float]:
    r, g, b = (row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2] for row in MACHADO_2009[kind])
    return r, g, b


def ciede2000(first: Lab, second: Lab) -> float:
    l1, a1, b1 = first
    l2, a2, b2 = second
    c_mean = (math.hypot(a1, b1) + math.hypot(a2, b2)) / 2
    g = 0.5 * (1 - math.sqrt(c_mean**7 / (c_mean**7 + 25**7)))
    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360
    dh = h2p - h1p
    if c1p * c2p == 0:
        dh = 0
    elif dh > 180:
        dh -= 360
    elif dh < -180:
        dh += 360
    d_l, d_c = l2 - l1, c2p - c1p
    d_h = 2 * math.sqrt(c1p * c2p) * math.sin(math.radians(dh / 2))
    l_mean, cp_mean = (l1 + l2) / 2, (c1p + c2p) / 2
    if c1p * c2p == 0:
        h_mean = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        h_mean = (h1p + h2p) / 2
    else:
        h_mean = (h1p + h2p + (360 if h1p + h2p < 360 else -360)) / 2
    t = (
        1
        - 0.17 * math.cos(math.radians(h_mean - 30))
        + 0.24 * math.cos(math.radians(2 * h_mean))
        + 0.32 * math.cos(math.radians(3 * h_mean + 6))
        - 0.20 * math.cos(math.radians(4 * h_mean - 63))
    )
    rotation = 30 * math.exp(-(((h_mean - 275) / 25) ** 2))
    r_c = 2 * math.sqrt(cp_mean**7 / (cp_mean**7 + 25**7))
    s_l = 1 + 0.015 * (l_mean - 50) ** 2 / math.sqrt(20 + (l_mean - 50) ** 2)
    s_c = 1 + 0.045 * cp_mean
    s_h = 1 + 0.015 * cp_mean * t
    r_t = -math.sin(math.radians(2 * rotation)) * r_c
    return math.sqrt(
        (d_l / s_l) ** 2 + (d_c / s_c) ** 2 + (d_h / s_h) ** 2 + r_t * (d_c / s_c) * (d_h / s_h)
    )


def delta_e(first: str, second: str, vision: str | None = None) -> float:
    one, two = linear_rgb(first), linear_rgb(second)
    if vision:
        one, two = simulate(one, vision), simulate(two, vision)
    return ciede2000(lab(one), lab(two))


def test_ciede2000_matches_published_pairs() -> None:
    assert ciede2000((50, 2.6772, -79.7751), (50, 0, -82.7485)) == pytest.approx(2.0425, abs=1e-4)
    assert ciede2000((50, 2.5, 0), (73, 25, -18)) == pytest.approx(27.1492, abs=1e-4)


def test_every_category_has_a_colour_and_ink() -> None:
    assert set(CATEGORY_COLORS) == set(Category) == set(CATEGORY_INK)


def test_category_icons_stay_legible() -> None:
    for category, color in CATEGORY_COLORS.items():
        assert CATEGORY_INK[category] == readable_text_color(color) == BLACK
        assert contrast_ratio(CATEGORY_INK[category], color) >= MIN_TEXT_CONTRAST


def test_categories_stay_apart_for_every_reader() -> None:
    for first, second in itertools.combinations(CATEGORY_COLORS.values(), 2):
        assert delta_e(first, second) >= 20
        for vision in MACHADO_2009:
            assert delta_e(first, second, vision) >= 12, (first, second, vision)


def test_pins_stand_apart_from_day_routes() -> None:
    for color in CATEGORY_COLORS.values():
        for route in DAY_COLORS:
            assert delta_e(color, route) >= 25, (color, route)


def test_pins_hold_up_on_light_basemaps() -> None:
    for color in CATEGORY_COLORS.values():
        for background in BASEMAP_BACKGROUNDS:
            assert contrast_ratio(color, background) >= 2.3
