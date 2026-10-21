import math
from collections.abc import Sequence
from datetime import date
from itertools import combinations, product

import pytest

from tiktok_trip import clock, geo
from tiktok_trip.config import DayGrouping, NearbyConfig, TripConfig
from tiktok_trip.context import Context
from tiktok_trip.models import (
    BestTime,
    Category,
    Center,
    DayPlan,
    Hours,
    Itinerary,
    NearbySpot,
    OpeningPeriod,
    Place,
    SpatialResult,
    Zone,
)
from tiktok_trip.routing import windows as tw
from tiktok_trip.routing.days import neighbour_sectors, opposite_sectors, place_target, plan_days
from tiktok_trip.routing.maps import MAX_WAYPOINTS, directions_urls
from tiktok_trip.routing.planner import plan_day
from tiktok_trip.steps import route
from tiktok_trip.storage import load_model, save_model, save_models

CENTER = Center(lat=10.7769, lng=106.7009, source="hotel", label="Hotel")
SAT = 5
KM_LAT = 1 / 111.195


def _hours(*periods: tuple[int, str, str | None]) -> Hours:
    return Hours(periods=[OpeningPeriod(day=d, open=o, close=c) for d, o, c in periods])


def _place(
    pid: str,
    km_north: float,
    *,
    category: Category = Category.FOOD,
    hours: Hours | None = None,
    best_time: BestTime | None = None,
    confidence: float = 0.9,
    status: str = "todo",
) -> Place:
    return Place.model_validate(
        {
            "id": pid,
            "name": pid,
            "category": category,
            "address": "x",
            "lat": CENTER.lat + km_north * KM_LAT,
            "lng": CENTER.lng,
            "hours": hours,
            "best_time": best_time,
            "confidence": confidence,
            "status": status,
        }
    )


def _spot(sid: str, km_north: float, zone: str = "N-1") -> NearbySpot:
    return NearbySpot(
        id=sid,
        name=sid,
        kind="museum",
        lat=CENTER.lat + km_north * KM_LAT,
        lng=CENTER.lng,
        zone_id=zone,
        source="overpass",
    )


def _speed_matrix(kmh: float) -> object:
    def matrix(points: Sequence[geo.LatLng]) -> list[list[float]]:
        return [[geo.distance_km(a, b) / kmh * 60 for b in points] for a in points]

    return matrix


def _plan(
    places: Sequence[Place],
    spots: Sequence[NearbySpot] = (),
    trip: TripConfig | None = None,
    weekday: int = SAT,
    kmh: float = 20.0,
) -> DayPlan:
    return plan_day(
        1,
        zone_ids=["N-1"],
        places=places,
        spots=spots,
        center=CENTER,
        trip=trip or TripConfig(),
        travel_mode="motorbike",
        weekday=weekday,
        matrix_fn=_speed_matrix(kmh),  # type: ignore[arg-type]
    )


def _assert_within_windows(plan: DayPlan, places: Sequence[Place], trip: TripConfig) -> None:
    by_id = {p.id: p for p in places}
    for stop in plan.stops:
        if stop.kind != "place":
            continue
        place = by_id[stop.ref_id or ""]
        arrive, depart = clock.to_minutes(stop.arrive), clock.to_minutes(stop.depart)
        opening = tw.opening_intervals(place.hours, SAT)
        if opening is not None:
            assert any(lo <= arrive and depart <= hi for lo, hi in opening), stop
        assert clock.to_minutes(trip.day_start) <= arrive
        assert depart <= clock.to_minutes(trip.day_end)
    start, end = clock.to_minutes(plan.stops[0].depart), clock.to_minutes(plan.stops[-1].arrive)
    assert plan.total_minutes == end - start
    assert plan.total_minutes <= clock.to_minutes(trip.day_end) - clock.to_minutes(trip.day_start)


