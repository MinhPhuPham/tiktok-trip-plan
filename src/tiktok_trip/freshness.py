"""Detects places.json that resolve rewrote after the last enrich run."""

from __future__ import annotations

import logging
from collections.abc import Sequence

from tiktok_trip.models import Place
from tiktok_trip.paths import Paths
from tiktok_trip.storage import read_json, write_json

log = logging.getLogger(__name__)


def mark_enriched(paths: Paths, places: Sequence[Place]) -> None:
    write_json(paths.enriched_file, sorted(place.id for place in places))


def not_enriched(paths: Paths, places: Sequence[Place]) -> list[Place]:
    """Places that were never seen by enrich (all of them when enrich has not run)."""
    if not places:
        return []
    known = set(read_json(paths.enriched_file)) if paths.enriched_file.exists() else set()
    return [place for place in places if place.id not in known]


def warn_if_not_enriched(paths: Paths, places: Sequence[Place], step: str) -> None:
    if missing := not_enriched(paths, places):
        log.warning(
            "%s: %d of %d places were not enriched since the last resolve, so tags, hours, "
            "prices and best times may be missing. Run `uv run tiktok-trip enrich` "
            "(or `run --from enrich`) first.",
            step,
            len(missing),
            len(places),
        )
