"""Everything the exporters share: the loaded dataset and pure formatting helpers."""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime

from tiktok_trip.config import AppConfig
from tiktok_trip.export.palette import UNASSIGNED
from tiktok_trip.geo import sector_names
from tiktok_trip.models import (
    BestTime,
    Itinerary,
    NearbySpot,
    Place,
    SpatialResult,
)
from tiktok_trip.priority import STARS, rank

HEURISTIC_SUFFIX = " (heuristic)"
NOTE_CHARS = 90
ELLIPSIS = "\u2026"
SENTENCE_END = re.compile(r"(?<=[.!?])\s+|\n")

RoutePosition = tuple[int, int]


@dataclass
class ExportData:
    config: AppConfig
    places: list[Place]
    spatial: SpatialResult | None = None
    nearby: list[NearbySpot] = field(default_factory=list)
    itinerary: Itinerary | None = None
    pending_review: int = 0
    generated_at: datetime = field(default_factory=datetime.now)

    @property
    def sector_count(self) -> int:
        return self.spatial.sectors if self.spatial else self.config.spatial.sectors

    @property
    def sector_names(self) -> tuple[str, ...]:
        return sector_names(self.sector_count)


def sector_of(place: Place) -> str:
    return place.spatial.sector if place.spatial else UNASSIGNED


def places_by_sector(places: Sequence[Place]) -> dict[str, list[Place]]:
    groups: dict[str, list[Place]] = defaultdict(list)
    for place in places:
        groups[sector_of(place)].append(place)
    return dict(groups)


def ordered_sectors(places: Sequence[Place], count: int) -> list[str]:
    """Sectors that have places: compass order first, then anything unexpected, then unassigned."""
    present = set(places_by_sector(places))
    canonical = [name for name in sector_names(count) if name in present]
    extra = sorted(present - set(canonical) - {UNASSIGNED})
    return canonical + extra + ([UNASSIGNED] if UNASSIGNED in present else [])


def popularity_key(place: Place) -> tuple[int, float, str]:
    return (-place.mention_count, -(place.rating if place.rating is not None else -1.0), place.name)


def top_places(places: Sequence[Place], limit: int = 3) -> list[Place]:
    return sorted(places, key=popularity_key)[:limit]


def route_positions(itinerary: Itinerary | None) -> dict[str, RoutePosition]:
    positions: dict[str, RoutePosition] = {}
    if itinerary is None:
        return positions
    for day in itinerary.days:
        for index, stop in enumerate(day.stops):
            if stop.kind == "place" and stop.ref_id and stop.ref_id not in positions:
                positions[stop.ref_id] = (day.day, index)
    return positions


def sort_places(places: Sequence[Place], itinerary: Itinerary | None) -> list[Place]:
    """Zone first; inside a zone routed places in route order, then the rest by distance."""
    positions = route_positions(itinerary)

    def key(place: Place) -> tuple[str, int, tuple[int, int], float, str]:
        zone = (place.spatial.zone if place.spatial else None) or "~"
        distance = place.spatial.distance_km if place.spatial else float("inf")
        position = positions.get(place.id)
        return (
            zone,
            0 if position else 1,
            position or (0, 0),
            distance,
            place.name,
        )

    return sorted(places, key=key)


def by_priority(places: Sequence[Place]) -> list[Place]:
    """Must, high, medium, low, unknown; more mentions first; otherwise the order is kept."""
    return sorted(places, key=lambda place: (rank(place.priority), -place.mention_count))


def starred_name(place: Place) -> str:
    """'★★★★' must, '★★★ Phở Hòa' high, '★★' medium, '★' low; the bare name when unknown."""
    stars = STARS[place.priority]
    return f"{stars} {place.name}" if stars else place.name


def video_links(place: Place) -> list[str]:
    """The place's TikTok links; sources that are not web links (input/places.yaml) are left out."""
    return [url for url in place.videos if url.startswith(("http://", "https://"))]


def unique_videos(places: Sequence[Place]) -> list[str]:
    seen: dict[str, None] = {}
    for place in places:
        for url in video_links(place):
            seen.setdefault(url)
    return list(seen)


def is_heuristic(best_time: BestTime | None) -> bool:
    return best_time is not None and best_time.source == "heuristic"


def best_time_cells(best_time: BestTime | None) -> tuple[str, str, str]:
    """Best hour, day, month as display strings; heuristic values carry a visible suffix."""
    if best_time is None:
        return "", "", ""
    suffix = HEURISTIC_SUFFIX if is_heuristic(best_time) else ""

    def cell(value: str | None) -> str:
        return f"{value}{suffix}" if value else ""

    return cell(best_time.hours), cell(best_time.days), cell(best_time.months)


def best_time_summary(best_time: BestTime | None) -> str:
    if best_time is None:
        return ""
    parts = [value for value in (best_time.hours, best_time.days, best_time.months) if value]
    if best_time.deadline:
        parts.append(f"sells out ~{best_time.deadline}")
    if not parts:
        return ""
    label = " | ".join(parts)
    source = f"source: {best_time.source}"
    return f"{label} ({source}, heuristic)" if is_heuristic(best_time) else f"{label} ({source})"


def hours_lines(place: Place, limit: int | None = None) -> list[str]:
    lines = place.hours.weekday_text if place.hours else []
    return list(lines[:limit]) if limit else list(lines)


def price_text(place: Place) -> str:
    return place.price_range.value if place.price_range else ""


def first_video(place: Place) -> str:
    links = video_links(place)
    return links[0] if links else ""


def ring_label(radius_km: float) -> str:
    return f"{radius_km:g} km"


def truncate(text: str, limit: int) -> str:
    """`text` cut to at most `limit` characters at a word boundary, ending with an ellipsis."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    if " " in cut and not text[limit - 1].isspace():
        cut = cut.rsplit(" ", 1)[0]
    return cut.rstrip(" ,;:") + ELLIPSIS


def first_sentence(notes: Sequence[str], limit: int = NOTE_CHARS) -> str:
    """First sentence of the first non-empty note, cut at `limit` characters with an ellipsis."""
    text = next((note.strip() for note in notes if note.strip()), "")
    return truncate(SENTENCE_END.split(text, maxsplit=1)[0], limit)