def test_opening_intervals_union_overnight_and_closed() -> None:
    hours = _hours((SAT, "07:00", "11:00"), (SAT, "10:00", "12:00"), (SAT, "17:00", "02:00"))
    assert tw.opening_intervals(hours, SAT) == [(420, 720), (1020, 1440)]
    assert tw.opening_intervals(hours, 6) == [(0, 120)]
    assert tw.opening_intervals(hours, 0) == []
    assert tw.opening_intervals(None, SAT) is None
    assert tw.opening_intervals(_hours((0, "00:00", None)), 3) == [(0, 1440)]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("17:00\u201320:00", (1020, 1200)),
        ("17h-20h", (1020, 1200)),
        ("7-9", (420, 540)),
        ("22:00-02:00", (1320, 1440)),
        ("sunset", None),
        (None, None),
    ],
)
def test_parse_hour_range(text: str | None, expected: tuple[int, int] | None) -> None:
    assert tw.parse_hour_range(text) == expected


def test_arrival_windows_combine_hours_best_time_and_deadline() -> None:
    hours = _hours((SAT, "06:00", "14:00"))
    day = (480, 1320)
    assert tw.arrival_windows(hours, None, SAT, 45, day) == [(480, 795)]
    best = BestTime(hours="07:00-09:00", deadline="08:30", source="comments")
    assert tw.arrival_windows(hours, best, SAT, 45, day) == [(480, 510)]
    conflicting = BestTime(hours="19:00-21:00", source="heuristic")
    assert tw.arrival_windows(hours, conflicting, SAT, 45, day) == [(480, 795)]
    assert tw.arrival_windows(_hours((SAT, "08:00", "08:30")), None, SAT, 45, day) == []


def _zone(zid: str, km_north: float, km_east: float = 0.0) -> Zone:
    return Zone(
        id=zid,
        sector=zid.split("-", maxsplit=1)[0],
        lat=CENTER.lat + km_north * KM_LAT,
        lng=CENTER.lng + km_east * KM_LAT,
    )


def test_plan_days_pairs_nearest_and_spreads_surplus() -> None:
    zones = [
        _zone("N-1", 3),
        _zone("N-2", 6),
        _zone("E-1", 0, 4),
        _zone("S-1", -8),
        _zone("W-1", 0, -9),
    ]
    counts = {"N-1": 5, "N-2": 1, "E-1": 4, "S-1": 2, "W-1": 0}

    def nearest(days: int, cap: int) -> list[list[str]]:
        return plan_days(zones, counts, days=days, max_zones_per_day=cap, grouping="nearest")

    assert nearest(3, 2) == [["N-1", "N-2"], ["E-1"], ["S-1"]]
    assert nearest(4, 1) == [["N-1"], ["E-1"], ["S-1"], ["N-2"]]
    assert nearest(2, 1) == [["E-1", "S-1"], ["N-1", "N-2"]]


SECTOR_ZONES = [
    _zone("S-1", -3),
    _zone("S-2", -6),
    _zone("S-3", -9),
    _zone("SW-1", -2.83, -2.83),
    _zone("W-1", 0, -5),
    _zone("N-1", 3),
    _zone("NE-1", 2.83, 2.83),
    _zone("E-1", 0, 4),
]
SECTOR_COUNTS = {"S-1": 4, "S-2": 3, "S-3": 1, "SW-1": 2, "W-1": 1, "N-1": 5, "NE-1": 1, "E-1": 2}


def _sectors_of(day: list[str]) -> set[str]:
    return {zone.split("-")[0] for zone in day}


def test_neighbour_sectors() -> None:
    names8, names4 = geo.sector_names(8), geo.sector_names(4)
    assert neighbour_sectors("N", names8) == {"NW", "NE"}
    assert neighbour_sectors("SW", names8) == {"S", "W"}
    assert neighbour_sectors("N", names4) == {"W", "E"}
    assert neighbour_sectors("UNASSIGNED", names8) == set()


def _loads(days: list[list[str]], counts: dict[str, int]) -> list[int]:
    return [sum(counts[zone] for zone in day) for day in days]


def _opposite_days(days: list[list[str]]) -> list[list[str]]:
    return [
        day
        for day in days
        if any(opposite_sectors(a, b) for a, b in combinations(_sectors_of(day), 2))
    ]


