"""MapData: everything map.html draws, as one JSON document with both languages pre-formatted."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Literal, TypedDict

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from tiktok_trip.config import AppConfig, BasemapId
from tiktok_trip.export.dataset import ExportData, ring_label, sector_of
from tiktok_trip.export.excel_dashboard import glance_activity, glance_time
from tiktok_trip.export.excel_plan import (
    CENTER_KINDS,
    VISIT_KINDS,
    Lookups,
    areas_text,
    days_of,
    rest_label,
    stop_target,
)
from tiktok_trip.export.i18n import (
    EN,
    LANGUAGES,
    Labels,
    best_time_why,
    center_name,
    clock,
    clock_range,
    kind_label,
    localize_calendar,
    localize_times,
    opening_hours,
    unplaced_text,
)
from tiktok_trip.export.palette import (
    CATEGORY_COLORS,
    CATEGORY_INK,
    CENTER_COLOR,
    DAY_COLORS,
    SECTOR_COLORS,
    SECTOR_INK,
    UNASSIGNED,
    UNASSIGNED_COLOR,
    day_color,
    readable_text_color,
    sector_color,
)
from tiktok_trip.export.site import SITE_NAME
from tiktok_trip.geo import SECTOR_BEARING, destination_point
from tiktok_trip.models import (
    BestTime,
    Category,
    Center,
    DayPlan,
    MediaItem,
    NearbySpot,
    OpeningPeriod,
    Place,
    RouteStop,
)
from tiktok_trip.planning.matrix import TravelMatrix
from tiktok_trip.planning.schema import REST_REF
from tiktok_trip.preferences import Preferences
from tiktok_trip.priority import STARS
from tiktok_trip.routing.maps import TRAVELMODES

Localized = dict[str, str]
"""One display string per language code."""


BasemapKind = Literal["raster", "vector"]


class Basemap(BaseModel):
    id: BasemapId
    name: str
    kind: BasemapKind = "raster"
    url: str
    """Tile URL template (raster) or MapLibre style URL (vector)."""
    attribution: str
    max_zoom: int
    subdomains: str = "abc"
    labels_url: str | None = None
    """Transparent place-name tiles drawn over the basemap (satellite imagery has none)."""
    retina: bool = True
    """Request double-resolution tiles on high-density screens (street maps with small text)."""


ESRI_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/{service}/MapServer/tile/{{z}}/{{y}}/{{x}}"
BASEMAPS: tuple[Basemap, ...] = (
    Basemap(
        id="openfreemap",
        name="OpenFreeMap Liberty",
        kind="vector",
        url="https://tiles.openfreemap.org/styles/liberty",
        attribution='<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> '
        '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> '
        'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">'
        "OpenStreetMap</a>",
        max_zoom=19,
    ),
    Basemap(
        id="osm",
        name="OpenStreetMap",
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> '
        "contributors",
        max_zoom=19,
    ),
    Basemap(
        id="esri_streets",
        name="Esri World Street Map",
        url=ESRI_TILES.format(service="World_Street_Map"),
        attribution="Tiles &copy; Esri &mdash; Source: Esri, HERE, Garmin, USGS, Intermap, "
        "INCREMENT P, NRCan, METI, Esri (Thailand), TomTom, &copy; OpenStreetMap contributors "
        "and the GIS User Community",
        max_zoom=19,
    ),
    Basemap(
        id="esri_satellite",
        name="Esri World Imagery",
        url=ESRI_TILES.format(service="World_Imagery"),
        attribution="Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, "
        "and the GIS User Community",
        max_zoom=19,
        labels_url=ESRI_TILES.format(service="Reference/World_Boundaries_and_Places"),
        retina=False,
    ),
)
FALLBACK_BASEMAP: BasemapId = "esri_streets"
PREFERRED_BASEMAPS: tuple[BasemapId, ...] = ("openfreemap", FALLBACK_BASEMAP)
"""The default view without Google: the first of these that is offered, else the first listed."""
GOOGLE_BASEMAP: BasemapId = "google"
TILE_HOSTS: tuple[str, ...] = (
    "tiles.openfreemap.org",
    "server.arcgisonline.com",
    "tile.openstreetmap.org",
)
ROUTING_HOSTS: tuple[str, ...] = ("routing.openstreetmap.de",)
"""OSRM hosts whose answers the service worker caches (web pwa/constants.ts mirrors both lists)."""
RING_LABEL_BEARING = 22.5
"""Between the N and NE rays, so ring labels never sit under a direction label."""
GOOGLE_MAPS_JS = "https://maps.googleapis.com/maps/api/js"
MAP_SCHEMA_VERSION = 1
"""trip.json format version; the web app refuses any other. Bump it together with
TRIP_SCHEMA_VERSION in web/src/data/load.ts when a change breaks an older app (docs/WEB.md)."""


class GoogleBasemap(BaseModel):
    name: str = "Google Maps"
    src: str


class MapCenter(BaseModel):
    lat: float
    lng: float
    kind: str
    name: Localized
    source: Localized
    maps_url: str


class MapRing(BaseModel):
    km: float
    label: str
    lat: float
    lng: float


class MapRay(BaseModel):
    sector: str
    color: str
    lat: float
    lng: float


class MapHours(BaseModel):
    """Display text per language plus the raw periods the plan editor checks arrivals against."""

    en: str
    vi: str
    periods: list[OpeningPeriod]


class MapBestTime(BaseModel):
    hours: str | None
    days: str | None
    months: str | None
    deadline: str | None
    source: str


class MapPlace(BaseModel):
    id: str
    name: str
    category: str
    address: str
    lat: float
    lng: float
    sector: str
    color: str
    distance_km: float | None
    zone: str | None
    priority: str | None
    stars: str
    rating: float | None
    rating_count: int | None
    price: str
    must_try: list[str]
    videos: list[str]
    maps_url: str
    hours: MapHours
    best: Localized
    best_source: str | None
    best_why: Localized
    best_time: MapBestTime | None
    tags: list[str]
    preference: str | None
    day: int | None = None
    stop: int | None = None


class MapNearby(BaseModel):
    id: str
    name: str
    kind: str
    kind_label: Localized
    """'Temple / pagoda' / 'Chùa, đền' for kind 'place_of_worship'."""
    lat: float
    lng: float
    rating: float | None
    maps_url: str


class MapStop(BaseModel):
    kind: str
    ref: str | None
    """Place or nearby id, "rest" for a rest stop, None for the start and end."""
    slot: str | None
    arrive: str
    depart: str
    travel_min_to_next: int | None
    number: int | None
    name: Localized
    activity: Localized
    time: Localized
    reason: str
    reason_vi: str = ""
    """The planner's note in Vietnamese; empty when the plan has none (show `reason`)."""
    lat: float
    lng: float
    maps_url: str


