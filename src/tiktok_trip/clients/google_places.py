"""Google Places API (New): Text Search for resolve, Place Details for enrich.

Field masks decide the SKU. Each call names its SKU; config.yaml `quota` caps use the same names.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from tiktok_trip.clock import EN_DASH, to_hhmm
from tiktok_trip.context import Context
from tiktok_trip.http import CachedClient
from tiktok_trip.models import Hours, OpeningPeriod, PriceRange

BASE_URL = "https://places.googleapis.com/v1"
TEXT_SEARCH_URL = f"{BASE_URL}/places:searchText"
SEARCH_FIELD_MASK = (
    "places.id,places.displayName,places.formattedAddress,places.location,"
    "places.businessStatus,places.types"
)
BASIC_FIELD_MASK = "id,displayName,formattedAddress,location,businessStatus,types"
DETAILS_FIELD_MASK = "regularOpeningHours,priceLevel,priceRange,rating,userRatingCount"
MAX_BIAS_RADIUS_M = 50_000.0
LANGUAGE = "vi"


SKU_TEXT_SEARCH = "text_search_pro"
SKU_DETAILS_PRO = "place_details_pro"
SKU_DETAILS_ENTERPRISE = "place_details_enterprise"

PRICE_LEVEL_TEXT = {
    "PRICE_LEVEL_FREE": "free",
    "PRICE_LEVEL_INEXPENSIVE": "$ (inexpensive)",
    "PRICE_LEVEL_MODERATE": "$$ (moderate)",
    "PRICE_LEVEL_EXPENSIVE": "$$$ (expensive)",
    "PRICE_LEVEL_VERY_EXPENSIVE": "$$$$ (very expensive)",
}


class SearchPlace(BaseModel):
    """One Text Search hit, or a Place Details call with the basic mask."""

    google_id: str
    name: str
    address: str
    lat: float
    lng: float
    business_status: str | None = None
    types: list[str] = Field(default_factory=list)

    @property
    def place_id(self) -> str:
        return f"gp:{self.google_id}"


class PlaceDetails(BaseModel):
    hours: Hours | None = None
    price_range: PriceRange | None = None
    rating: float | None = None
    rating_count: int | None = None


class GooglePlacesClient:
    def __init__(self, ctx: Context, *, client: CachedClient | None = None) -> None:
        self._key = ctx.secrets.require("google_maps_key")
        self._region = ctx.config.country_code.upper()
        self._client = client or CachedClient(
            "google_places", ctx.paths.cache, ctx.api_log, quota=ctx.quota, paid=True
        )

    def _headers(self, mask: str) -> dict[str, str]:
        return {"X-Goog-Api-Key": self._key, "X-Goog-FieldMask": mask}

    def text_search(
        self,
        query: str,
        *,
        center: tuple[float, float] | None = None,
        radius_m: float = MAX_BIAS_RADIUS_M,
    ) -> list[SearchPlace]:
        """Biased to a circle around `center`, or only to the region code when it is None."""
        body: dict[str, Any] = {
            "textQuery": query,
            "languageCode": LANGUAGE,
            "regionCode": self._region,
        }
        if center is not None:
            body["locationBias"] = {
                "circle": {
                    "center": {"latitude": center[0], "longitude": center[1]},
                    "radius": min(radius_m, MAX_BIAS_RADIUS_M),
                }
            }
        payload = self._client.request_json(
            "POST",
            TEXT_SEARCH_URL,
            json_body=body,
            headers=self._headers(SEARCH_FIELD_MASK),
            sku=SKU_TEXT_SEARCH,
            note=query[:60],
        )
        return parse_search(payload)

    def place(self, google_id: str) -> SearchPlace | None:
        """Location and status of one place by id (Details, basic Pro fields only)."""
        payload = self._client.request_json(
            "GET",
            f"{BASE_URL}/places/{google_id}",
            params={"languageCode": LANGUAGE},
            headers=self._headers(BASIC_FIELD_MASK),
            sku=SKU_DETAILS_PRO,
            note=google_id,
        )
        return parse_place(payload)

    def details(self, google_id: str) -> PlaceDetails:
        payload = self._client.request_json(
            "GET",
            f"{BASE_URL}/places/{google_id}",
            params={"languageCode": LANGUAGE},
            headers=self._headers(DETAILS_FIELD_MASK),
            sku=SKU_DETAILS_ENTERPRISE,
            note=google_id,
        )
        return parse_details(payload)

    def close(self) -> None:
        self._client.close()


def parse_search(payload: dict[str, Any]) -> list[SearchPlace]:
    return [p for item in payload.get("places", []) if (p := parse_place(item)) is not None]


def parse_place(item: dict[str, Any]) -> SearchPlace | None:
    location = item.get("location") or {}
    if "id" not in item or "latitude" not in location or "longitude" not in location:
        return None
    return SearchPlace(
        google_id=item["id"],
        name=(item.get("displayName") or {}).get("text", ""),
        address=item.get("formattedAddress", ""),
        lat=float(location["latitude"]),
        lng=float(location["longitude"]),
        business_status=item.get("businessStatus"),
        types=list(item.get("types", [])),
    )


def parse_details(payload: dict[str, Any]) -> PlaceDetails:
    rating = payload.get("rating")
    count = payload.get("userRatingCount")
    return PlaceDetails(
        hours=parse_hours(payload.get("regularOpeningHours")),
        price_range=parse_price(payload.get("priceRange"), payload.get("priceLevel")),
        rating=float(rating) if rating is not None else None,
        rating_count=int(count) if count is not None else None,
    )


def to_weekday(google_day: int) -> int:
    """Google counts 0 = Sunday; the project counts 0 = Monday."""
    return (google_day - 1) % 7


def point_hhmm(point: dict[str, Any]) -> str:
    """Accepts the New API {hour, minute} shape and the legacy "HHMM" time string."""
    if "time" in point:
        raw = str(point["time"]).zfill(4)
        return to_hhmm(int(raw[:2]) * 60 + int(raw[2:]))
    return to_hhmm(int(point.get("hour", 0)) * 60 + int(point.get("minute", 0)))


def parse_hours(raw: dict[str, Any] | None) -> Hours | None:
    if not raw:
        return None
    periods: list[OpeningPeriod] = []
    for period in raw.get("periods", []):
        start = period.get("open")
        if not start or "day" not in start:
            continue
        end = period.get("close")
        periods.append(
            OpeningPeriod(
                day=to_weekday(int(start["day"])),
                open=point_hhmm(start),
                close=point_hhmm(end) if end else None,
            )
        )
    if len(periods) == 1 and periods[0].close is None and periods[0].open == "00:00":
        periods = [OpeningPeriod(day=day, open="00:00", close=None) for day in range(7)]
    periods.sort(key=lambda p: (p.day, p.open))
    weekday_text = [str(text) for text in raw.get("weekdayDescriptions", [])]
    if not periods and not weekday_text:
        return None
    return Hours(periods=periods, weekday_text=weekday_text, source="google")


MIN_PRICE_UNITS = {"VND": 1_000}
"""Below this a bound is a placeholder (Google sends startPrice 1 VND for "up to X")."""


def _money_units(money: dict[str, Any] | None, currency: str) -> int | None:
    if not money or money.get("units") in (None, ""):
        return None
    units = int(money["units"])
    return units if units >= MIN_PRICE_UNITS.get(currency, 1) else None


def format_amount(units: int) -> str:
    return f"{units:,}".replace(",", ".")


def parse_price(price_range: dict[str, Any] | None, price_level: str | None) -> PriceRange | None:
    """Google priceRange, dropping placeholder bounds; falls back to the priceLevel text."""
    if price_range:
        start, end = price_range.get("startPrice"), price_range.get("endPrice")
        currency = (start or end or {}).get("currencyCode", "")
        low, high = _money_units(start, currency), _money_units(end, currency)
        suffix = f" {currency}" if currency else ""
        if low is not None and high is not None:
            span = format_amount(low)
            if high > low:
                span = f"{span}{EN_DASH}{format_amount(high)}"
            return PriceRange(value=f"{span}{suffix}", source="google")
        if high is not None:
            return PriceRange(value=f"đến {format_amount(high)}{suffix}", source="google")
        if low is not None:
            return PriceRange(value=f"{format_amount(low)}+{suffix}", source="google")
    if price_level and price_level in PRICE_LEVEL_TEXT:
        return PriceRange(value=PRICE_LEVEL_TEXT[price_level], source="google")
    return None
