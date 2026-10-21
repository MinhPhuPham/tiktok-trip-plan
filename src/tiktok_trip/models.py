from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal
from urllib.parse import quote_plus

from pydantic import BaseModel, Field, computed_field, field_validator, model_validator

from tiktok_trip.geo import coord_maps_url


class Category(StrEnum):
    FOOD = "food"
    CAFE = "cafe"
    ATTRACTION = "attraction"
    OTHER = "other"


class EvidenceSource(StrEnum):
    CAPTION = "caption"
    COMMENT = "comment"
    TRANSCRIPT = "transcript"
    FRAME = "frame"
    POI = "poi"
    MANUAL = "manual"
    """The user's own list (input/places.yaml)."""


class Evidence(BaseModel):
    source: EvidenceSource
    quote: str = Field(min_length=1)
    timestamp: str | None = None


Recommendation = Literal["strong", "normal", "none"]
"""How strongly one post recommends a place: singled out, praised among others, or only listed."""

Priority = Literal["must", "high", "medium", "low"]
""""must" comes only from input/preferences.yaml `must_go`; the rest from recommendations."""


class Candidate(BaseModel):
    """A place mentioned in one video, before geocoding."""

    video_id: str
    video_url: str
    name: str = Field(min_length=1)
    category: Category = Category.OTHER
    address_as_mentioned: str | None = None
    landmarks: list[str] = Field(default_factory=list)
    must_try: list[str] = Field(default_factory=list)
    notes: str | None = None
    evidence: list[Evidence] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    recommendation: Recommendation | None = None
    """None = not assessed (extracted before the field existed)."""
    recommendation_quote: str | None = None
    recommendation_source: EvidenceSource | None = None

    @field_validator("recommendation_source", mode="before")
    @classmethod
    def _unknown_source_is_none(cls, value: object) -> object:
        known = {s.value for s in EvidenceSource}
        return (
            value if value is None or isinstance(value, EvidenceSource) or value in known else None
        )

    @model_validator(mode="after")
    def _drop_unsupported_claims(self) -> Candidate:
        if self.address_as_mentioned and not self.evidence:
            self.address_as_mentioned = None
        if (
            self.recommendation in ("strong", "normal")
            and not (self.recommendation_quote or "").strip()
        ):
            self.recommendation = "none"
        if self.recommendation in (None, "none"):
            self.recommendation_quote = None
            self.recommendation_source = None
        return self

    @property
    def key(self) -> str:
        return f"{self.video_id}:{self.name}"


class OpeningPeriod(BaseModel):
    day: int = Field(ge=0, le=6, description="0=Monday ... 6=Sunday")
    open: str = Field(pattern=r"^\d{2}:\d{2}$")
    close: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")


class Hours(BaseModel):
    periods: list[OpeningPeriod] = Field(default_factory=list)
    weekday_text: list[str] = Field(default_factory=list)
    source: Literal["google", "comments"] = "google"


class PriceRange(BaseModel):
    value: str
    source: Literal["google", "comments", "notes", "caption"]
    """"caption" is legacy: notes-derived prices were once labelled so; enrich relabels them."""


BestTimeSource = Literal["comments", "caption", "transcript", "hours", "heuristic"]


class BestTime(BaseModel):
    hours: str | None = None
    days: str | None = None
    months: str | None = None
    deadline: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    source: BestTimeSource
    evidence: str | None = None
    inputs_hash: str | None = Field(
        default=None, description="fingerprint of the facts it was computed from; None = manual"
    )
    why: str | None = None
    """Short human reason in English ("breakfast place, early morning, opens 06:30")."""
    why_vi: str | None = None
    """The same reason in Vietnamese."""


class Spatial(BaseModel):
    bearing_deg: float = Field(ge=0, lt=360)
    sector: str
    distance_km: float = Field(ge=0)
    ring: str
    zone: str | None = None


PlaceStatus = Literal["todo", "visited", "skip"]
Preference = Literal["must_go", "removed"]


class Place(BaseModel):
    """One verified place. Every enriched field carries its source."""

    id: str
    name: str
    category: Category = Category.OTHER
    address: str
    address_as_mentioned: str | None = None
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    business_status: str = "OPERATIONAL"
    hours: Hours | None = None
    price_range: PriceRange | None = None
    rating: float | None = None
    rating_count: int | None = None
    best_time: BestTime | None = None
    tags: list[str] = Field(default_factory=list)
    """What the place is good for (tags.TAGS ids, vocabulary order); recomputed by enrich."""
    must_try: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    videos: list[str] = Field(default_factory=list)
    candidate_keys: list[str] = Field(default_factory=list)
    """Keys (video_id:name) of the candidates resolved into this place."""
    evidence: list[Evidence] = Field(default_factory=list)
    spatial: Spatial | None = None
    confidence: float = Field(ge=0, le=1)
    status: PlaceStatus = "todo"
    priority: Priority | None = None
    """must (preferences) or high / medium / low from the recommendations (see priority.py)."""
    priority_reason: str | None = None
    preference: Preference | None = None
    """Set by resolve from input/preferences.yaml; "removed" places have status "skip"."""

    @computed_field  # type: ignore[prop-decorator]
    @property
    def mention_count(self) -> int:
        return len(self.videos)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def maps_url(self) -> str:
        url = f"https://www.google.com/maps/search/?api=1&query={quote_plus(self.name)}"
        if self.id.startswith("gp:"):
            url += f"&query_place_id={self.id.removeprefix('gp:')}"
        return url


