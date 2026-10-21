from __future__ import annotations

import os
from collections.abc import Mapping
from datetime import date
from pathlib import Path
from typing import Any, Literal

import yaml
from dotenv import dotenv_values
from pydantic import BaseModel, Field, NonNegativeInt, field_validator

from tiktok_trip.clock import EN_DASH
from tiktok_trip.errors import UserFacingError
from tiktok_trip.models import Category

HHMM = r"^\d{2}:\d{2}$"

DayGrouping = Literal["sector", "nearest"]


class CenterConfig(BaseModel):
    hotel: str = ""
    override: str = ""


class SpatialConfig(BaseModel):
    sectors: Literal[4, 8] = 8
    rings_km: list[float] = Field(default_factory=lambda: [2.0, 5.0, 10.0])
    cluster_eps_km: float = 3.0
    cluster_min_places: int = 1
    center_sanity_km: float = 10


TravelMode = Literal["walking", "motorbike", "car"]


class TravelConfig(BaseModel):
    mode: TravelMode = "motorbike"
    time_buffer: float = 1.2


class TripConfig(BaseModel):
    days: int = Field(default=3, ge=1)
    trip_start_date: date | None = None
    day_start: str = Field(default="08:00", pattern=HHMM)
    day_end: str = Field(default="22:00", pattern=HHMM)
    service_minutes: dict[Category, int] = Field(
        default_factory=lambda: {
            Category.FOOD: 45,
            Category.CAFE: 45,
            Category.ATTRACTION: 75,
            Category.OTHER: 30,
        }
    )
    max_zones_per_day: int = 2
    day_grouping: DayGrouping = "sector"
    """sector: one compass sector per day, topped up from its neighbours; nearest: largest
    zone first, paired with its nearest zones. Both balance real places per day."""
    max_places_per_day: int | None = Field(default=None, ge=1)
    """Hard cap on real places per day; None balances days at ceil(places / days)."""
    max_nearby_per_day: int = Field(default=3, ge=0)
    """Optional nearby spots added to a day once all its places fit, nearest to the route first."""


PlanMode = Literal["agent", "solver"]
REST_SLOT = "rest"


class RhythmSlot(BaseModel):
    """One part of the day rhythm. Guidance for the planner, not a hard window."""

    id: str = Field(min_length=1)
    name_en: str
    name_vi: str
    start: str = Field(pattern=HHMM)
    end: str = Field(pattern=HHMM)
    categories: list[Category] = Field(default_factory=list)
    """Place categories that suit the slot; empty for the rest slot (no place)."""
    hint: str = ""


def default_rhythm() -> list[RhythmSlot]:
    attraction, food, cafe, other = (
        Category.ATTRACTION,
        Category.FOOD,
        Category.CAFE,
        Category.OTHER,
    )
    rows: list[tuple[str, str, str, str, str, list[Category], str]] = [
        (
            "sunrise",
            "Sunrise and cloud hunting",
            "Ngắm bình minh, săn mây",
            "04:30",
            "07:00",
            [attraction],
            "viewpoints, săn mây / bình minh, đồi, đèo, đỉnh núi",
        ),
        (
            "breakfast",
            "Breakfast",
            "Ăn sáng",
            "07:00",
            "08:30",
            [food],
            "bún, phở, bánh mì, xôi, cháo, bánh canh",
        ),
        (
            "morning",
            "Morning activity",
            "Hoạt động buổi sáng",
            "08:30",
            "11:30",
            [attraction, other],
            "gardens, farms, parks, play areas, spa and other services",
        ),
        ("lunch", "Lunch", "Ăn trưa", "11:30", "13:00", [food], "rice, noodles, local dishes"),
        (
            REST_SLOT,
            "Relax at the hotel",
            "Nghỉ ngơi ở khách sạn",
            "13:00",
            "14:30",
            [],
            "back to the center or hotel, no place",
        ),
        (
            "cafe",
            "Café with a view",
            "Cà phê view đẹp",
            "14:30",
            "17:30",
            [cafe],
            "view cafés, forest / hill / lake cafés",
        ),
        (
            "dinner",
            "Dinner",
            "Ăn tối",
            "17:30",
            "19:30",
            [food],
            "lẩu, nướng, BBQ, buffet, restaurants",
        ),
        (
            "evening",
            "Hang out",
            "Đi chơi buổi tối",
            "19:30",
            "22:00",
            [attraction, other],
            "night market (chợ Đà Lạt), walks, night spots, shopping",
        ),
    ]
    return [
        RhythmSlot(id=sid, name_en=en, name_vi=vi, start=start, end=end, categories=cats, hint=hint)
        for sid, en, vi, start, end, cats, hint in rows
    ]


