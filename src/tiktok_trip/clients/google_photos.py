"""Google Places (New) place photos: photo names via Place Details, then a short-lived image URI.

The `photos` field alone is the Place Details Essentials sku; a media call is a Place Photos call.
The image bytes behind the returned URI are not billed and are downloaded with plain httpx.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from tiktok_trip.clients.google_places import BASE_URL
from tiktok_trip.context import Context
from tiktok_trip.http import CachedClient
from tiktok_trip.models import MediaAttribution

PHOTOS_FIELD_MASK = "photos"
SKU_DETAILS_ESSENTIALS = "place_details_essentials"
SKU_PHOTOS = "place_photos"
MAX_WIDTH_PX = 640


class PlacePhoto(BaseModel):
    name: str
    width: int | None = None
    height: int | None = None
    attributions: list[MediaAttribution] = Field(default_factory=list)
    google_maps_uri: str | None = None


class GooglePhotosClient:
    def __init__(self, ctx: Context, *, client: CachedClient | None = None) -> None:
        self._key = ctx.secrets.require("google_maps_key")
        self._client = client or CachedClient(
            "google_places", ctx.paths.cache, ctx.api_log, quota=ctx.quota, paid=True
        )

    def photos(self, google_id: str, *, use_cache: bool = True) -> list[PlacePhoto]:
        payload = self._client.request_json(
            "GET",
            f"{BASE_URL}/places/{google_id}",
            headers={"X-Goog-Api-Key": self._key, "X-Goog-FieldMask": PHOTOS_FIELD_MASK},
            sku=SKU_DETAILS_ESSENTIALS,
            note=google_id,
            use_cache=use_cache,
        )
        return parse_photos(payload)

    def photo_uri(
        self, photo_name: str, *, max_width_px: int = MAX_WIDTH_PX, use_cache: bool = True
    ) -> str | None:
        payload = self._client.request_json(
            "GET",
            f"{BASE_URL}/{photo_name}/media",
            params={"maxWidthPx": max_width_px, "skipHttpRedirect": "true"},
            headers={"X-Goog-Api-Key": self._key},
            sku=SKU_PHOTOS,
            note=photo_name.removeprefix("places/").split("/")[0],
            use_cache=use_cache,
        )
        uri = payload.get("photoUri") if isinstance(payload, dict) else None
        return str(uri) if uri else None

    def close(self) -> None:
        self._client.close()


def parse_photos(payload: dict[str, Any]) -> list[PlacePhoto]:
    photos: list[PlacePhoto] = []
    for item in payload.get("photos", []) or []:
        name = item.get("name")
        if not name:
            continue
        photos.append(
            PlacePhoto(
                name=str(name),
                width=item.get("widthPx"),
                height=item.get("heightPx"),
                attributions=[
                    MediaAttribution(name=str(author["displayName"]), uri=author.get("uri"))
                    for author in item.get("authorAttributions", []) or []
                    if author.get("displayName")
                ],
                google_maps_uri=item.get("googleMapsUri"),
            )
        )
    return photos
