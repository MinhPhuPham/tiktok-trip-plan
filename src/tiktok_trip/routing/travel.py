"""Straight-line travel-time estimate between points."""

from __future__ import annotations

import logging
from collections.abc import Sequence

from tiktok_trip import geo

log = logging.getLogger(__name__)

SPEEDS_KMH = {"walking": 4.5, "motorbike": 18.0, "car": 22.0}
DETOUR_FACTOR = 1.3

Matrix = list[list[float]]


def estimate_minutes(a: geo.LatLng, b: geo.LatLng, mode: str) -> float:
    return geo.distance_km(a, b) * DETOUR_FACTOR / SPEEDS_KMH[mode] * 60.0


def estimate_matrix(points: Sequence[geo.LatLng], mode: str) -> Matrix:
    return [[estimate_minutes(a, b, mode) for b in points] for a in points]


def travel_matrix(points: Sequence[geo.LatLng], mode: str) -> Matrix:
    """Minutes between every pair of points; a single point or none needs no estimate."""
    if len(points) < 2:
        return [[0.0] * len(points) for _ in points]
    return estimate_matrix(points, mode)


def log_estimate(mode: str) -> None:
    log.info(
        "Travel times are estimated from straight-line distance (%s at %.1f km/h, x%.1f detour).",
        mode,
        SPEEDS_KMH[mode],
        DETOUR_FACTOR,
    )