class PlanConfig(BaseModel):
    """How plan-to-go is built. `agent`: Claude Code orders the stops from a prompt and the code
    computes the clock; `solver`: the OR-Tools route (trip.day_start/day_end)."""

    mode: PlanMode = "agent"
    day_start: str = Field(default="04:00", pattern=HHMM)
    day_end: str = Field(default="22:00", pattern=HHMM)
    rhythm: list[RhythmSlot] = Field(default_factory=default_rhythm, min_length=1)
    rest_at_center: bool = True
    target_places_per_day: int = Field(default=8, ge=1)
    """Comfortable number of places per day the plan prompt aims for; extras go under unplaced."""

    def slot(self, slot_id: str | None) -> RhythmSlot | None:
        return next((s for s in self.rhythm if s.id == slot_id), None)

    def slot_index(self, slot_id: str | None) -> int | None:
        return next((i for i, s in enumerate(self.rhythm) if s.id == slot_id), None)


DEFAULT_EXCLUDE_KEYWORDS: tuple[str, ...] = (
    "homestay",
    "hotel",
    "khách sạn",
    "villa",
    "resort",
    "glamping",
    "nhà xe",
    "thuê xe",
    "thuê đồ",
    "rental",
    "motor",
    "head spa",
    "tiệm gội",
    "bus",
)


class ResolveConfig(BaseModel):
    max_city_distance_km: float = 40
    min_name_score: float = 70
    min_exact_address_name_score: float = 50
    """Name score enough to accept an option at exactly the printed house number and street."""
    review_below_confidence: float = 0.7
    exclude_keywords: list[str] = Field(default_factory=lambda: list(DEFAULT_EXCLUDE_KEYWORDS))
    """Whole words (case and diacritics ignored) in the name or notes of an `other` candidate
    that mark lodging, transport or rental services: such candidates are never resolved."""


class NearbyConfig(BaseModel):
    provider: Literal["overpass", "google"] = "overpass"
    radius_km: float = 1.2
    top_n: int = 3
    service_minutes: int = Field(default=45, ge=0)
    """Minutes planned at a nearby spot (places use trip.service_minutes)."""
    overpass_endpoints: list[str] = Field(
        default_factory=lambda: [
            "https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter",
        ],
        min_length=1,
    )


class ExtractConfig(BaseModel):
    """Every frame the media step kept goes into the prompt; media.max_frames caps them."""

    max_comments: int = 40


class FetchConfig(BaseModel):
    comments: Literal["playwright", "none"] = "playwright"
    max_comments: int = Field(default=200, ge=1)
    headless: bool = True
    browser_timeout_s: float = Field(default=90, gt=0)


class MediaConfig(BaseModel):
    scene_threshold: float = 0.3
    safety_frame_every_n: int = 90
    max_frames: int = 15
    whisper_model: str = "large-v3"
    whisper_compute_type: str = "int8"
    language: str = "vi"


class CityProfile(BaseModel):
    """City-specific words, climate and default center for matching, best time and spatial.

    `center_landmark` names the default center (in Vietnamese cities the central market marks
    downtown); an empty string falls back to the geocoder's city point.

    The defaults describe Ho Chi Minh City; set `city_profile` in config.yaml for other cities.
    """

    aliases: list[str] = Field(
        default_factory=lambda: [
            "Hồ Chí Minh",
            "Ho Chi Minh City",
            "Sài Gòn",
            "Saigon",
            "HCM",
            "HCMC",
            "TPHCM",
            "TP HCM",
        ]
    )
    best_months: str = f"Dec{EN_DASH}Apr"
    best_months_note: str = "dry season"
    viewpoints: list[str] = Field(default_factory=lambda: ["Landmark 81", "Bitexco"])
    center_landmark: str = "Chợ Bến Thành"
    center_landmark_en: str = "Ben Thanh Market"


DEFAULT_MONTHLY_CAPS: dict[str, int] = {
    "text_search_pro": 5000,
    "place_details_pro": 5000,
    "place_details_enterprise": 1000,
    "nearby_search_enterprise": 1000,
    "place_details_essentials": 10000,
    "place_photos": 1000,
}
DEFAULT_DAILY_CAPS: dict[str, int] = {}


class QuotaConfig(BaseModel):
    """Local call caps per sku: Google Places free calls per month; optional per-day caps.

    Skus left out of config.yaml keep these defaults; skus with no cap at all are unlimited.
    """

    safety_margin: float = Field(default=0.9, gt=0, le=1)
    monthly: dict[str, NonNegativeInt] = Field(default_factory=lambda: dict(DEFAULT_MONTHLY_CAPS))
    daily: dict[str, NonNegativeInt] = Field(default_factory=lambda: dict(DEFAULT_DAILY_CAPS))

    @field_validator("monthly", mode="before")
    @classmethod
    def _monthly_defaults(cls, value: Any) -> Any:
        return _with_defaults(DEFAULT_MONTHLY_CAPS, value)

    @field_validator("daily", mode="before")
    @classmethod
    def _daily_defaults(cls, value: Any) -> Any:
        return _with_defaults(DEFAULT_DAILY_CAPS, value)


def _with_defaults(defaults: Mapping[Any, Any], value: Any) -> Any:
    if value is None:
        return dict(defaults)
    if isinstance(value, dict):
        return {**defaults, **value}
    return value


BasemapId = Literal["google", "openfreemap", "esri_streets", "esri_satellite", "osm"]
DEFAULT_BASEMAPS: tuple[BasemapId, ...] = (
    "google",
    "openfreemap",
    "esri_streets",
    "esri_satellite",
)