def test_sector_gap_and_opposite_sectors() -> None:
    assert geo.sector_gap_deg("N", "S") == 180
    assert geo.sector_gap_deg("NW", "NE") == 90
    assert geo.sector_gap_deg("W", "SE") == 135
    assert geo.sector_gap_deg("N", "UNASSIGNED") is None
    assert opposite_sectors("W", "SE")
    assert not opposite_sectors("N", "E")
    assert not opposite_sectors("N", "UNASSIGNED")


def test_sector_grouping_splits_big_sector_and_balances_places() -> None:
    days = plan_days(SECTOR_ZONES, SECTOR_COUNTS, days=5, max_zones_per_day=2)
    assert days == [["N-1"], ["S-1"], ["S-2", "S-3"], ["E-1", "NE-1"], ["SW-1", "W-1"]]
    assert sorted(zone for day in days for zone in day) == sorted(SECTOR_COUNTS)
    assert _loads(days, SECTOR_COUNTS) == [5, 4, 4, 3, 3]


@pytest.mark.parametrize("grouping", ["sector", "nearest"])
def test_short_trip_balances_places_without_opposite_sectors(grouping: DayGrouping) -> None:
    days = plan_days(SECTOR_ZONES, SECTOR_COUNTS, days=3, max_zones_per_day=2, grouping=grouping)
    assert sorted(zone for day in days for zone in day) == sorted(SECTOR_COUNTS)
    loads = _loads(days, SECTOR_COUNTS)
    assert max(loads) <= math.ceil(sum(SECTOR_COUNTS.values()) / 3)
    assert max(loads) - min(loads) <= 1
    assert _opposite_days(days) == []


def test_nearest_and_sector_grouping_differ_on_the_same_data() -> None:
    sector = plan_days(SECTOR_ZONES, SECTOR_COUNTS, days=3, max_zones_per_day=2)
    nearest = plan_days(
        SECTOR_ZONES, SECTOR_COUNTS, days=3, max_zones_per_day=2, grouping="nearest"
    )
    assert sector == [["S-3", "S-2", "SW-1", "W-1"], ["E-1", "S-1"], ["N-1", "NE-1"]]
    assert nearest == [["S-1", "SW-1", "W-1"], ["N-1", "NE-1"], ["S-2", "S-3", "E-1"]]


def test_leftover_zones_go_to_the_lightest_day_not_across_the_center() -> None:
    zones = [_zone("N-1", 3), _zone("S-1", -3), _zone("E-1", 0, 3)]
    counts = {"N-1": 3, "S-1": 2, "E-1": 1}
    assert plan_days(zones, counts, days=1, max_zones_per_day=1) == [["N-1", "S-1", "E-1"]]
    assert plan_days(zones, counts, days=2, max_zones_per_day=1) == [["N-1"], ["S-1", "E-1"]]
    two = [_zone("N-1", 3), _zone("E-1", 0, 3)]
    assert plan_days(two, counts, days=3, max_zones_per_day=2, sectors=4) == [["N-1"], ["E-1"]]
    north = [_zone("N-1", 3), _zone("N-2", 3.5, 0.5), _zone("S-1", -3)]
    north_counts = {"N-1": 5, "N-2": 3, "S-1": 2}
    north_days = plan_days(north, north_counts, days=2, max_zones_per_day=2)
    assert [sorted(day) for day in north_days] == [["N-1", "N-2"], ["S-1"]]


# Mirrors the real Da Lat run: 23 places in 8 zones (km north/east of the market), 3 days.
# Before: E-1 + SE-1 + S-1 (17 places) on one day, SE-2 + SW-1 + W-1 (opposite sides) on another.
DALAT_ZONES = [
    _zone("N-1", 1.82, 0.2),
    _zone("NE-1", 0.31, 0.31),
    _zone("E-1", -0.18, 3.58),
    _zone("SE-1", -2.12, 1.66),
    _zone("SE-2", -4.99, 10.83),
    _zone("S-1", -1.91, 0.37),
    _zone("SW-1", -0.89, -0.47),
    _zone("W-1", -3.31, -10.99),
]
DALAT_COUNTS = {
    "N-1": 2,
    "NE-1": 1,
    "E-1": 7,
    "SE-1": 6,
    "SE-2": 1,
    "S-1": 4,
    "SW-1": 1,
    "W-1": 1,
}


