"""Overpass API (OSM): named attractions, museums, viewpoints, historic sites, temples."""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx
from pydantic import BaseModel, Field

from tiktok_trip.context import Context
from tiktok_trip.errors import UserFacingError
from tiktok_trip.http import CachedClient, RateLimiter

log = logging.getLogger(__name__)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
"""Canonical endpoint: the cache key of every query, whichever mirror answered it."""
USER_AGENT = "tiktok-trip/0.1 (personal trip planner)"
TOURISM_KINDS = ("attraction", "museum", "viewpoint", "artwork")
NIGHTLIFE_AMENITIES = frozenset({"bar", "pub", "nightclub"})


class OverpassElement(BaseModel):
    osm_type: str
    osm_id: int
    lat: float
    lng: float
    tags: dict[str, str] = Field(default_factory=dict)

    @property
    def ref(self) -> str:
        return f"osm:{self.osm_type}/{self.osm_id}"

    @property
    def name(self) -> str:
        return self.tags.get("name", "")

    @property
    def kind(self) -> str:
        tourism = self.tags.get("tourism")
        if tourism in TOURISM_KINDS:
            return tourism
        if "historic" in self.tags:
            return self.tags["historic"]
        return self.tags.get("amenity", "attraction")

    @property
    def is_notable(self) -> bool:
        return "wikipedia" in self.tags or "wikidata" in self.tags

    @property
    def is_sight(self) -> bool:
        """False for bars, pubs, nightclubs, shops and offices (OSM sometimes also tags them
        tourism=attraction) unless they carry a wikipedia/wikidata tag."""
        if self.is_notable:
            return True
        if self.tags.get("amenity") in NIGHTLIFE_AMENITIES:
            return False
        return "shop" not in self.tags and "office" not in self.tags

    @property
    def family_rank(self) -> int:
        if self.tags.get("tourism") in TOURISM_KINDS:
            return 0
        if "historic" in self.tags:
            return 1
        return 2


def build_query(lat: float, lng: float, radius_m: int, timeout_s: int = 25) -> str:
    around = f"(around:{radius_m},{lat:.6f},{lng:.6f})"
    tourism = "|".join(TOURISM_KINDS)
    return (
        f"[out:json][timeout:{timeout_s}];\n"
        "(\n"
        f'  nwr{around}["tourism"~"^({tourism})$"]["name"];\n'
        f'  nwr{around}["historic"]["name"];\n'
        f'  nwr{around}["amenity"="place_of_worship"]["name"];\n'
        ");\n"
        "out center;"
    )


class OverpassUnavailableError(UserFacingError):
    """Every configured Overpass endpoint failed for one query."""


def incomplete_reason(payload: Any) -> str | None:
    """Overpass reports timeouts and out-of-memory as HTTP 200 with a `remark`: not an answer."""
    if not isinstance(payload, dict) or not isinstance(payload.get("elements"), list):
        return "answer without an elements list"
    if remark := payload.get("remark"):
        return f"soft error: {remark}"
    return None


def is_complete_answer(payload: Any) -> bool:
    return incomplete_reason(payload) is None


def parse_elements(payload: dict[str, Any]) -> list[OverpassElement]:
    """Nodes carry lat/lon; ways and relations carry a `center` from `out center;`."""
    elements: list[OverpassElement] = []
    for item in payload.get("elements", []):
        point = item if "lat" in item else item.get("center")
        tags = item.get("tags") or {}
        if not point or not tags.get("name"):
            continue
        elements.append(
            OverpassElement(
                osm_type=item["type"],
                osm_id=int(item["id"]),
                lat=float(point["lat"]),
                lng=float(point["lon"]),
                tags={str(k): str(v) for k, v in tags.items()},
            )
        )
    return elements


class OverpassClient:
    """Queries `nearby.overpass_endpoints` in order; each mirror has its own 1 req/s limiter."""

    def __init__(self, ctx: Context) -> None:
        self._clients = [
            CachedClient(
                "overpass",
                ctx.paths.cache,
                ctx.api_log,
                rate_limiter=RateLimiter(1.0),
                headers={"User-Agent": USER_AGENT},
                timeout_s=60,
                quota=ctx.quota,
            )
            for _ in ctx.config.nearby.overpass_endpoints
        ]
        self._endpoints = list(ctx.config.nearby.overpass_endpoints)

    def around(
        self, lat: float, lng: float, radius_km: float, *, note: str = ""
    ) -> list[OverpassElement]:
        """Raises OverpassUnavailableError when no endpoint gives a complete answer."""
        # CachedClient sends JSON bodies only; Overpass accepts the same query as GET ?data=.
        query = build_query(lat, lng, round(radius_km * 1000))
        failures: list[str] = []
        for endpoint, client in zip(self._endpoints, self._clients, strict=True):
            reason: str | None
            try:
                payload = client.request_json(
                    "GET",
                    endpoint,
                    params={"data": query},
                    sku="overpass",
                    note=note or "around",
                    cacheable=is_complete_answer,
                    cache_key_url=OVERPASS_URL,
                )
                reason = incomplete_reason(payload)
            except (httpx.HTTPError, json.JSONDecodeError) as exc:
                reason = _failure(exc)
            if reason is None:
                return parse_elements(payload)
            host = httpx.URL(endpoint).host
            failures.append(f"{host}: {reason}")
            log.warning("Overpass %s failed for %s (%s); not cached", host, note or "query", reason)
        raise OverpassUnavailableError(
            f"every Overpass endpoint failed for {note or 'query'}: " + "; ".join(failures)
        )


def _failure(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code}"
    if isinstance(exc, json.JSONDecodeError):
        return "response is not JSON"
    return f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