class MapDay(BaseModel):
    day: int
    color: str
    areas: str
    span: Localized
    directions: list[str]
    stops: list[MapStop]


class MapUnplaced(BaseModel):
    ref: str
    name: str
    reason: str
    code: str | None = None
    """planning.schema.UnplacedCode; labels[lang].unplaced_codes[code] names it."""
    reason_text: Localized = Field(default_factory=dict)
    """What to show per language: the code's label (+ the English note in English)."""


class MapTravel(BaseModel):
    """data/plan/travel_minutes.csv: ids = "center", place ids, nearby ids; minutes[from][to]."""

    ids: list[str]
    minutes: list[list[int]]


class MapRhythmSlot(BaseModel):
    id: str
    start: str
    end: str
    name_en: str
    name_vi: str
    categories: list[str]


class MapPlanConfig(BaseModel):
    """The plan rules the in-browser editor needs, serialised with camelCase keys."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    day_start: str
    day_end: str
    rhythm: list[MapRhythmSlot]
    service_minutes: dict[str, int]
    nearby_service_minutes: int
    rest_minutes: int
    rest_min_minutes: int
    rest_at_center: bool
    target_places_per_day: int
    travelmode: str
    trip_days: int
    max_places_per_day: int | None
    max_nearby_per_day: int
    dated: bool


class MapLabels(TypedDict):
    """labels[lang] in trip.json: the map chrome (`ui`) plus the shared trip vocabulary."""

    ui: dict[str, str]
    categories: dict[str, str]
    directions: dict[str, str]
    no_direction: str
    priorities: dict[str, str]
    day: str
    best_time: str
    heuristic: str
    source: str
    directions_link: str
    leg: str
    no_plan: str
    twelve_hour: bool
    day_units: list[str]
    stop_kinds: dict[str, str]
    tags: dict[str, str]
    tags_title: str
    best_time_why: str
    kinds: dict[str, str]
    unplaced_codes: dict[str, str]


class MapPreferences(BaseModel):
    """input/preferences.yaml as read by the export; the map adds hidden places to `removed`."""

    must_go: list[str]
    removed: list[str]


@dataclass(frozen=True)
class MapExtras:
    """Inputs from outside ExportData: preview images, travel matrix, preferences, road legs."""

    media: Mapping[str, Sequence[MediaItem]] = field(default_factory=dict)
    travel: TravelMatrix | None = None
    preferences: Preferences | None = None
    roads: Mapping[str, str] = field(default_factory=dict)
    """Encoded polyline per leg key "<from>><to>" (export.roads)."""


class MapData(BaseModel):
    schema_version: int = MAP_SCHEMA_VERSION
    site_name: str = SITE_NAME
    """The app's document.title (the export also writes it into <title>)."""
    city: str
    summary: Localized
    generated: Localized
    center: MapCenter | None
    sectors: list[str]
    sector_colors: dict[str, str]
    sector_ink: dict[str, str]
    category_colors: dict[str, str] = Field(default=dict(CATEGORY_COLORS))
    """Pin fill per place category; the web app falls back to its own copy of these defaults
    for exports older than the field."""
    category_ink: dict[str, str] = Field(default=dict(CATEGORY_INK))
    """Icon colour on each category fill."""
    center_color: str
    rings: list[MapRing]
    rays: list[MapRay]
    places: list[MapPlace]
    nearby: list[MapNearby]
    days: list[MapDay]
    day_colors: list[str]
    day_ink: list[str] = Field(default_factory=list)
    """Text colour on each day colour (same order as day_colors)."""
    unplaced: list[MapUnplaced]
    basemaps: list[Basemap]
    default_basemap: str
    google: GoogleBasemap | None
    labels: dict[str, MapLabels]
    rest_name: Localized
    config: MapPlanConfig
    travel: MapTravel | None
    roads: dict[str, str] = Field(default_factory=dict)
    """Road geometry per leg "<from>><to>" (MapTravel ids), encoded polyline of precision 5;
    the map draws legs without one as straight lines."""
    roads_enabled: bool = False
    """The app may ask the OSRM server below for legs `roads` lacks (stops moved in the editor)."""
    roads_endpoint: str = ""
    roads_profile: str = ""
    """Path segment before `/route/v1/` for the trip's travel mode; empty means none."""
    media: dict[str, list[MediaItem]]
    preferences: MapPreferences
    trip_weekdays: list[int] = Field(serialization_alias="tripWeekdays")
    """Weekday (0 = Monday) of each trip day; Saturdays when trip.trip_start_date is empty."""
    trip_dates: list[str | None] = Field(serialization_alias="tripDates")


