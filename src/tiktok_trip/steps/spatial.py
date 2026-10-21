"""Step 6: pick the center, then give every place a bearing, sector, ring and zone."""

from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Callable, Sequence
from typing import Any, Protocol

from tiktok_trip import geo, matching
from tiktok_trip.config import AppConfig, SpatialConfig
from tiktok_trip.context import Context
from tiktok_trip.errors import UserFacingError
from tiktok_trip.models import Center, CenterSource, Place, Spatial, SpatialResult, Zone
from tiktok_trip.storage import read_json, save_model, write_json

log = logging.getLogger(__name__)


LANDMARK_MAX_KM = 5.0
"""A center landmark farther than this from the geocoder's city point is a wrong match."""
CENTER_MAX_KM = 30.0
"""A hotel/override answer farther than this from the city point is a wrong match."""
CENTER_MIN_NAME_SCORE = 70.0


class GeocodedPoint(Protocol):
    @property
    def lat(self) -> float: ...

    @property
    def lng(self) -> float: ...

    @property
    def display_name(self) -> str: ...

    @property
    def source(self) -> str: ...

    @property
    def google_id(self) -> str | None: ...


class Geocoder(Protocol):
    def geocode(self, query: str) -> GeocodedPoint | None: ...

    def city_point(self, city: str) -> GeocodedPoint | None: ...

    def find(
        self,
        query: str,
        accept: Callable[[GeocodedPoint], bool],
        *,
        near: tuple[float, float] | None = None,
    ) -> GeocodedPoint | None: ...

    def google_first(self) -> Geocoder: ...


class CenterNotFoundError(UserFacingError):
    pass


def _city_point(config: AppConfig, client: Geocoder) -> GeocodedPoint | None:
    return client.city_point(config.city) or client.geocode(config.city)


def _locate(
    text: str, field: CenterSource, config: AppConfig, geocoder: Callable[[], Geocoder]
) -> tuple[float, float, str | None]:
    """(lat, lng, Google place id) for a "lat,lng" or a name the geocoder answers by name.

    Google is asked first; a hit counts only when its name matches the text (city names
    removed) and it lies within CENTER_MAX_KM of the city point, else the next provider is asked.
    """
    if (parsed := geo.parse_latlng(text)) is not None:
        return parsed[0], parsed[1], None
    client = geocoder()
    city = _city_point(config, client)
    near = (city.lat, city.lng) if city else None
    name = matching.strip_regions(text, [config.city, *config.city_profile.aliases])

    def accept(point: GeocodedPoint) -> bool:
        score = matching.name_score(name, point.display_name)
        gap = geo.haversine_km(near[0], near[1], point.lat, point.lng) if near else 0.0
        if score >= CENTER_MIN_NAME_SCORE and gap <= CENTER_MAX_KM:
            return True
        log.info(
            "center.%s: %s answer %r rejected (name score %.0f, %.1f km from the city point)",
            field,
            point.source,
            point.display_name,
            score,
            gap,
        )
        return False

    found = client.google_first().find(text, accept, near=near)
    if found is None:
        raise CenterNotFoundError(
            f"Could not find center.{field} {text!r}: no geocoder answer is named like it "
            f"within {CENTER_MAX_KM:g} km of {config.city}. Use a more specific name or "
            '"lat,lng" (from Google Maps) instead.'
        )
    log.info("center.%s found by %s: %s", field, found.source, found.display_name)
    return found.lat, found.lng, found.google_id


def select_center(config: AppConfig, geocoder: Callable[[], Geocoder]) -> Center:
    """hotel → override → city_profile.center_landmark near the city point → the city point.

    `geocoder` is a factory so a "lat,lng" hotel/override never touches the network.
    """
    fields: tuple[tuple[CenterSource, str], ...] = (
        ("hotel", config.center.hotel.strip()),
        ("override", config.center.override.strip()),
    )
    for field, text in fields:
        if text:
            lat, lng, place_id = _locate(text, field, config, geocoder)
            return Center(lat=lat, lng=lng, source=field, label=text, place_id=place_id)
    client = geocoder()
    city = _city_point(config, client)
    if (landmark := _landmark_center(config, client, city)) is not None:
        return landmark
    if city is None:
        raise CenterNotFoundError(
            f"Could not find a center for city {config.city!r}. Set center.hotel or "
            'center.override ("lat,lng").'
        )
    log.info("Center named by %s (city point)", city.source)
    return Center(
        lat=city.lat,
        lng=city.lng,
        source="city_default",
        label=f"Trung tâm {config.city}",
        label_en=f"{config.city} center",
    )


def _landmark_center(
    config: AppConfig, client: Geocoder, city: GeocodedPoint | None
) -> Center | None:
    """The city's landmark (Google first, for a listing id), if it lies near the city point."""
    profile = config.city_profile
    name = profile.center_landmark.strip()
    if not name:
        return None
    found = client.google_first().geocode(f"{name}, {config.city}")
    if found is None:
        log.warning("Center landmark %r not found; using the city point.", name)
        return None
    if city is not None:
        gap = geo.haversine_km(city.lat, city.lng, found.lat, found.lng)
        if gap > LANDMARK_MAX_KM:
            log.warning(
                "Center landmark %r from %s is %.1f km from the city point (limit %g km); "
                "using the city point.",
                name,
                found.source,
                gap,
                LANDMARK_MAX_KM,
            )
            return None
    log.info("Center named by %s: %s", found.source, name)
    return Center(
        lat=found.lat,
        lng=found.lng,
        source="city_default",
        label=name,
        label_en=profile.center_landmark_en.strip() or None,
        place_id=found.google_id,
    )


