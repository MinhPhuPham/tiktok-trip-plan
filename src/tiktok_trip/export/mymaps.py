"""Google My Maps import files: one CSV per sector, each becomes a layer."""

from __future__ import annotations

import logging
from collections.abc import Sequence
from pathlib import Path

from tiktok_trip.export.dataset import (
    ExportData,
    best_time_summary,
    first_video,
    ordered_sectors,
    places_by_sector,
    price_text,
    sort_places,
)
from tiktok_trip.models import Place
from tiktok_trip.storage import write_csv

logger = logging.getLogger(__name__)

HEADER = (
    "Name",
    "Latitude",
    "Longitude",
    "Category",
    "Zone",
    "Address",
    "Best time",
    "Price",
    "Rating",
    "Video",
    "Maps link",
    "Notes",
)
MAX_ROWS_PER_FILE = 2000
MAX_LAYERS = 10
FILE_PREFIX = "mymaps_"


def notes_text(place: Place) -> str:
    parts = list(place.notes)
    if place.must_try:
        parts.insert(0, "Must try: " + ", ".join(place.must_try))
    return "; ".join(parts)


def place_row(place: Place) -> list[object]:
    return [
        place.name,
        place.lat,
        place.lng,
        place.category.value,
        (place.spatial.zone if place.spatial else None) or "",
        place.address,
        best_time_summary(place.best_time),
        price_text(place),
        place.rating if place.rating is not None else "",
        first_video(place),
        place.maps_url,
        notes_text(place),
    ]


def sector_rows(places: Sequence[Place]) -> list[list[object]]:
    return [place_row(place) for place in places]


def write_mymaps(data: ExportData, output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    for stale in output_dir.glob(f"{FILE_PREFIX}*.csv"):
        stale.unlink()
    grouped = places_by_sector(data.places)
    sectors = ordered_sectors(data.places, data.sector_count)
    if len(sectors) > MAX_LAYERS:
        logger.warning(
            "%d layers exceed the My Maps limit of %d per map; merge some files.",
            len(sectors),
            MAX_LAYERS,
        )
    written: list[Path] = []
    for sector in sectors:
        members = sort_places(grouped[sector], data.itinerary)
        if len(members) > MAX_ROWS_PER_FILE:
            logger.warning(
                "%s has %d rows; My Maps accepts at most %d per file.",
                sector,
                len(members),
                MAX_ROWS_PER_FILE,
            )
        path = output_dir / f"{FILE_PREFIX}{sector}.csv"
        write_csv(path, HEADER, sector_rows(members))
        written.append(path)
        logger.info("Wrote %s (%d rows)", path, len(members))
    return written