def _best_spread_without_opposites(counts: dict[str, int], days: int) -> int:
    best = sum(counts.values())
    for assignment in product(range(days), repeat=len(counts)):
        split = [
            [z for z, d in zip(counts, assignment, strict=True) if d == i] for i in range(days)
        ]
        if all(split) and not _opposite_days(split):
            loads = _loads(split, counts)
            best = min(best, max(loads) - min(loads))
    return best


@pytest.mark.parametrize("grouping", ["sector", "nearest"])
def test_dalat_mirror_balances_places_and_never_crosses_the_center(
    grouping: DayGrouping,
) -> None:
    days = plan_days(DALAT_ZONES, DALAT_COUNTS, days=3, max_zones_per_day=2, grouping=grouping)
    assert sorted(zone for day in days for zone in day) == sorted(DALAT_COUNTS)
    assert _opposite_days(days) == []
    loads = _loads(days, DALAT_COUNTS)
    # N-1 faces S, SE and SW and E-1 alone has 7 places, so 9/8/6 is the most even split
    # without crossing the center; spread <= 2 is only reachable by pairing opposite sectors.
    assert _best_spread_without_opposites(DALAT_COUNTS, 3) == 3
    assert sorted(loads) == [6, 8, 9]
    assert days == [["E-1", "N-1"], ["SE-1", "SE-2", "NE-1"], [*days[2]]]
    assert set(days[2]) == {"S-1", "SW-1", "W-1"}


@pytest.mark.parametrize("grouping", ["sector", "nearest"])
def test_dalat_like_set_with_a_feasible_split_stays_within_two_places(
    grouping: DayGrouping,
) -> None:
    counts = {**DALAT_COUNTS, "N-1": 1, "S-1": 5}
    days = plan_days(DALAT_ZONES, counts, days=3, max_zones_per_day=2, grouping=grouping)
    loads = _loads(days, counts)
    assert sum(loads) == 23
    assert max(loads) - min(loads) <= 2
    assert _opposite_days(days) == []


def test_max_places_per_day_is_a_hard_cap(caplog: pytest.LogCaptureFixture) -> None:
    days = plan_days(DALAT_ZONES, DALAT_COUNTS, days=3, max_zones_per_day=2, max_places_per_day=6)
    loads = _loads(days, DALAT_COUNTS)
    assert days[0] == ["E-1"]
    assert all(load <= 6 for day, load in zip(days, loads, strict=True) if len(day) > 1)
    planned = {zone for day in days for zone in day}
    assert planned < set(DALAT_COUNTS)
    assert "left out" in caplog.text
    assert place_target(23, 3) == 8
    assert place_target(23, 3, 6) == 6


def test_directions_urls_split_into_legs() -> None:
    points = [(10.0 + i * 0.01, 106.0) for i in range(15)]
    urls = directions_urls(points, "driving")
    assert len(urls) == 2
    assert urls[0].startswith("https://www.google.com/maps/dir/?api=1&origin=10.000000,106.000000")
    assert urls[0].count("|") == MAX_WAYPOINTS - 1
    assert "destination=10.100000,106.000000" in urls[0]
    assert "origin=10.100000,106.000000" in urls[1]
    assert urls[1].endswith(
        "destination=10.140000,106.000000&waypoints=10.110000,106.000000|10.120000,106.000000|10.130000,106.000000&travelmode=driving"
    )
    single = directions_urls(points[:2])
    assert single == [
        "https://www.google.com/maps/dir/?api=1&origin=10.000000,106.000000&destination=10.010000,106.000000&travelmode=driving"
    ]


