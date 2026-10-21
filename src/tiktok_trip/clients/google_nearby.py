"""Google Places (New) Nearby Search for popular tourist attractions around a point."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from tiktok_trip.context import Context
from tiktok_trip.http import CachedClient

NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
FIELD_MASK = "places.id,places.displayName,places.location,places.rating,places.userRatingCount"
MAX_RESULTS = 20
SKU_NEARBY_ENTERPRISE = "nearby_search_enterprise"


class GooglePlaceHit(BaseModel):
    place_id: str
    name: str
    lat: float
    lng: float
    rating: float | None = None
    rating_count: int | None = None

    @property
    def ref(self) -> str:
        return f"gp:{self.place_id}"


def build_body(lat: float, lng: float, radius_km: float) -> dict[str, Any]:
    return {
        "includedTypes": ["tourist_attraction"],
        "maxResultCount": MAX_RESULTS,
        "rankPreference": "POPULARITY",
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": round(radius_km * 1000, 1),
            }
        },
    }


def parse_places(payload: dict[str, Any]) -> list[GooglePlaceHit]:
    hits: list[GooglePlaceHit] = []
    for item in payload.get("places", []):
        location = item.get("location") or {}
        if "latitude" not in location or "id" not in item:
            continue
        hits.append(
            GooglePlaceHit(
                place_id=item["id"],
                name=(item.get("displayName") or {}).get("text", item["id"]),
                lat=float(location["latitude"]),
                lng=float(location["longitude"]),
                rating=item.get("rating"),
                rating_count=item.get("userRatingCount"),
            )
        )
    return hits


class GoogleNearbyClient:
    def __init__(self, ctx: Context) -> None:
        self._key = ctx.secrets.require("google_maps_key")
        self._client = CachedClient(
            "google_nearby", ctx.paths.cache, ctx.api_log, quota=ctx.quota, paid=True
        )

    def search(
        self, lat: float, lng: float, radius_km: float, *, note: str = ""
    ) -> list[GooglePlaceHit]:
        payload = self._client.request_json(
            "POST",
            NEARBY_URL,
            json_body=build_body(lat, lng, radius_km),
            headers={"X-Goog-Api-Key": self._key, "X-Goog-FieldMask": FIELD_MASK},
            sku=SKU_NEARBY_ENTERPRISE,
            note=note or "searchNearby",
        )
        return parse_places(payload)
