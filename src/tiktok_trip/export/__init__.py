"""Export step: preview images, map.html, My Maps CSVs and one trip workbook per language."""

from __future__ import annotations

import logging
import shutil

from tiktok_trip.context import Context
from tiktok_trip.errors import UserFacingError
from tiktok_trip.export.dataset import ExportData
from tiktok_trip.export.excel import write_trip
from tiktok_trip.export.i18n import LANGUAGES
from tiktok_trip.export.map_data import MapExtras
from tiktok_trip.export.map_html import google_map_key, write_app, write_map
from tiktok_trip.export.media import build_media
from tiktok_trip.export.mymaps import write_mymaps
from tiktok_trip.export.roads import fetch_roads
from tiktok_trip.export.secrets_guard import assert_no_server_key
from tiktok_trip.models import (
    Itinerary,
    NearbySpot,
    Place,
    ReviewRow,
    SpatialResult,
)
from tiktok_trip.paths import Paths
from tiktok_trip.planning.matrix import TravelMatrix
from tiktok_trip.preferences import Preferences, load_preferences
from tiktok_trip.storage import load_model, load_models

logger = logging.getLogger(__name__)

__all__ = ["ExportData", "load_export_data", "remove_stale_outputs", "run"]


def load_export_data(ctx: Context) -> ExportData:
    paths = ctx.paths
    return ExportData(
        config=ctx.config,
        places=[p for p in load_models(paths.places_file, Place) if p.status != "skip"],
        spatial=load_model(paths.spatial_file, SpatialResult)
        if paths.spatial_file.exists()
        else None,
        nearby=load_models(paths.nearby_file, NearbySpot),
        itinerary=load_model(paths.routes_file, Itinerary) if paths.routes_file.exists() else None,
        pending_review=sum(
            1 for row in load_models(paths.review_file, ReviewRow) if row.decision is None
        ),
    )


def load_travel(paths: Paths) -> TravelMatrix | None:
    """data/plan/travel_minutes.csv for the map's plan editor; None when absent or unreadable."""
    if not paths.plan_matrix.exists():
        return None
    try:
        return TravelMatrix.from_csv(paths.plan_matrix.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.warning(
            "%s is unreadable (%s); map.html gets no travel matrix.", paths.plan_matrix, exc
        )
        return None


def safe_preferences(paths: Paths) -> Preferences:
    try:
        return load_preferences(paths.preferences_file)
    except UserFacingError as exc:
        logger.warning("%s; the map's preferences export starts empty.", exc)
        return Preferences()


def remove_stale_outputs(paths: Paths) -> None:
    for stale in paths.stale_outputs:
        if stale.exists():
            stale.unlink()
            logger.info("Removed stale %s", stale)


def run(ctx: Context) -> None:
    data = load_export_data(ctx)
    if not data.places:
        logger.warning("No places in %s; run the resolve step first.", ctx.paths.places_file)
        return
    if data.spatial is None:
        logger.warning("spatial.json missing: exporting without center, rays or sectors.")
    paths = ctx.paths
    paths.output.mkdir(parents=True, exist_ok=True)
    remove_stale_outputs(paths)
    media = build_media(ctx)

    extras = MapExtras(
        media=media.index,
        travel=load_travel(paths),
        preferences=safe_preferences(paths),
        roads=fetch_roads(ctx, data.itinerary),
    )
    google_key = google_map_key(ctx)
    write_map(data, paths.map_html, google_key=google_key, extras=extras)
    write_app(
        data,
        paths.app_dir,
        paths.media_dir,
        google_key=google_key,
        extras=extras,
        site_url=ctx.config.export.site_url,
    )
    write_mymaps(data, paths.mymaps_dir)
    for labels in LANGUAGES:
        write_trip(data, labels, paths.trip_xlsx(labels.code))

    for source in (paths.places_file, paths.review_csv):
        if source.exists():
            shutil.copyfile(source, paths.output / source.name)
    assert_no_server_key(ctx, paths.output)
    logger.info("Export complete: %s", paths.output)