def center_warning(center: Center, places: Sequence[Place], sanity_km: float) -> str | None:
    if not places:
        return None
    mid = geo.median_point([(p.lat, p.lng) for p in places])
    gap = geo.haversine_km(center.lat, center.lng, mid[0], mid[1])
    if gap <= sanity_km:
        return None
    return (
        f"Center ({center.source}: {center.label}) is {gap:.1f} km from the median of your "
        f"places (limit {sanity_km:g} km). Set center.hotel or center.override in config.yaml."
    )


def place_spatial(place: Place, center: Center, cfg: SpatialConfig) -> Spatial:
    bearing = geo.bearing_deg(center.lat, center.lng, place.lat, place.lng)
    distance = geo.haversine_km(center.lat, center.lng, place.lat, place.lng)
    return Spatial(
        bearing_deg=round(bearing, 1) % 360.0,
        sector=geo.sector_name(bearing, cfg.sectors),
        distance_km=round(distance, 3),
        ring=geo.ring_label(distance, cfg.rings_km),
    )


def build_zones(
    places: Sequence[Place], spatials: Sequence[Spatial], center: Center, cfg: SpatialConfig
) -> list[Zone]:
    """DBSCAN inside each sector; clusters and noise points become zones named by distance."""
    by_sector: dict[str, list[Place]] = defaultdict(list)
    for place, spatial in zip(places, spatials, strict=True):
        by_sector[spatial.sector].append(place)
    origin = (center.lat, center.lng)
    zones: list[Zone] = []
    for sector in geo.sector_names(cfg.sectors):
        members = by_sector.get(sector, [])
        if not members:
            continue
        labels = geo.dbscan(
            [(p.lat, p.lng) for p in members], cfg.cluster_eps_km, cfg.cluster_min_places
        )
        groups: dict[int, list[Place]] = defaultdict(list)
        singles: list[list[Place]] = []
        for place, label in zip(members, labels, strict=True):
            if label == geo.NOISE:
                singles.append([place])
            else:
                groups[label].append(place)
        candidates = [*groups.values(), *singles]
        located = [(geo.centroid([(p.lat, p.lng) for p in g]), g) for g in candidates]
        located.sort(key=lambda item: (geo.distance_km(origin, item[0]), item[1][0].id))
        for number, (point, group) in enumerate(located, start=1):
            zones.append(
                Zone(
                    id=f"{sector}-{number}",
                    sector=sector,
                    lat=round(point[0], 6),
                    lng=round(point[1], 6),
                    place_ids=[p.id for p in group],
                )
            )
    return zones


def analyze(
    places: Sequence[Place], center: Center, cfg: SpatialConfig
) -> tuple[list[Spatial], SpatialResult]:
    """Pure core of the step: spatial fields (zone filled in) in input order, plus the result.

    Skipped places (status "skip", e.g. removed in preferences) get a direction but no zone.
    """
    spatials = [place_spatial(p, center, cfg) for p in places]
    active = [(p, s) for p, s in zip(places, spatials, strict=True) if p.status != "skip"]
    zones = build_zones([p for p, _ in active], [s for _, s in active], center, cfg)
    zone_of = {pid: zone.id for zone in zones for pid in zone.place_ids}
    spatials = [
        s.model_copy(update={"zone": zone_of.get(p.id)})
        for p, s in zip(places, spatials, strict=True)
    ]
    warnings = [w] if (w := center_warning(center, places, cfg.center_sanity_km)) else []
    result = SpatialResult(center=center, sectors=cfg.sectors, zones=zones, warnings=warnings)
    return spatials, result


def run(ctx: Context) -> None:
    from tiktok_trip.clients import geocoder as geocoding

    raw: list[dict[str, Any]] = (
        read_json(ctx.paths.places_file) if ctx.paths.places_file.exists() else []
    )
    places = [Place.model_validate(item) for item in raw]
    if not places:
        log.warning("No places in %s; computing the center only.", ctx.paths.places_file)

    client: geocoding.FallbackGeocoder | None = None

    def geocoder() -> geocoding.FallbackGeocoder:
        nonlocal client
        client = client or geocoding.build(ctx)
        return client

    try:
        center = select_center(ctx.config, geocoder)
    finally:
        if client is not None:
            client.close()
    log.info(
        "Center (%s): %s at %.5f,%.5f → %s",
        center.source,
        center.label,
        center.lat,
        center.lng,
        center.maps_url,
    )
    spatials, result = analyze(places, center, ctx.config.spatial)
    for warning in result.warnings:
        log.warning(warning)

    for item, spatial in zip(raw, spatials, strict=True):
        item["spatial"] = spatial.model_dump(mode="json")
    if raw:
        write_json(ctx.paths.places_file, raw)
    save_model(ctx.paths.spatial_file, result)
    log.info("%d places in %d zones → %s", len(places), len(result.zones), ctx.paths.spatial_file)
