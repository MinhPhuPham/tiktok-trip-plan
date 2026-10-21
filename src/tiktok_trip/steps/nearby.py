"""Step 7: famous spots around each zone, used as optional stops when routing."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass

import httpx

from tiktok_trip import geo
from tiktok_trip.clients.google_nearby import GoogleNearbyClient, GooglePlaceHit
from tiktok_trip.clients.overpass import OverpassClient, OverpassElement, OverpassUnavailableError
from tiktok_trip.context import Context
from tiktok_trip.matching import fold
from tiktok_trip.models import NearbySpot, Place, SpatialResult, Zone
from tiktok_trip.storage import load_model, load_models, save_models

log = logging.getLogger(__name__)

RankKey = tuple[float, ...]
MIN_NAME_LENGTH = 3
_NON_ALNUM = re.compile(r"[^0-9a-z]+")


@dataclass(frozen=True)
class Found:
    """One search hit for one zone, with a provider-specific rank (lower is better)."""

    spot: NearbySpot
    rank: RankKey


def overpass_found(element: OverpassElement, zone: Zone) -> Found:
    spot = NearbySpot(
        id=element.ref,
        name=element.name,
        kind=element.kind,
        lat=element.lat,
        lng=element.lng,
        zone_id=zone.id,
        source="overpass",
    )
    rank = (
        0.0 if element.is_notable else 1.0,
        float(element.family_rank),
        geo.distance_km((zone.lat, zone.lng), (element.lat, element.lng)),
    )
    return Found(spot, rank)


def google_found(hit: GooglePlaceHit, zone: Zone) -> Found:
    spot = NearbySpot(
        id=hit.ref,
        name=hit.name,
        kind="tourist_attraction",
        lat=hit.lat,
        lng=hit.lng,
        zone_id=zone.id,
        source="google",
        rating=hit.rating,
        rating_count=hit.rating_count,
    )
    return Found(spot, (-float(hit.rating_count or 0), -(hit.rating or 0.0)))


def _name_key(text: str) -> str:
    return _NON_ALNUM.sub("", fold(text))


def is_listable_name(name: str, city_names: Iterable[str]) -> bool:
    """False for names that are only the city (e.g. an OSM sign called "Đà Lạt"), shorter than
    three characters, or a bare coordinate."""
    stripped = name.strip()
    if len(stripped) < MIN_NAME_LENGTH or geo.parse_latlng(stripped) is not None:
        return False
    key = _name_key(stripped)
    return bool(key) and key not in {_name_key(city) for city in city_names}


def select_spots(
    found: Iterable[Found], zones: Sequence[Zone], top_n: int, exclude_ids: set[str]
) -> list[NearbySpot]:
    """Dedupe by id (nearest zone wins), then keep the best `top_n` per zone."""
    centroid = {zone.id: (zone.lat, zone.lng) for zone in zones}
    best: dict[str, Found] = {}
    for item in found:
        if item.spot.id in exclude_ids:
            continue
        point = (item.spot.lat, item.spot.lng)
        current = best.get(item.spot.id)
        if current is None or geo.distance_km(point, centroid[item.spot.zone_id]) < geo.distance_km(
            point, centroid[current.spot.zone_id]
        ):
            best[item.spot.id] = item
    per_zone: dict[str, list[Found]] = {zone.id: [] for zone in zones}
    for item in best.values():
        per_zone[item.spot.zone_id].append(item)
    spots: list[NearbySpot] = []
    for zone in zones:
        ranked = sorted(per_zone[zone.id], key=lambda f: (f.rank, f.spot.id))
        spots.extend(f.spot for f in ranked[:top_n])
    return spots


def _searcher(ctx: Context) -> Callable[[Zone], list[Found]]:
    radius = ctx.config.nearby.radius_km
    if ctx.config.nearby.provider == "google":
        if ctx.secrets.google_maps_key:
            google = GoogleNearbyClient(ctx)
            return lambda zone: [
                google_found(hit, zone)
                for hit in google.search(zone.lat, zone.lng, radius, note=zone.id)
            ]
        log.warning("nearby.provider is google but GOOGLE_MAPS_KEY is missing; using Overpass.")
    overpass = OverpassClient(ctx)
    return lambda zone: [
        overpass_found(element, zone)
        for element in overpass.around(zone.lat, zone.lng, radius, note=zone.id)
        if element.is_sight
    ]


def search_zones(
    zones: Sequence[Zone], search: Callable[[Zone], list[Found]]
) -> tuple[list[Found], list[str]]:
    """Search every zone; a zone whose search fails is skipped and its id returned as failed.

    Quota errors are not provider failures and propagate.
    """
    found: list[Found] = []
    failed: list[str] = []
    for zone in zones:
        try:
            found.extend(search(zone))
        except (OverpassUnavailableError, httpx.HTTPError) as exc:
            log.warning(
                "Nearby search failed for zone %s; no nearby spots for it: %s", zone.id, exc
            )
            failed.append(zone.id)
    return found, failed


def run(ctx: Context) -> None:
    if not ctx.paths.spatial_file.exists():
        raise RuntimeError(f"{ctx.paths.spatial_file} is missing. Run the spatial step first.")
    spatial = load_model(ctx.paths.spatial_file, SpatialResult)
    place_ids = {p.id for p in load_models(ctx.paths.places_file, Place)}
    found, failed = search_zones(spatial.zones, _searcher(ctx))
    city_names = [ctx.config.city, *ctx.config.city_profile.aliases]
    listable = [f for f in found if is_listable_name(f.spot.name, city_names)]
    if dropped := sorted({f.spot.name for f in found} - {f.spot.name for f in listable}):
        log.info(
            "Nearby: dropped %d spots named after the city, too short or a coordinate: %s",
            len(dropped),
            dropped,
        )
    found = listable
    spots = select_spots(found, spatial.zones, ctx.config.nearby.top_n, place_ids)
    save_models(ctx.paths.nearby_file, spots)
    with_spots = len({spot.zone_id for spot in spots})
    log.log(
        logging.WARNING if failed else logging.INFO,
        "%d nearby spots → %s. %d zones, %d with nearby spots, %d failed%s",
        len(spots),
        ctx.paths.nearby_file,
        len(spatial.zones),
        with_spots,
        len(failed),
        f" ({', '.join(failed)}; re-run `tiktok-trip nearby` later)" if failed else "",
    )