def localized(render: Callable[[Labels], str]) -> Localized:
    """{'en': render(EN), 'vi': render(VI)} for a function of the labels."""
    return {labels.code: render(labels) for labels in LANGUAGES}


def best_text(labels: Labels, best_time: BestTime | None) -> str:
    """Best hours, days, months and sell-out time joined with ' · ', in the label's clock."""
    if best_time is None:
        return ""
    parts = [
        localize_calendar(labels, localize_times(labels, value))
        for value in (best_time.hours, best_time.days)
        if value
    ]
    if best_time.months:
        parts.append(localize_calendar(labels, best_time.months))
    if best_time.deadline:
        parts.append(labels.map_ui["sells_out"].format(time=clock(labels, best_time.deadline)))
    return " · ".join(parts)


def labels_json(labels: Labels) -> MapLabels:
    return {
        "ui": dict(labels.map_ui),
        "categories": {str(key): value for key, value in labels.categories.items()},
        "directions": dict(labels.directions),
        "no_direction": labels.no_direction,
        "priorities": dict(labels.priorities),
        "day": labels.day,
        "best_time": labels.best_time,
        "heuristic": labels.heuristic,
        "source": labels.source,
        "directions_link": labels.directions_link,
        "leg": labels.leg,
        "no_plan": labels.no_plan,
        "twelve_hour": labels.twelve_hour,
        "day_units": list(labels.day_units),
        "stop_kinds": dict(labels.stop_kinds),
        "tags": dict(labels.tags),
        "tags_title": labels.tags_title,
        "best_time_why": labels.best_time_why,
        "kinds": dict(labels.kinds),
        "unplaced_codes": dict(labels.unplaced_codes),
    }


