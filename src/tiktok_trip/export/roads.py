"""Road geometry of every planned leg for the map (OSRM); a leg without one is drawn straight.

Legs are keyed "<from>><to>" with the travel matrix ids (MapTravel.ids): "center" for start,
end and rest stops, else the place or nearby spot id, so the plan editor finds a leg again
after the user reorders stops.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from itertools import pairwise

import httpx

from tiktok_trip.clients.osrm import OsrmClient
from tiktok_trip.context import Context
from tiktok_trip.export.excel_plan import CENTER_KINDS
from tiktok_trip.geo import LatLng
from tiktok_trip.models import DayPlan, Itinerary, RouteStop
from tiktok_trip.planning.matrix import CENTER_ID

logger = logging.getLogger(__name__)

LEG_SEPARATOR = ">"


@dataclass(frozen=True)
class RoadLeg:
    key: str
    start: LatLng
    end: LatLng


def leg_node(stop: RouteStop) -> str:
    if stop.kind in CENTER_KINDS or not stop.ref_id:
        return CENTER_ID
    return stop.ref_id


def leg_key(start: RouteStop, end: RouteStop) -> str:
    return f"{leg_node(start)}{LEG_SEPARATOR}{leg_node(end)}"


def road_legs(days: Iterable[DayPlan]) -> list[RoadLeg]:
    """Consecutive stops of every day, each key once; stops at the same point need no road."""
    legs: dict[str, RoadLeg] = {}
    for day in days:
        for start, end in pairwise(day.stops):
            a, b = (start.lat, start.lng), (end.lat, end.lng)
            key = leg_key(start, end)
            if a != b and key not in legs:
                legs[key] = RoadLeg(key, a, b)
    return list(legs.values())


def collect_roads(client: OsrmClient, legs: Sequence[RoadLeg]) -> dict[str, str]:
    """Encoded polyline per leg key. After the first failed request only cached legs are used."""
    roads: dict[str, str] = {}
    failure: str | None = None
    for leg in legs:
        try:
            route = client.route(leg.start, leg.end, note=leg.key, cache_only=failure is not None)
        except httpx.HTTPError as exc:
            failure = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
            route = None
        if route is not None:
            roads[leg.key] = route.polyline
    missing = len(legs) - len(roads)
    if missing:
        cause = f"; the routing server failed ({failure}), later legs came from the cache only"
        logger.warning(
            "No road geometry for %d of %d legs%s. Those legs are drawn as straight lines.",
            missing,
            len(legs),
            cause if failure else "",
        )
    else:
        logger.info("Road geometry for all %d legs.", len(legs))
    return roads


def fetch_roads(ctx: Context, itinerary: Itinerary | None) -> dict[str, str]:
    """Empty without a plan or with `roads.enabled: false` (no request is sent)."""
    if not ctx.config.roads.enabled or itinerary is None:
        return {}
    legs = road_legs(itinerary.days)
    if not legs:
        return {}
    client = OsrmClient(ctx)
    try:
        return collect_roads(client, legs)
    finally:
        client.close()