def test_no_stop_outside_opening_hours_and_day_fits() -> None:
    trip = TripConfig(day_start="08:00", day_end="22:00")
    places = [
        _place("breakfast", 1, hours=_hours((SAT, "06:00", "10:00"))),
        _place("dinner", 2, hours=_hours((SAT, "17:00", "23:00"))),
        _place("split", 3, hours=_hours((SAT, "07:00", "11:00"), (SAT, "14:00", "16:00"))),
        _place("museum", 4, category=Category.ATTRACTION, hours=_hours((SAT, "09:00", "17:00"))),
        _place("cafe", 1.5, category=Category.CAFE),
    ]
    plan = _plan(places, trip=trip)
    assert plan.skipped == []
    assert next(s.kind for s in plan.stops) == "start"
    assert [s.kind for s in plan.stops][-1] == "end"
    assert {s.ref_id for s in plan.stops if s.kind == "place"} == {p.id for p in places}
    _assert_within_windows(plan, places, trip)
    museum = next(s for s in plan.stops if s.ref_id == "museum")
    assert clock.to_minutes(museum.depart) - clock.to_minutes(museum.arrive) == 75
    assert len(plan.maps_urls) == 1
    assert "travelmode=two-wheeler" in plan.maps_urls[0]


def test_optional_stop_dropped_when_it_does_not_fit() -> None:
    trip = TripConfig(day_start="09:00", day_end="12:00")
    places = [_place("a", 1, category=Category.ATTRACTION), _place("b", 2)]
    plan = _plan(places, spots=[_spot("near", 2.2), _spot("far", 40)], trip=trip)
    visited = [s.ref_id for s in plan.stops if s.kind not in {"start", "end"}]
    assert "far" not in visited
    assert {"a", "b"} <= set(visited)
    assert plan.skipped == []
    _assert_within_windows(plan, places, trip)


def test_fitting_optional_stop_is_visited() -> None:
    plan = _plan([_place("a", 1)], spots=[_spot("near", 1.2)])
    assert "near" in [s.ref_id for s in plan.stops]


def test_infeasible_day_drops_lowest_confidence_place() -> None:
    trip = TripConfig(day_start="09:00", day_end="11:00")
    places = [
        _place("sure", 1, category=Category.ATTRACTION, confidence=0.95),
        _place("unsure", 1.2, category=Category.ATTRACTION, confidence=0.4),
    ]
    plan = _plan(places, trip=trip)
    assert plan.skipped == ["unsure"]
    assert [s.ref_id for s in plan.stops if s.kind == "place"] == ["sure"]
    _assert_within_windows(plan, places, trip)


def test_closed_place_is_skipped() -> None:
    places = [_place("open", 1), _place("closed_sat", 2, hours=_hours((0, "08:00", "20:00")))]
    plan = _plan(places)
    assert plan.skipped == ["closed_sat"]


def test_best_time_relaxed_rather_than_dropping() -> None:
    trip = TripConfig(day_start="08:00", day_end="12:00")
    late = BestTime(hours="07:00-08:30", source="heuristic")
    places = [
        _place("a", 1, best_time=late, category=Category.ATTRACTION),
        _place("b", 1.1, best_time=late, category=Category.ATTRACTION),
    ]
    plan = _plan(places, trip=trip)
    assert plan.skipped == []
    _assert_within_windows(plan, places, trip)


def test_deadline_caps_arrival() -> None:
    places = [
        _place("early", 3, best_time=BestTime(deadline="09:00", source="comments")),
        _place("other", 1, category=Category.ATTRACTION),
    ]
    plan = _plan(places)
    early = next(s for s in plan.stops if s.ref_id == "early")
    assert clock.to_minutes(early.arrive) <= 9 * 60


def test_food_nudged_to_lunch_and_dinner() -> None:
    places = [
        _place("pho", 1),
        _place("bun", 1.5),
        _place("museum", 2, category=Category.ATTRACTION),
    ]
    plan = _plan(places)
    slots = []
    for stop in plan.stops:
        if stop.ref_id in {"pho", "bun"}:
            arrive = clock.to_minutes(stop.arrive)
            slots.append(
                "lunch"
                if tw.LUNCH[0] <= arrive <= tw.LUNCH[1]
                else "dinner"
                if tw.DINNER[0] <= arrive <= tw.DINNER[1]
                else "other"
            )
    assert slots == ["lunch", "dinner"]