def map_center(center: Center) -> MapCenter:
    return MapCenter(
        lat=center.lat,
        lng=center.lng,
        kind=center.source,
        name=localized(lambda labels: center_name(labels, center)),
        source=localized(lambda labels: labels.center_sources.get(center.source, center.source)),
        maps_url=center.maps_url,
    )


def compass(
    center: Center, sectors: tuple[str, ...], rings_km: list[float]
) -> tuple[list[MapRing], list[MapRay]]:
    rings = [
        MapRing(km=km, label=ring_label(km), lat=lat, lng=lng)
        for km in sorted(rings_km)
        for lat, lng in [destination_point(center.lat, center.lng, RING_LABEL_BEARING, km)]
    ]
    outer = max(rings_km, default=5.0)
    rays = [
        MapRay(sector=name, color=sector_color(name), lat=lat, lng=lng)
        for name in sectors
        for lat, lng in [destination_point(center.lat, center.lng, SECTOR_BEARING[name], outer)]
    ]
    return rings, rays


def map_place(place: Place) -> MapPlace:
    spatial = place.spatial
    best = place.best_time
    return MapPlace(
        id=place.id,
        name=place.name,
        category=str(place.category),
        address=place.address,
        lat=place.lat,
        lng=place.lng,
        sector=sector_of(place),
        color=sector_color(spatial.sector if spatial else None),
        distance_km=round(spatial.distance_km, 1) if spatial else None,
        zone=spatial.zone if spatial else None,
        priority=place.priority,
        stars=STARS[place.priority],
        rating=place.rating,
        rating_count=place.rating_count,
        price=place.price_range.value if place.price_range else "",
        must_try=place.must_try,
        videos=place.videos,
        maps_url=place.maps_url,
        hours=MapHours(
            **localized(lambda labels: opening_hours(labels, place.hours)),
            periods=place.hours.periods if place.hours else [],
        ),
        best=localized(lambda labels: best_text(labels, best)),
        best_source=best.source if best else None,
        best_why=localized(lambda labels: best_time_why(labels, best)),
        best_time=MapBestTime(
            hours=best.hours,
            days=best.days,
            months=best.months,
            deadline=best.deadline,
            source=best.source,
        )
        if best
        else None,
        tags=place.tags,
        preference=place.preference,
    )


def map_nearby(spot: NearbySpot) -> MapNearby:
    return MapNearby(
        id=spot.id,
        name=spot.name,
        kind=spot.kind,
        kind_label=localized(lambda labels: kind_label(labels, spot.kind)),
        lat=spot.lat,
        lng=spot.lng,
        rating=spot.rating,
        maps_url=spot.maps_url,
    )


