"""Turn one day's places and nearby spots into a timed DayPlan."""

from __future__ import annotations

import logging
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from tiktok_trip import geo
from tiktok_trip.clock import to_hhmm, to_minutes
from tiktok_trip.config import NearbyConfig, TripConfig
from tiktok_trip.geo import LatLng
from tiktok_trip.models import (
    Category,
    Center,
    DayPlan,
    NearbySpot,
    Place,
    RouteStop,
    StopKind,
)
from tiktok_trip.routing.maps import TRAVELMODES, directions_urls
from tiktok_trip.routing.solver import SPAN_COST, TRAVEL_COST_SCALE, Node, Solution, solve
from tiktok_trip.routing.windows import (
    DINNER,
    LUNCH,
    Interval,
    arrival_windows,
    meal_window,
)

log = logging.getLogger(__name__)

MANDATORY_PENALTY = 1_000_000
NEARBY_DETOUR_BUDGET_MIN = 45
DEFAULT_SERVICE = 30
DEFAULT_NEARBY_SERVICE = NearbyConfig().service_minutes

MatrixFn = Callable[[Sequence[LatLng]], list[list[float]]]


@dataclass(frozen=True)
class Visit:
    kind: StopKind
    ref_id: str
    name: str
    point: LatLng
    service: int
    windows: list[Interval]
    relaxed_windows: list[Interval]
    penalty: int
    mandatory: bool
    meal_eligible: bool


def service_minutes(trip: TripConfig, category: Category) -> int:
    return trip.service_minutes.get(
        category, trip.service_minutes.get(Category.OTHER, DEFAULT_SERVICE)
    )


def mandatory_penalty(confidence: float) -> int:
    """Far above any travel cost; lower confidence is cheaper to drop."""
    return MANDATORY_PENALTY + int(confidence * MANDATORY_PENALTY)


def nearby_penalty(service: int) -> int:
    return NEARBY_DETOUR_BUDGET_MIN * TRAVEL_COST_SCALE + service * SPAN_COST


def place_visit(place: Place, weekday: int, trip: TripConfig, day: Interval) -> Visit:
    service = service_minutes(trip, place.category)
    strict = arrival_windows(place.hours, place.best_time, weekday, service, day)
    relaxed = arrival_windows(
        place.hours, place.best_time, weekday, service, day, use_best_time=False
    )
    has_best_hours = bool(place.best_time and place.best_time.hours)
    return Visit(
        kind="place",
        ref_id=place.id,
        name=place.name,
        point=(place.lat, place.lng),
        service=service,
        windows=strict,
        relaxed_windows=relaxed,
        penalty=mandatory_penalty(place.confidence),
        mandatory=True,
        meal_eligible=place.category is Category.FOOD and not has_best_hours,
    )


def spot_visit(
    spot: NearbySpot, weekday: int, day: Interval, service: int = DEFAULT_NEARBY_SERVICE
) -> Visit:
    windows = arrival_windows(None, None, weekday, service, day)
    return Visit(
        kind="nearby",
        ref_id=spot.id,
        name=spot.name,
        point=(spot.lat, spot.lng),
        service=service,
        windows=windows,
        relaxed_windows=windows,
        penalty=nearby_penalty(service),
        mandatory=False,
        meal_eligible=False,
    )


def _nodes(
    visits: Sequence[Visit], *, relaxed: bool, soft: dict[int, Interval] | None = None
) -> list[Node]:
    return [
        Node(
            service=v.service,
            windows=v.relaxed_windows if relaxed else v.windows,
            penalty=v.penalty,
            soft=(soft or {}).get(i),
        )
        for i, v in enumerate(visits, start=1)
    ]


def _dropped_mandatory(solution: Solution | None, visits: Sequence[Visit]) -> int:
    if solution is None:
        return sum(v.mandatory for v in visits)
    return sum(visits[i - 1].mandatory for i in solution.dropped)


def _meal_nudges(
    solution: Solution, visits: Sequence[Visit], *, relaxed: bool
) -> dict[int, Interval]:
    """First half of the day's food stops (in route order) lean to lunch, the rest to dinner."""
    food = [n for n in solution.order if visits[n - 1].meal_eligible]
    lunch_count = math.ceil(len(food) / 2)
    soft: dict[int, Interval] = {}
    for rank, node_id in enumerate(food):
        visit = visits[node_id - 1]
        windows = visit.relaxed_windows if relaxed else visit.windows
        if meal := meal_window(windows, LUNCH if rank < lunch_count else DINNER):
            soft[node_id] = meal
    return soft


def schedule(
    visits: Sequence[Visit], travel: Sequence[Sequence[int]], day: Interval
) -> Solution | None:
    """Solve with best-time windows, relax them if that drops places, then nudge meals."""
    best = solve(_nodes(visits, relaxed=False), travel, day)
    best_relaxed = False
    has_relaxable = any(v.windows != v.relaxed_windows for v in visits)
    if has_relaxable and _dropped_mandatory(best, visits) > 0:
        relaxed = solve(_nodes(visits, relaxed=True), travel, day)
        if _dropped_mandatory(relaxed, visits) < _dropped_mandatory(best, visits):
            log.info("Best-time windows relaxed to fit more places.")
            best, best_relaxed = relaxed, True
    if best is None:
        return None
    soft = _meal_nudges(best, visits, relaxed=best_relaxed)
    if soft:
        nudged = solve(_nodes(visits, relaxed=best_relaxed, soft=soft), travel, day)
        if nudged is not None and _dropped_mandatory(nudged, visits) <= _dropped_mandatory(
            best, visits
        ):
            best = nudged
    return best