def test_explicit_best_time_beats_meal_nudge() -> None:
    breakfast = BestTime(hours="07:00-09:00", source="comments")
    plan = _plan([_place("pho", 1, best_time=breakfast)])
    pho = next(s for s in plan.stops if s.ref_id == "pho")
    assert clock.to_minutes(pho.arrive) <= 9 * 60


def test_trip_weekdays() -> None:
    assert route.trip_weekdays(TripConfig(), 2) == [SAT, SAT]
    assert route.trip_weekdays(TripConfig(trip_start_date=date(2026, 10, 19)), 3) == [0, 1, 2]


def test_run_writes_itinerary_with_fallback_matrix(ctx: Context) -> None:
    places = [
        _place("a", 1),
        _place("b", 1.5, category=Category.ATTRACTION),
        _place("gone", 1.2, status="skip"),
        _place("c", -3, category=Category.CAFE),
    ]
    zones = [
        Zone(
            id="N-1", sector="N", lat=places[0].lat, lng=places[0].lng, place_ids=["a", "b", "gone"]
        ),
        Zone(id="S-1", sector="S", lat=places[3].lat, lng=places[3].lng, place_ids=["c"]),
    ]
    save_models(ctx.paths.places_file, places)
    save_model(ctx.paths.spatial_file, SpatialResult(center=CENTER, sectors=8, zones=zones))
    save_models(ctx.paths.nearby_file, [_spot("osm:node/1", 1.3)])
    ctx.config.plan.mode = "solver"

    route.run(ctx)

    itinerary = load_model(ctx.paths.routes_file, Itinerary)
    assert itinerary.travel_mode == "motorbike"
    assert itinerary.grouping == "sector"
    assert itinerary.needed_days is None
    assert [d.zone_ids for d in itinerary.days] == [["N-1"], ["S-1"]]
    ids = [s.ref_id for day in itinerary.days for s in day.stops]
    assert "gone" not in ids
    assert {"a", "b", "c"} <= set(ids)
    first = itinerary.days[0].stops[0]
    assert first.travel_min_to_next is not None
    assert first.travel_min_to_next >= math.floor(
        geo.distance_km(
            (CENTER.lat, CENTER.lng),
            (itinerary.days[0].stops[1].lat, itinerary.days[0].stops[1].lng),
        )
        * 1.3
        / 18
        * 60
    )


def test_run_records_nearest_grouping(ctx: Context) -> None:
    places = [_place("a", 1), _place("c", -3, category=Category.CAFE)]
    zones = [
        Zone(id="N-1", sector="N", lat=places[0].lat, lng=places[0].lng, place_ids=["a"]),
        Zone(id="S-1", sector="S", lat=places[1].lat, lng=places[1].lng, place_ids=["c"]),
    ]
    save_models(ctx.paths.places_file, places)
    save_model(ctx.paths.spatial_file, SpatialResult(center=CENTER, sectors=8, zones=zones))
    ctx.config.trip.day_grouping = "nearest"
    ctx.config.plan.mode = "solver"

    route.run(ctx)

    itinerary = load_model(ctx.paths.routes_file, Itinerary)
    assert itinerary.grouping == "nearest"
    assert [d.zone_ids for d in itinerary.days] == [["N-1"], ["S-1"]]


def test_itinerary_without_grouping_reads_as_nearest() -> None:
    legacy = Itinerary.model_validate({"days": [], "travel_mode": "car"})
    assert legacy.grouping == "nearest"
    assert legacy.needed_days is None
    assert TripConfig().day_grouping == "sector"


def test_new_config_defaults() -> None:
    trip = TripConfig()
    assert trip.max_places_per_day is None
    assert trip.max_nearby_per_day == 3
    assert NearbyConfig().service_minutes == 45
    with pytest.raises(ValueError, match="greater than or equal to 1"):
        TripConfig(max_places_per_day=0)