def map_stop(stop: RouteStop, number: int | None, data: ExportData, lookups: Lookups) -> MapStop:
    def name(labels: Labels) -> str:
        if stop.kind == "rest":
            return rest_label(labels, data)
        return stop_target(labels, stop, data, lookups)[1]

    ref = REST_REF if stop.kind == "rest" else None if stop.kind in CENTER_KINDS else stop.ref_id
    return MapStop(
        kind=stop.kind,
        ref=ref,
        slot=stop.slot,
        arrive=stop.arrive,
        depart=stop.depart,
        travel_min_to_next=stop.travel_min_to_next,
        number=number,
        name=localized(name),
        activity=localized(lambda labels: glance_activity(labels, stop, data, lookups)),
        time=localized(lambda labels: glance_time(labels, stop)),
        reason=stop.reason or "",
        reason_vi=stop.reason_vi or "",
        lat=stop.lat,
        lng=stop.lng,
        maps_url=stop_target(EN, stop, data, lookups)[0],
    )


def map_day(day: DayPlan, data: ExportData, lookups: Lookups) -> MapDay:
    stops: list[MapStop] = []
    number = 0
    for stop in day.stops:
        visit = stop.kind in VISIT_KINDS
        number += visit
        stops.append(map_stop(stop, number if visit else None, data, lookups))
    span: Localized = {labels.code: "" for labels in LANGUAGES}
    if day.stops:
        first, last = day.stops[0], day.stops[-1]
        span = localized(lambda labels: clock_range(labels, first.depart, last.arrive))
    return MapDay(
        day=day.day,
        color=day_color(day.day),
        areas=areas_text(day, lookups),
        span=span,
        directions=day.maps_urls,
        stops=stops,
    )


def summary(labels: Labels, config: AppConfig, days: int) -> str:
    mode = config.travel.mode
    return " · ".join([labels.day_count(days), labels.travel_modes.get(mode, mode)])


def offered_basemaps(ids: Sequence[BasemapId]) -> list[Basemap]:
    """Non-Google basemaps in config order; Esri Streets when the list names none (only Google)."""
    by_id = {basemap.id: basemap for basemap in BASEMAPS}
    tiles = [by_id[basemap_id] for basemap_id in dict.fromkeys(ids) if basemap_id in by_id]
    return tiles or [by_id[FALLBACK_BASEMAP]]


def default_basemap(tiles: Sequence[Basemap], google: bool) -> str:
    if google:
        return GOOGLE_BASEMAP
    ids = [basemap.id for basemap in tiles]
    return next((basemap_id for basemap_id in PREFERRED_BASEMAPS if basemap_id in ids), ids[0])


def trip_calendar(config: AppConfig) -> tuple[list[int], list[str | None]]:
    """Weekday and ISO date (None when undated) of every trip day, as the planner sees them."""
    from tiktok_trip.planning.inputs import trip_days

    weekdays, dates = trip_days(config)
    return weekdays, [day.isoformat() if day else None for day in dates]


def plan_config(config: AppConfig) -> MapPlanConfig:
    from tiktok_trip.planning.timing import DEFAULT_REST_MIN, MIN_REST_MIN

    plan = config.plan
    trip = config.trip
    return MapPlanConfig(
        day_start=plan.day_start,
        day_end=plan.day_end,
        rhythm=[
            MapRhythmSlot(
                id=slot.id,
                start=slot.start,
                end=slot.end,
                name_en=slot.name_en,
                name_vi=slot.name_vi,
                categories=[str(category) for category in slot.categories],
            )
            for slot in plan.rhythm
        ],
        service_minutes={
            str(category): config.trip.service_minutes.get(category, 0) for category in Category
        },
        nearby_service_minutes=config.nearby.service_minutes,
        rest_minutes=DEFAULT_REST_MIN,
        rest_min_minutes=MIN_REST_MIN,
        rest_at_center=plan.rest_at_center,
        target_places_per_day=plan.target_places_per_day,
        travelmode=TRAVELMODES.get(config.travel.mode, "driving"),
        trip_days=trip.days,
        max_places_per_day=trip.max_places_per_day,
        max_nearby_per_day=trip.max_nearby_per_day,
        dated=any(trip_calendar(config)[1]),
    )