def _stop(
    kind: StopKind,
    ref_id: str | None,
    name: str,
    point: LatLng,
    *,
    arrive: int,
    depart: int,
    travel_next: int | None,
) -> RouteStop:
    return RouteStop(
        kind=kind,
        ref_id=ref_id,
        name=name,
        lat=point[0],
        lng=point[1],
        arrive=to_hhmm(arrive),
        depart=to_hhmm(depart),
        travel_min_to_next=travel_next,
    )


def _stops(
    solution: Solution, visits: Sequence[Visit], travel: Sequence[Sequence[int]], center: Center
) -> list[RouteStop]:
    origin = (center.lat, center.lng)
    first = solution.order[0]
    stops = [
        _stop(
            "start",
            None,
            center.label,
            origin,
            arrive=solution.start,
            depart=solution.start,
            travel_next=travel[0][first],
        )
    ]
    for node_id, following in zip(solution.order, [*solution.order[1:], 0], strict=True):
        visit = visits[node_id - 1]
        arrive = solution.arrivals[node_id]
        stops.append(
            _stop(
                visit.kind,
                visit.ref_id,
                visit.name,
                visit.point,
                arrive=arrive,
                depart=arrive + visit.service,
                travel_next=travel[node_id][following],
            )
        )
    stops.append(
        _stop(
            "end",
            None,
            center.label,
            origin,
            arrive=solution.end,
            depart=solution.end,
            travel_next=None,
        )
    )
    return stops


def day_window(trip: TripConfig) -> Interval:
    return to_minutes(trip.day_start), to_minutes(trip.day_end)


def closed_places(places: Sequence[Place], weekday: int, trip: TripConfig) -> set[str]:
    """Places with no time for a visit on that weekday (closed, or open too briefly)."""
    day = day_window(trip)
    return {p.id for p in places if not place_visit(p, weekday, trip, day).relaxed_windows}


def nearest_fillers(spots: Sequence[Visit], route: Sequence[LatLng], limit: int) -> list[Visit]:
    """At most `limit` spots, nearest (straight line) to any point of the route first."""
    if limit <= 0 or not route:
        return []

    def gap(visit: Visit) -> tuple[float, str]:
        return min(geo.distance_km(visit.point, point) for point in route), visit.ref_id

    return sorted(spots, key=gap)[:limit]


def _sub(travel: Sequence[Sequence[int]], size: int) -> list[list[int]]:
    return [list(row[:size]) for row in travel[:size]]


def plan_day(
    day_number: int,
    *,
    zone_ids: Sequence[str],
    places: Sequence[Place],
    spots: Sequence[NearbySpot],
    center: Center,
    trip: TripConfig,
    travel_mode: str,
    weekday: int,
    matrix_fn: MatrixFn,
    nearby_service: int = DEFAULT_NEARBY_SERVICE,
) -> DayPlan:
    """Mandatory places, scheduled from and back to the center; nearby spots only as fillers.

    Up to `trip.max_nearby_per_day` spots (nearest to the day's places) are offered to the solver
    only when every open place fits the day; they stay optional and are dropped if they do not fit.
    """
    day = day_window(trip)
    plan = DayPlan(day=day_number, zone_ids=list(zone_ids))
    visits: list[Visit] = []
    for place in places:
        visit = place_visit(place, weekday, trip, day)
        if visit.relaxed_windows:
            visits.append(visit)
        else:
            log.info("Day %d: %s is closed or has no time for a visit.", day_number, place.name)
            plan.skipped.append(place.id)
    origin = (center.lat, center.lng)
    open_spots = [v for s in spots if (v := spot_visit(s, weekday, day, nearby_service)).windows]
    fillers = nearest_fillers(
        open_spots, [v.point for v in visits] or [origin], trip.max_nearby_per_day
    )
    if not visits and not fillers:
        return plan

    raw = matrix_fn([origin, *(v.point for v in visits), *(v.point for v in fillers)])
    travel = [[math.ceil(value - 1e-9) for value in row] for row in raw]
    places_travel = _sub(travel, len(visits) + 1)
    solution = schedule(visits, places_travel, day) if visits else None
    if visits and solution is None:
        plan.skipped.extend(v.ref_id for v in visits if v.mandatory)
        return plan
    used, used_travel = visits, places_travel
    if fillers and (solution is None or _dropped_mandatory(solution, visits) == 0):
        combined = [*visits, *fillers]
        with_fillers = schedule(combined, travel, day)
        if with_fillers is not None and _dropped_mandatory(with_fillers, combined) == 0:
            solution, used, used_travel = with_fillers, combined, travel
    if solution is None:
        return plan
    plan.skipped.extend(used[i - 1].ref_id for i in solution.dropped if used[i - 1].mandatory)
    if not solution.order:
        return plan
    plan.stops = _stops(solution, used, used_travel, center)
    plan.total_minutes = solution.end - solution.start
    plan.maps_urls = directions_urls(
        [(s.lat, s.lng) for s in plan.stops], TRAVELMODES.get(travel_mode, "driving")
    )
    return plan
