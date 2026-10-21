"""OSRM road routing (FOSSGIS public server by default): the road geometry of one leg.

The public server is free under a fair-use policy: at most 1 request/second, every answer cached.
"""

from __future__ import annotations

from typing import Any

import httpx
from pydantic import BaseModel

from tiktok_trip.context import Context
from tiktok_trip.geo import LatLng
from tiktok_trip.http import CachedClient, RateLimiter

USER_AGENT = "tiktok-trip/0.1 (personal trip planner)"
SKU = "osrm_route"
ROUTE_PARAMS = {"overview": "full", "geometries": "polyline"}
NO_ROUTE_STATUS = 400
"""OSRM answers NoRoute / NoSegment with HTTP 400 and a JSON `code`."""


class RoadRoute(BaseModel):
    polyline: str
    """Encoded polyline, precision 5 (Google's format)."""
    distance_m: float
    duration_s: float


def route_url(endpoint: str, profile: str, start: LatLng, end: LatLng) -> str:
    """`<endpoint>/<profile>/route/v1/driving/<lng,lat;lng,lat>`; an empty profile is left out."""
    base = "/".join(part.strip("/") for part in (endpoint, profile) if part.strip("/"))
    coordinates = ";".join(f"{lng:.6f},{lat:.6f}" for lat, lng in (start, end))
    return f"{base}/route/v1/driving/{coordinates}"


def is_ok(payload: Any) -> bool:
    return isinstance(payload, dict) and payload.get("code") == "Ok"


def parse_route(payload: Any) -> RoadRoute | None:
    """The first route of an `Ok` answer; None for any other answer."""
    if not is_ok(payload) or not payload.get("routes"):
        return None
    route = payload["routes"][0]
    geometry = route.get("geometry")
    if not isinstance(geometry, str) or not geometry:
        return None
    return RoadRoute(
        polyline=geometry,
        distance_m=float(route.get("distance", 0.0)),
        duration_s=float(route.get("duration", 0.0)),
    )


class OsrmClient:
    def __init__(self, ctx: Context) -> None:
        roads = ctx.config.roads
        self._endpoint = roads.endpoint
        self._profile = roads.profiles[ctx.config.travel.mode]
        self._client = CachedClient(
            "osrm",
            ctx.paths.cache,
            ctx.api_log,
            rate_limiter=RateLimiter(1.0),
            headers={"User-Agent": USER_AGENT},
            quota=ctx.quota,
        )

    def route(
        self, start: LatLng, end: LatLng, *, note: str = "", cache_only: bool = False
    ) -> RoadRoute | None:
        """None when OSRM finds no route (or, with `cache_only`, when nothing is cached).

        Raises httpx.HTTPError for network and server failures; nothing failed is cached.
        """
        try:
            payload = self._client.request_json(
                "GET",
                route_url(self._endpoint, self._profile, start, end),
                params=ROUTE_PARAMS,
                sku=SKU,
                note=f"{self._profile}:{note}" if note else self._profile,
                cacheable=is_ok,
                cache_only=cache_only,
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == NO_ROUTE_STATUS:
                return None
            raise
        return parse_route(payload)

    def close(self) -> None:
        self._client.close()