def map_media(
    media: Mapping[str, Sequence[MediaItem]], place_ids: set[str]
) -> dict[str, list[MediaItem]]:
    return {place_id: list(items) for place_id, items in media.items() if place_id in place_ids}


def build_map_data(
    data: ExportData, google_src: str | None = None, extras: MapExtras | None = None
) -> MapData:
    """The JSON document behind map.html; `google_src` is the Maps JavaScript API loader URL.

    Google is offered only when `google_src` is given and "google" is in `export.basemaps`.
    """
    extras = extras or MapExtras()
    basemap_ids = data.config.export.basemaps
    google = google_src if google_src and GOOGLE_BASEMAP in basemap_ids else None
    tiles = offered_basemaps(basemap_ids)
    preferences = extras.preferences or Preferences()
    weekdays, dates = trip_calendar(data.config)
    center = data.spatial.center if data.spatial else None
    rings, rays = (
        compass(center, data.sector_names, data.config.spatial.rings_km) if center else ([], [])
    )
    lookups = Lookups.build(data)
    days = [map_day(day, data, lookups) for day in days_of(data)]
    places = [map_place(place) for place in data.places]
    by_id = {place.id: place for place in places}
    for day in days:
        for stop in day.stops:
            target = by_id.get(stop.ref or "") if stop.kind == "place" else None
            if target is not None and target.day is None:
                target.day, target.stop = day.day, stop.number
    unplaced = [
        MapUnplaced(
            ref=item.ref_id,
            name=by_id[item.ref_id].name if item.ref_id in by_id else item.ref_id,
            reason=item.reason,
            code=item.code,
            reason_text={
                labels.code: unplaced_text(labels, item.code, item.reason) for labels in LANGUAGES
            },
        )
        for item in (data.itinerary.unplaced if data.itinerary else [])
    ]
    plan_days = len(days) or data.config.trip.days
    colors = {**SECTOR_COLORS, UNASSIGNED: UNASSIGNED_COLOR}
    return MapData(
        schema_version=MAP_SCHEMA_VERSION,
        city=data.config.city,
        summary=localized(lambda labels: summary(labels, data.config, plan_days)),
        generated=localized(lambda labels: data.generated_at.strftime(labels.date_format)),
        center=map_center(center) if center else None,
        sectors=list(data.sector_names),
        sector_colors=colors,
        sector_ink=dict(SECTOR_INK),
        center_color=CENTER_COLOR,
        rings=rings,
        rays=rays,
        places=places,
        nearby=[map_nearby(spot) for spot in data.nearby],
        days=days,
        day_colors=list(DAY_COLORS),
        day_ink=[readable_text_color(color) for color in DAY_COLORS],
        unplaced=unplaced,
        basemaps=tiles,
        default_basemap=default_basemap(tiles, google is not None),
        google=GoogleBasemap(src=google) if google else None,
        labels={labels.code: labels_json(labels) for labels in LANGUAGES},
        rest_name=localized(lambda labels: rest_label(labels, data)),
        config=plan_config(data.config),
        travel=MapTravel(ids=extras.travel.ids, minutes=extras.travel.minutes)
        if extras.travel
        else None,
        roads=dict(extras.roads),
        roads_enabled=data.config.roads.enabled,
        roads_endpoint=data.config.roads.endpoint,
        roads_profile=data.config.roads.profiles[data.config.travel.mode],
        media=map_media(extras.media, set(by_id)),
        preferences=MapPreferences(must_go=preferences.must_go, removed=preferences.removed),
        trip_weekdays=weekdays,
        trip_dates=dates,
    )
