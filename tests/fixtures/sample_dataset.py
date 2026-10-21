"""Realistic in-memory dataset shared by the export tests."""

from __future__ import annotations

import math
from datetime import datetime

from tiktok_trip.config import AppConfig
from tiktok_trip.export.dataset import ExportData
from tiktok_trip.models import (
    BestTime,
    Category,
    Center,
    DayPlan,
    Evidence,
    EvidenceSource,
    Hours,
    Itinerary,
    NearbySpot,
    OpeningPeriod,
    Place,
    PriceRange,
    RouteStop,
    Spatial,
    SpatialResult,
    UnplacedPlace,
    Zone,
)

CENTER_LAT, CENTER_LNG = 10.7721, 106.6980
CENTER_LABEL = "Chợ Bến Thành"
CENTER_LABEL_EN = "Ben Thanh Market"
CENTER_PLACE_ID = "ChIJbenthanh"
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
RINGS = ((2.0, "0-2 km"), (5.0, "2-5 km"), (10.0, "5-10 km"))
LONG_REASON = "Breakfast phở before the queue; locals say the broth sells out by ten on weekends"


def offset(bearing_deg: float, distance_km: float) -> tuple[float, float]:
    theta = math.radians(bearing_deg)
    lat = CENTER_LAT + distance_km * math.cos(theta) / 111.0
    lng = CENTER_LNG + distance_km * math.sin(theta) / (111.0 * math.cos(math.radians(CENTER_LAT)))
    return round(lat, 6), round(lng, 6)


def every_day(open_at: str, close_at: str | None) -> list[OpeningPeriod]:
    return [OpeningPeriod(day=day, open=open_at, close=close_at) for day in range(7)]


WEEKDAY_SPLIT = [
    *(OpeningPeriod(day=day, open="06:00", close="14:00") for day in range(5)),
    *(OpeningPeriod(day=day, open="06:30", close="12:00") for day in (5, 6)),
]
CLOSED_MONDAY_SPLIT_SHIFT = [
    period
    for day in range(1, 7)
    for period in (
        OpeningPeriod(day=day, open="10:00", close="14:00"),
        OpeningPeriod(day=day, open="17:00", close="22:00"),
    )
]


def ring_for(distance_km: float) -> str:
    return next((label for limit, label in RINGS if distance_km < limit), "10+ km")