def _nearby_stops(plan: DayPlan) -> list[str]:
    return [s.ref_id or "" for s in plan.stops if s.kind == "nearby"]


def test_nearby_spots_capped_per_day_nearest_first() -> None:
    trip = TripConfig(max_nearby_per_day=2)
    spots = [_spot(f"s{i}", 1 + i * 0.4) for i in range(6)]
    plan = _plan([_place("a", 1), _place("b", 1.5)], spots=spots, trip=trip)
    assert sorted(_nearby_stops(plan)) == ["s0", "s1"]
    assert plan.skipped == []
    assert (
        _nearby_stops(_plan([_place("a", 1)], spots=spots, trip=TripConfig(max_nearby_per_day=0)))
        == []
    )
    assert len(_nearby_stops(_plan([_place("a", 1)], spots=spots))) == 3


def test_nearby_spots_use_their_own_service_minutes() -> None:
    plan = plan_day(
        1,
        zone_ids=["N-1"],
        places=[_place("a", 1)],
        spots=[_spot("near", 1.2)],
        center=CENTER,
        trip=TripConfig(),
        travel_mode="motorbike",
        weekday=SAT,
        matrix_fn=_speed_matrix(20.0),  # type: ignore[arg-type]
    )
    near = next(s for s in plan.stops if s.ref_id == "near")
    assert clock.to_minutes(near.depart) - clock.to_minutes(near.arrive) == 45
    longer = plan_day(
        1,
        zone_ids=["N-1"],
        places=[_place("a", 1)],
        spots=[_spot("near", 1.2)],
        center=CENTER,
        trip=TripConfig(),
        travel_mode="motorbike",
        weekday=SAT,
        matrix_fn=_speed_matrix(20.0),  # type: ignore[arg-type]
        nearby_service=20,
    )
    near = next(s for s in longer.stops if s.ref_id == "near")
    assert clock.to_minutes(near.depart) - clock.to_minutes(near.arrive) == 20


def test_no_nearby_fillers_when_places_do_not_fit() -> None:
    trip = TripConfig(day_start="09:00", day_end="11:00")
    places = [
        _place("sure", 1, category=Category.ATTRACTION, confidence=0.95),
        _place("unsure", 1.2, category=Category.ATTRACTION, confidence=0.4),
    ]
    plan = _plan(places, spots=[_spot("near", 1.1)], trip=trip)
    assert plan.skipped == ["unsure"]
    assert _nearby_stops(plan) == []


def test_needed_days(ctx: Context, caplog: pytest.LogCaptureFixture) -> None:
    assert route.needed_days(23, 3, 7) == 4
    assert route.needed_days(10, 3, 8) == 4
    places = [_place(f"p{i}", 1 + i * 0.2, category=Category.ATTRACTION) for i in range(5)]
    zones = [
        Zone(
            id="N-1",
            sector="N",
            lat=places[0].lat,
            lng=places[0].lng,
            place_ids=[p.id for p in places],
        )
    ]
    save_models(ctx.paths.places_file, places)
    save_model(ctx.paths.spatial_file, SpatialResult(center=CENTER, sectors=8, zones=zones))
    ctx.config.trip.days = 1
    ctx.config.trip.day_start, ctx.config.trip.day_end = "09:00", "13:00"
    ctx.config.plan.mode = "solver"

    route.run(ctx)

    itinerary = load_model(ctx.paths.routes_file, Itinerary)
    placed = sum(s.kind == "place" for s in itinerary.days[0].stops)
    assert 0 < placed < 5
    expected = math.ceil(5 / placed)
    assert itinerary.needed_days == expected
    assert (
        f"5 places need {expected} days at {placed} places/day; consider trip.days: {expected}"
        in caplog.text
    )


def test_cap_places_keeps_most_confident() -> None:
    places = [_place("low", 1, confidence=0.3), _place("hi", 2), _place("mid", 3, confidence=0.6)]
    kept, over = route.cap_places(places, 2)
    assert [p.id for p in kept] == ["hi", "mid"]
    assert [p.id for p in over] == ["low"]
    assert route.cap_places(places, None) == (places, [])
