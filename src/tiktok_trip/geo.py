"""Pure geometry on (lat, lng) degrees: distance, bearing, sectors, rings, DBSCAN."""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from itertools import pairwise
from statistics import median

from tiktok_trip.clock import EN_DASH

EARTH_RADIUS_KM = 6371.0088
NOISE = -1

LatLng = tuple[float, float]

SECTORS_8 = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
SECTORS_4 = ("N", "E", "S", "W")
SECTOR_BEARING = {name: index * 45.0 for index, name in enumerate(SECTORS_8)}

_LATLNG_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$")


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def distance_km(a: LatLng, b: LatLng) -> float:
    return haversine_km(a[0], a[1], b[0], b[1])


def coord_maps_url(lat: float, lng: float) -> str:
    """Google Maps search link for a bare coordinate."""
    return f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"


def destination_point(lat: float, lng: float, bearing_deg: float, distance_km: float) -> LatLng:
    """The point `distance_km` away from (lat, lng) along the initial bearing."""
    angular = distance_km / EARTH_RADIUS_KM
    theta = math.radians(bearing_deg)
    phi1, lam1 = math.radians(lat), math.radians(lng)
    phi2 = math.asin(
        math.sin(phi1) * math.cos(angular) + math.cos(phi1) * math.sin(angular) * math.cos(theta)
    )
    lam2 = lam1 + math.atan2(
        math.sin(theta) * math.sin(angular) * math.cos(phi1),
        math.cos(angular) - math.sin(phi1) * math.sin(phi2),
    )
    return math.degrees(phi2), (math.degrees(lam2) + 540) % 360 - 180


def bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Initial bearing from point 1 to point 2, clockwise from north, in [0, 360)."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_lambda = math.radians(lng2 - lng1)
    y = math.sin(d_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(d_lambda)
    return math.degrees(math.atan2(y, x)) % 360.0


def sector_names(sectors: int) -> tuple[str, ...]:
    if sectors == 8:
        return SECTORS_8
    if sectors == 4:
        return SECTORS_4
    raise ValueError(f"sectors must be 4 or 8, got {sectors}")


def sector_name(bearing: float, sectors: int = 8) -> str:
    """Sector containing the bearing. Each sector is centred on its compass direction,
    so with 8 sectors N spans [337.5, 22.5) and NE starts exactly at 22.5."""
    names = sector_names(sectors)
    width = 360.0 / sectors
    index = int(((bearing % 360.0) + width / 2) % 360.0 // width)
    return names[index]


def sector_gap_deg(a: str, b: str) -> float | None:
    """Angle between two compass sectors' centre bearings (0-180); None for non-compass names."""
    if a not in SECTOR_BEARING or b not in SECTOR_BEARING:
        return None
    gap = abs(SECTOR_BEARING[a] - SECTOR_BEARING[b]) % 360.0
    return min(gap, 360.0 - gap)


def _fmt_km(value: float) -> str:
    return f"{value:g}"


def ring_label(distance: float, rings_km: Sequence[float]) -> str:
    """Distance band such as "0-2km" (with an en dash) or "10km+". Upper bounds are exclusive."""
    lower = 0.0
    for upper in sorted(rings_km):
        if distance < upper:
            return f"{_fmt_km(lower)}{EN_DASH}{_fmt_km(upper)}km"
        lower = upper
    return f"{_fmt_km(lower)}km+"


def ring_labels(rings_km: Sequence[float]) -> list[str]:
    bounds = [0.0, *sorted(rings_km)]
    labels = [f"{_fmt_km(a)}{EN_DASH}{_fmt_km(b)}km" for a, b in pairwise(bounds)]
    return [*labels, f"{_fmt_km(bounds[-1])}km+"]


def centroid(points: Sequence[LatLng]) -> LatLng:
    if not points:
        raise ValueError("centroid of no points")
    return (
        sum(p[0] for p in points) / len(points),
        sum(p[1] for p in points) / len(points),
    )


def median_point(points: Sequence[LatLng]) -> LatLng:
    if not points:
        raise ValueError("median of no points")
    return median(p[0] for p in points), median(p[1] for p in points)


def parse_latlng(text: str) -> LatLng | None:
    """Parse "lat,lng" text. Returns None when it is not a valid coordinate pair."""
    match = _LATLNG_RE.match(text)
    if not match:
        return None
    lat, lng = float(match.group(1)), float(match.group(2))
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return lat, lng


def dbscan(points: Sequence[LatLng], eps_km: float, min_samples: int) -> list[int]:
    """DBSCAN over haversine distance. Labels are 0..k-1 in discovery order; noise is -1.

    A point counts itself as a neighbour, so min_samples=1 turns every point into a core
    point and the clusters become connected components at distance eps_km.
    """
    n = len(points)
    neighbours = [
        [j for j in range(n) if distance_km(points[i], points[j]) <= eps_km] for i in range(n)
    ]
    is_core = [len(neighbours[i]) >= min_samples for i in range(n)]
    labels = [NOISE] * n
    visited = [False] * n
    cluster = 0
    for i in range(n):
        if visited[i] or not is_core[i]:
            continue
        visited[i] = True
        labels[i] = cluster
        queue = list(neighbours[i])
        while queue:
            j = queue.pop()
            if labels[j] == NOISE:
                labels[j] = cluster
            if visited[j]:
                continue
            visited[j] = True
            if is_core[j]:
                queue.extend(neighbours[j])
        cluster += 1
    return labels