class ExportConfig(BaseModel):
    google_map: bool = False
    """Offer a Google Maps basemap in map.html. Embeds GOOGLE_MAPS_BROWSER_KEY in the file (never
    GOOGLE_MAPS_KEY); restrict it to your site's referrers and the Maps JavaScript API."""
    basemaps: list[BasemapId] = Field(default_factory=lambda: list(DEFAULT_BASEMAPS), min_length=1)
    """Basemaps offered in map.html, in this order. "google" counts only with `google_map` and a
    key and is then the default view; otherwise OpenFreeMap is, then Esri Streets (or the first
    basemap listed)."""
    max_frames_per_place: int = Field(default=4, ge=0)
    """Video frames cited as evidence copied to output/media per place, menu-looking first."""
    google_photos: bool = False
    """Download Google Maps place photos into output/media (paid skus place_details_essentials
    and place_photos, both capped under `quota`). Needs GOOGLE_MAPS_KEY."""
    max_photos_per_place: int = Field(default=1, ge=0)
    site_url: str = ""
    """Public address of the deployed output/app (e.g. https://trip.example.app). Link previews
    (Zalo, Messenger, Facebook, X, Slack) need it for og:url, the canonical link and an absolute
    og:image; empty leaves those out."""

    @field_validator("site_url")
    @classmethod
    def _site_url(cls, value: str) -> str:
        url = value.strip().rstrip("/")
        if url and not url.startswith(("https://", "http://")):
            raise ValueError("export.site_url must start with https:// (or http://)")
        return url


DEFAULT_ROAD_PROFILES: dict[TravelMode, str] = {
    "motorbike": "routed-car",
    "car": "routed-car",
    "walking": "routed-foot",
}


class RoadsConfig(BaseModel):
    """Road geometry of the map's day routes from an OSRM server, fetched by the export step
    (and by the web app for legs of plans edited in the browser).

    `profiles` is the path segment before `/route/v1/` per travel mode (the FOSSGIS server at
    routing.openstreetmap.de serves routed-car, routed-bike and routed-foot); modes left out of
    config.yaml keep these defaults.
    """

    enabled: bool = True
    endpoint: str = "https://routing.openstreetmap.de"
    profiles: dict[TravelMode, str] = Field(default_factory=lambda: dict(DEFAULT_ROAD_PROFILES))

    @field_validator("profiles", mode="before")
    @classmethod
    def _profile_defaults(cls, value: Any) -> Any:
        return _with_defaults(DEFAULT_ROAD_PROFILES, value)


class AppConfig(BaseModel):
    city: str
    country_code: str = "VN"
    city_profile: CityProfile = Field(default_factory=CityProfile)
    center: CenterConfig = Field(default_factory=CenterConfig)
    spatial: SpatialConfig = Field(default_factory=SpatialConfig)
    travel: TravelConfig = Field(default_factory=TravelConfig)
    trip: TripConfig = Field(default_factory=TripConfig)
    resolve: ResolveConfig = Field(default_factory=ResolveConfig)
    nearby: NearbyConfig = Field(default_factory=NearbyConfig)
    extract: ExtractConfig = Field(default_factory=ExtractConfig)
    media: MediaConfig = Field(default_factory=MediaConfig)
    fetch: FetchConfig = Field(default_factory=FetchConfig)
    quota: QuotaConfig = Field(default_factory=QuotaConfig)
    plan: PlanConfig = Field(default_factory=PlanConfig)
    export: ExportConfig = Field(default_factory=ExportConfig)
    roads: RoadsConfig = Field(default_factory=RoadsConfig)

    @classmethod
    def load(cls, path: Path) -> AppConfig:
        with path.open(encoding="utf-8") as handle:
            return cls.model_validate(yaml.safe_load(handle) or {})


class Secrets(BaseModel):
    """API keys from .env and the environment.

    `google_maps_browser_key` is the only key ever embedded in map.html / output/app: restrict it
    in Google Cloud to HTTP referrers of your site and to the Maps JavaScript API.
    `google_maps_key` is the server key for Places and is never written to output.
    """

    google_maps_key: str | None = None
    google_maps_browser_key: str | None = None

    @classmethod
    def load(cls, env_file: Path) -> Secrets:
        values: dict[str, str | None] = {}
        if env_file.exists():
            values.update(dotenv_values(env_file))
        values.update({k: v for k, v in os.environ.items() if k in _ENV_KEYS})
        return cls(
            google_maps_key=values.get("GOOGLE_MAPS_KEY") or None,
            google_maps_browser_key=values.get("GOOGLE_MAPS_BROWSER_KEY") or None,
        )

    def require(self, name: Literal["google_maps_key", "google_maps_browser_key"]) -> str:
        value = getattr(self, name)
        if not value:
            raise MissingSecretError(name)
        return str(value)


_ENV_KEYS = {"GOOGLE_MAPS_KEY", "GOOGLE_MAPS_BROWSER_KEY"}


class MissingSecretError(UserFacingError):
    def __init__(self, name: str) -> None:
        super().__init__(f"{name.upper()} is not set. Add it to .env (see .env.example).")
