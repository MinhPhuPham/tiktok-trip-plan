"""OpenStreetMap Nominatim geocoder. Free, 1 request/second, needs a User-Agent."""

from __future__ import annotations

from typing import Any

from tiktok_trip.clients.geocoder import GeoPoint
from tiktok_trip.context import Context
from tiktok_trip.http import CachedClient, RateLimiter

BASE_URL = "https://nominatim.openstreetmap.org"
USER_AGENT = "tiktok-trip/0.1 (personal trip planner)"
NEAR_BOX_DEG = 0.27


class NominatimClient:
    def __init__(self, ctx: Context) -> None:
        self._country = ctx.config.country_code.lower()
        self._client = CachedClient(
            "nominatim",
            ctx.paths.cache,
            ctx.api_log,
            rate_limiter=RateLimiter(1.0),
            headers={"User-Agent": USER_AGENT, "Accept-Language": "vi,en"},
            quota=ctx.quota,
        )

    def search(
        self,
        query: str,
        *,
        limit: int = 5,
        country_bias: bool = True,
        near: tuple[float, float] | None = None,
    ) -> list[GeoPoint]:
        """`near` prefers hits inside a box of about 30 km around that point (not a hard filter)."""
        params: dict[str, Any] = {
            "q": query,
            "format": "jsonv2",
            "limit": limit,
            "addressdetails": 0,
        }
        if country_bias:
            params["countrycodes"] = self._country
        if near is not None:
            lat, lng = near
            d = NEAR_BOX_DEG
            params["viewbox"] = f"{lng - d},{lat + d},{lng + d},{lat - d}"
        payload = self._client.request_json(
            "GET", f"{BASE_URL}/search", params=params, sku="nominatim", note=f"search:{query[:60]}"
        )
        return [_to_point(item) for item in payload]

    def geocode(self, query: str) -> GeoPoint | None:
        results = self.search(query, limit=1)
        return results[0] if results else None

    def city_point(self, city: str) -> GeoPoint | None:
        """The city's own OSM place node, which marks the traditional downtown."""
        for point in self.search(city, limit=10):
            if point.osm_class == "place" and point.osm_kind in {"city", "town", "municipality"}:
                return point
        for point in self.search(city, limit=10):
            if point.osm_class in {"place", "boundary"}:
                return point
        return None

    def close(self) -> None:
        self._client.close()


def _to_point(item: dict[str, Any]) -> GeoPoint:
    return GeoPoint(
        lat=float(item["lat"]),
        lng=float(item["lon"]),
        display_name=item.get("display_name", ""),
        osm_type=item.get("osm_type"),
        osm_id=item.get("osm_id"),
        osm_class=item.get("class"),
        osm_kind=item.get("type"),
        source="nominatim",
    )
