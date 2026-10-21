"""Google Maps directions links, split into legs because a link holds at most 9 waypoints."""

from __future__ import annotations

from collections.abc import Sequence

from tiktok_trip.geo import LatLng

DIR_URL = "https://www.google.com/maps/dir/?api=1"
MAX_WAYPOINTS = 9
TRAVELMODES = {"walking": "walking", "motorbike": "two-wheeler", "car": "driving"}


def _fmt(point: LatLng) -> str:
    return f"{point[0]:.6f},{point[1]:.6f}"


def directions_url(points: Sequence[LatLng], travelmode: str = "driving") -> str:
    if len(points) < 2:
        raise ValueError("a directions link needs an origin and a destination")
    if len(points) - 2 > MAX_WAYPOINTS:
        raise ValueError(f"at most {MAX_WAYPOINTS} waypoints per link")
    url = f"{DIR_URL}&origin={_fmt(points[0])}&destination={_fmt(points[-1])}"
    if len(points) > 2:
        url += "&waypoints=" + "|".join(_fmt(p) for p in points[1:-1])
    return f"{url}&travelmode={travelmode}"


def directions_urls(points: Sequence[LatLng], travelmode: str = "driving") -> list[str]:
    """Consecutive legs; each leg starts where the previous one ended."""
    if len(points) < 2:
        return []
    step = MAX_WAYPOINTS + 1
    return [
        directions_url(points[i : i + step + 1], travelmode)
        for i in range(0, len(points) - 1, step)
    ]