class ReviewOption(BaseModel):
    place_id: str
    name: str
    address: str
    lat: float
    lng: float
    distance_km: float | None = None
    name_score: float | None = None


ReviewReason = Literal[
    "ambiguous_branch", "low_name_score", "outside_city", "not_found", "closed", "low_confidence"
]


class ReviewRow(BaseModel):
    candidate: Candidate
    reason: ReviewReason
    options: list[ReviewOption] = Field(default_factory=list)
    decision: str | None = Field(default=None, description="chosen place_id, or 'skip'")

    @property
    def key(self) -> str:
        return self.candidate.key


class ExcludedCandidate(BaseModel):
    """A candidate resolve left out on purpose (exclude keyword), kept for the audit trail."""

    key: str
    name: str
    reason: str


CenterSource = Literal["hotel", "override", "city_default"]


class Center(BaseModel):
    lat: float
    lng: float
    source: CenterSource
    label: str
    label_en: str | None = None
    place_id: str | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def maps_url(self) -> str:
        url = f"https://www.google.com/maps/search/?api=1&query={self.lat},{self.lng}"
        if self.place_id:
            url = (
                f"https://www.google.com/maps/search/?api=1&query={quote_plus(self.label)}"
                f"&query_place_id={self.place_id}"
            )
        return url


class Zone(BaseModel):
    id: str
    sector: str
    lat: float
    lng: float
    place_ids: list[str] = Field(default_factory=list)


class SpatialResult(BaseModel):
    center: Center
    sectors: int
    zones: list[Zone] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class NearbySpot(BaseModel):
    id: str
    name: str
    kind: str
    lat: float
    lng: float
    zone_id: str
    source: Literal["overpass", "google"]
    rating: float | None = None
    rating_count: int | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def maps_url(self) -> str:
        return coord_maps_url(self.lat, self.lng)


StopKind = Literal["start", "place", "nearby", "rest", "end"]


class RouteStop(BaseModel):
    kind: StopKind
    ref_id: str | None = None
    name: str
    lat: float
    lng: float
    arrive: str = Field(pattern=r"^\d{2}:\d{2}$")
    depart: str = Field(pattern=r"^\d{2}:\d{2}$")
    travel_min_to_next: int | None = None
    slot: str | None = None
    """Rhythm slot id (config `plan.rhythm`) in agent plans; None from the solver."""
    reason: str | None = None
    reason_vi: str | None = None
    """`reason` in Vietnamese (agent plans); exports fall back to `reason`."""


class DayPlan(BaseModel):
    day: int = Field(ge=1)
    zone_ids: list[str] = Field(default_factory=list)
    stops: list[RouteStop] = Field(default_factory=list)
    total_minutes: int = 0
    maps_urls: list[str] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)


class UnplacedPlace(BaseModel):
    ref_id: str
    reason: str = ""
    code: str | None = None
    """planning.schema.UnplacedCode (agent plans); None from the solver and older plans."""


class Itinerary(BaseModel):
    days: list[DayPlan] = Field(default_factory=list)
    travel_mode: str
    grouping: str = "nearest"
    """sector or nearest (solver), agent (planned by Claude Code)."""
    unplaced: list[UnplacedPlace] = Field(default_factory=list)
    needed_days: int | None = None
    """Days the places would need when they do not fit trip.days; None when they fit."""
    generated_at: datetime = Field(default_factory=datetime.now)


MediaKind = Literal["frame", "photo"]


class MediaAttribution(BaseModel):
    """A photo author Google requires to be shown with the photo (display name, profile link)."""

    name: str
    uri: str | None = None


class MediaItem(BaseModel):
    """One preview image of a place in output/media/index.json; `src` is relative to output/."""

    src: str
    kind: MediaKind
    caption: str
    source_url: str | None = None
    attributions: list[MediaAttribution] = Field(default_factory=list)


class ApiCall(BaseModel):
    """One row of data/api_log.csv. `sku` is the billing unit a quota cap counts."""

    timestamp: datetime
    service: str
    sku: str
    endpoint: str
    units: int = 0
    cache_hit: bool = False
    note: str = ""