def sector_for(bearing_deg: float) -> str:
    names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return names[int(((bearing_deg + 22.5) % 360) // 45)]


def make_place(
    slug: str,
    name: str,
    bearing: float,
    distance: float,
    zone: str,
    *,
    category: Category = Category.FOOD,
    confidence: float = 0.9,
    videos: int = 1,
    rating: float | None = 4.4,
    best_time: BestTime | None = None,
    price: str | None = "50k-100k VND",
    must_try: list[str] | None = None,
    periods: list[OpeningPeriod] | None = None,
) -> Place:
    lat, lng = offset(bearing, distance)
    video_urls = [f"https://www.tiktok.com/@reviewer/video/{slug}{n}" for n in range(videos)]
    return Place(
        id=f"gp:{slug}",
        name=name,
        category=category,
        address=f"{len(slug) * 11} Duong {slug.upper()}, Phuong Ben Nghe, TP.HCM",
        lat=lat,
        lng=lng,
        hours=Hours(
            periods=every_day("07:00", "21:00") if periods is None else periods,
            weekday_text=[f"{day}: 07:00 - 21:00" for day in WEEKDAYS],
            source="google",
        ),
        price_range=PriceRange(value=price, source="google") if price else None,
        rating=rating,
        rating_count=None if rating is None else 100 + len(name) * 37,
        best_time=best_time,
        must_try=must_try or [],
        notes=[f"Comment about {name}: queue after 18:00"],
        videos=video_urls,
        evidence=[
            Evidence(
                source=EvidenceSource.CAPTION,
                quote=f"Quan {name} o duong {slug}",
                timestamp=None,
            ),
            Evidence(source=EvidenceSource.TRANSCRIPT, quote=f"{name} ngon lam", timestamp="00:12"),
        ],
        spatial=Spatial(
            bearing_deg=bearing,
            sector=sector_for(bearing),
            distance_km=distance,
            ring=ring_for(distance),
            zone=zone,
        ),
        confidence=confidence,
    )


def build_places() -> list[Place]:
    comments = BestTime(
        hours="17:00-20:00",
        days="weekday",
        months="Dec-Apr",
        source="comments",
        evidence="di toi moi dong",
    )
    heuristic = BestTime(hours="06:30-09:00", source="heuristic", evidence="breakfast pho rule")
    caption = BestTime(days="weekend", source="caption", deadline="14:00", evidence="het som")
    hours_based = BestTime(hours="10:00-12:00", source="hours")
    return [
        make_place(
            "pho1", "Phở Hòa Pasteur", 5, 1.2, "N-1", best_time=heuristic, videos=3, rating=4.6
        ),
        make_place(
            "banhmi2",
            "Bánh Mì Huỳnh Hoa",
            10,
            1.8,
            "N-1",
            best_time=comments,
            videos=2,
            periods=WEEKDAY_SPLIT,
        ),
        make_place(
            "cafe3",
            "Cà Phê Muối",
            350,
            4.0,
            "N-2",
            category=Category.CAFE,
            rating=None,
            periods=CLOSED_MONDAY_SPLIT_SHIFT,
        ),
        make_place("xeo4", "Bánh Xèo 46A", 40, 2.6, "NE-1", best_time=caption, confidence=0.55),
        make_place(
            "temple5",
            "Chùa Bà Thiên Hậu",
            60,
            5.5,
            "NE-1",
            category=Category.ATTRACTION,
            best_time=hours_based,
            price=None,
            periods=every_day("00:00", None),
        ),
        make_place(
            "comtam6", "Cơm Tấm Ba Ghiền", 90, 3.1, "E-1", must_try=["sườn nướng"], confidence=0.65
        ),
        make_place("bunbo7", "Bún Bò Huế O Hương", 130, 6.8, "SE-1", best_time=heuristic),
        make_place("hutieu8", "Hủ Tiếu Nam Vang", 180, 1.0, "S-1", videos=2),
        make_place(
            "oc9",
            "Ốc Đào",
            185,
            3.5,
            "S-1",
            best_time=comments,
            must_try=["ốc len xào dừa", "sò điệp"],
        ),
        make_place(
            "cafe10", "The Workshop Coffee", 225, 2.2, "SW-1", category=Category.CAFE, rating=4.7
        ),
        make_place("che11", "Chè Thái Lan", 270, 3.9, "W-1", confidence=0.8),
        make_place(
            "market12",
            "Chợ Bình Tây",
            262,
            4.8,
            "W-1",
            category=Category.ATTRACTION,
            price=None,
            best_time=heuristic,
        ),
    ]


def build_spatial(places: list[Place]) -> SpatialResult:
    zones: dict[str, Zone] = {}
    for place in places:
        assert place.spatial and place.spatial.zone
        zone = zones.setdefault(
            place.spatial.zone,
            Zone(id=place.spatial.zone, sector=place.spatial.sector, lat=place.lat, lng=place.lng),
        )
        zone.place_ids.append(place.id)
    return SpatialResult(
        center=Center(
            lat=CENTER_LAT,
            lng=CENTER_LNG,
            source="city_default",
            label=CENTER_LABEL,
            label_en=CENTER_LABEL_EN,
            place_id=CENTER_PLACE_ID,
        ),
        sectors=8,
        zones=list(zones.values()),
        warnings=[],
    )


def build_nearby() -> list[NearbySpot]:
    lat, lng = offset(8, 1.5)
    lat2, lng2 = offset(185, 2.8)
    lat3, lng3 = offset(88, 3.4)
    return [
        NearbySpot(
            id="osm:node/1",
            name="Nhà Thờ Đức Bà",
            kind="attraction",
            lat=lat,
            lng=lng,
            zone_id="N-1",
            source="overpass",
        ),
        NearbySpot(
            id="osm:node/2",
            name="Bảo Tàng Chứng Tích",
            kind="museum",
            lat=lat2,
            lng=lng2,
            zone_id="S-1",
            source="overpass",
        ),
        NearbySpot(
            id="gp:nearby3",
            name="Công Viên 23/9",
            kind="park",
            lat=lat3,
            lng=lng3,
            zone_id="E-1",
            source="google",
            rating=4.3,
            rating_count=900,
        ),
    ]


def _stop(  # noqa: PLR0917
    kind: str,
    ref_id: str | None,
    name: str,
    lat: float,
    lng: float,
    arrive: str,
    depart: str,
    travel: int | None,
    *,
    slot: str | None = None,
    reason: str | None = None,
) -> RouteStop:
    return RouteStop(
        kind=kind,
        ref_id=ref_id,
        name=name,
        lat=lat,
        lng=lng,
        arrive=arrive,
        depart=depart,
        travel_min_to_next=travel,
        slot=slot,
        reason=reason,
    )  # type: ignore[arg-type]


def build_itinerary(places: list[Place], nearby: list[NearbySpot]) -> Itinerary:
    """An agent plan: rhythm slots and reasons on the stops, a rest at the center, two unplaced."""
    by_id = {place.id: place for place in places}

    def at(  # noqa: PLR0917
        place_id: str, arrive: str, depart: str, travel: int | None, slot: str, reason: str
    ) -> RouteStop:
        place = by_id[place_id]
        return _stop(
            "place",
            place.id,
            place.name,
            place.lat,
            place.lng,
            arrive,
            depart,
            travel,
            slot=slot,
            reason=reason,
        )

    def spot(index: int, arrive: str, depart: str, travel: int, reason: str) -> RouteStop:
        item = nearby[index]
        return _stop(
            "nearby",
            item.id,
            item.name,
            item.lat,
            item.lng,
            arrive,
            depart,
            travel,
            slot="morning",
            reason=reason,
        )

    def center(kind: str, arrive: str, depart: str, travel: int | None) -> RouteStop:
        slot = "rest" if kind == "rest" else None
        return _stop(
            kind, None, CENTER_LABEL, CENTER_LAT, CENTER_LNG, arrive, depart, travel, slot=slot
        )

    day1 = DayPlan(
        day=1,
        zone_ids=["N-1", "NE-1"],
        stops=[
            center("start", "08:00", "08:00", 10),
            at("gp:pho1", "08:10", "08:55", 8, "breakfast", LONG_REASON),
            at("gp:banhmi2", "09:03", "09:30", 12, "morning", "Bánh mì to go"),
            spot(0, "09:42", "10:15", 15, "Two minutes from the bánh mì"),
            center("rest", "13:00", "14:30", 20),
            at("gp:xeo4", "17:30", "18:15", 20, "dinner", "Crispy bánh xèo"),
            at("gp:temple5", "18:35", "19:50", 15, "evening", "Lit up after dark"),
            center("end", "20:05", "20:05", None),
        ],
        total_minutes=725,
        maps_urls=[
            "https://www.google.com/maps/dir/?api=1&origin=10.77,106.69&destination=10.78,106.7"
        ],
    )
    day2 = DayPlan(
        day=2,
        zone_ids=["S-1", "SW-1"],
        stops=[
            center("start", "08:00", "08:00", 6),
            at("gp:hutieu8", "08:06", "08:51", 9, "breakfast", "Hủ tiếu breakfast"),
            spot(1, "09:00", "10:15", 14, "Museum opens at 7:30"),
            at("gp:oc9", "19:00", "19:45", 12, "dinner", "Snails at dinner time"),
            at("gp:cafe10", "20:00", "20:45", 10, "evening", "Late coffee"),
            center("end", "20:55", "20:55", None),
        ],
        total_minutes=775,
        maps_urls=[
            "https://www.google.com/maps/dir/?api=1&origin=10.77,106.69&destination=10.75,106.69",
            "https://www.google.com/maps/dir/?api=1&origin=10.75,106.69&destination=10.77,106.69",
        ],
    )
    return Itinerary(
        days=[day1, day2],
        travel_mode="motorbike",
        grouping="agent",
        unplaced=[
            UnplacedPlace(ref_id="gp:comtam6", reason="No lunch slot left near E-1"),
            UnplacedPlace(ref_id="gp:gone", reason="Closed for renovation"),
        ],
        generated_at=datetime(2026, 10, 19, 9, 30),
    )


def build_dataset(*, sectors: int = 8) -> ExportData:
    places = build_places()
    spatial = build_spatial(places)
    nearby = build_nearby()
    return ExportData(
        config=AppConfig.model_validate(
            {"city": "Ho Chi Minh City", "spatial": {"sectors": sectors}}
        ),
        places=places,
        spatial=spatial.model_copy(update={"sectors": sectors}),
        nearby=nearby,
        itinerary=build_itinerary(places, nearby),
        pending_review=2,
        generated_at=datetime(2026, 10, 19, 9, 30),
    )
