"""Photon (komoot) geocoder over OpenStreetMap data. Free, no key; fair use only."""

from __future__ import annotations

from typing import Any

from tiktok_trip.clients.geocoder import GeoPoint
from tiktok_trip.clients.nominatim import USER_AGENT
from tiktok_trip.context import Context
from tiktok_trip.http import CachedClient, RateLimiter

BASE_URL = "https://photon.komoot.io/api/"
MIN_FETCH = 10
OSM_TYPES = {"N": "node", "W": "way", "R": "relation"}
CITY_KINDS = {"city", "town"}
NAME_FIELDS = ("name", "street", "district", "city", "state", "country")


class PhotonClient:
    def __init__(self, ctx: Context) -> None:
        self._country = ctx.config.country_code.upper()
        self._client = CachedClient(
            "photon",
            ctx.paths.cache,
            ctx.api_log,
            rate_limiter=RateLimiter(0.5),
            headers={"User-Agent": USER_AGENT},
            quota=ctx.quota,
        )

    def search(
        self, query: str, *, limit: int = 5, near: tuple[float, float] | None = None
    ) -> list[GeoPoint]:
        """Results inside the configured country; fetches extra hits since filtering is local."""
        params: dict[str, Any] = {"q": query, "limit": max(limit, MIN_FETCH), "lang": "en"}
        if near is not None:
            params |= {"lat": near[0], "lon": near[1]}
        payload = self._client.request_json(
            "GET",
            BASE_URL,
            params=params,
            sku="photon",
            note=f"search:{query[:60]}",
        )
        return parse_features(payload, self._country)[:limit]

    def geocode(self, query: str) -> GeoPoint | None:
        results = self.search(query, limit=1)
        return results[0] if results else None

    def city_point(self, city: str) -> GeoPoint | None:
        points = self.search(city, limit=MIN_FETCH)
        for point in points:
            if point.osm_class == "place" and point.osm_kind in CITY_KINDS:
                return point
        for point in points:
            if point.osm_class in {"place", "boundary"}:
                return point
        return None

    def close(self) -> None:
        self._client.close()


def parse_features(payload: dict[str, Any], country: str = "") -> list[GeoPoint]:
    points: list[GeoPoint] = []
    for feature in payload.get("features", []):
        props: dict[str, Any] = feature.get("properties") or {}
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        if country and str(props.get("countrycode", "")).upper() != country:
            continue
        osm_id = props.get("osm_id")
        points.append(
            GeoPoint(
                lat=float(coords[1]),
                lng=float(coords[0]),
                display_name=_display_name(props),
                osm_type=OSM_TYPES.get(str(props.get("osm_type", ""))),
                osm_id=int(osm_id) if osm_id is not None else None,
                osm_class=props.get("osm_key"),
                osm_kind=props.get("osm_value"),
                source="photon",
            )
        )
    return points


def _display_name(props: dict[str, Any]) -> str:
    parts: list[str] = []
    for field in NAME_FIELDS:
        value = str(props.get(field) or "").strip()
        if value and value not in parts:
            parts.append(value)
    return ", ".join(parts)
