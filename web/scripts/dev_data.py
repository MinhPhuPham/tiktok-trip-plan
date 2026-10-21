"""Write web/.dev-data/trip.json from data/ for `npm run dev`, without any network request.

Roads come from the OSRM cache only; media from output/media/index.json (served by the dev server).
"""

from __future__ import annotations

import logging
from pathlib import Path

from tiktok_trip.clients.osrm import OsrmClient
from tiktok_trip.context import Context
from tiktok_trip.export import load_export_data, load_travel, safe_preferences
from tiktok_trip.export.map_data import MapExtras, build_map_data
from tiktok_trip.export.media import media_index
from tiktok_trip.export.roads import road_legs

logger = logging.getLogger("dev_data")
TARGET = Path(__file__).resolve().parents[1] / ".dev-data" / "trip.json"


def cached_roads(ctx: Context) -> dict[str, str]:
    itinerary = load_export_data(ctx).itinerary
    if itinerary is None or not ctx.config.roads.enabled:
        return {}
    client = OsrmClient(ctx)
    try:
        roads: dict[str, str] = {}
        for leg in road_legs(itinerary.days):
            route = client.route(leg.start, leg.end, note=leg.key, cache_only=True)
            if route is not None:
                roads[leg.key] = route.polyline
        return roads
    finally:
        client.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ctx = Context.load()
    extras = MapExtras(
        media=media_index(ctx),
        travel=load_travel(ctx.paths),
        preferences=safe_preferences(ctx.paths),
        roads=cached_roads(ctx),
    )
    data = build_map_data(load_export_data(ctx), extras=extras)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(data.model_dump_json(by_alias=True), encoding="utf-8")
    logger.info("Wrote %s (%d places, %d days)", TARGET, len(data.places), len(data.days))


if __name__ == "__main__":
    main()
