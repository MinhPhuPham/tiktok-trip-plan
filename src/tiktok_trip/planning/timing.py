"""The clock of an agent plan, computed in code: arrive, leave, travel, and the rule checks."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import combinations, pairwise
from typing import Literal

from tiktok_trip.clock import to_hhmm, to_minutes
from tiktok_trip.config import PlanConfig, RhythmSlot
from tiktok_trip.export.i18n import EN, opening_hours
from tiktok_trip.geo import sector_gap_deg
from tiktok_trip.models import DayPlan, Hours, RouteStop
from tiktok_trip.planning.inputs import PlanInputs, PlanNode
from tiktok_trip.planning.matrix import CENTER_ID
from tiktok_trip.planning.schema import PlanStop
from tiktok_trip.routing.maps import TRAVELMODES, directions_urls
from tiktok_trip.routing.windows import opening_intervals, parse_hour_range

LONG_LEG_MIN = 40
LONG_WAIT_MIN = 60
MIN_REST_MIN = 30
DEFAULT_REST_MIN = 60
MAX_SECTOR_GAP_DEG = 90.0

Level = Literal["error", "warning"]


@dataclass(frozen=True)
class Issue:
    level: Level
    rule: str
    message: str
    suggestion: str
    day: int | None = None
    stop: str | None = None


@dataclass(frozen=True)
class DayTiming:
    plan: DayPlan
    issues: list[Issue]


def opening_fit(
    hours: Hours | None, weekday: int, earliest: int, service: int
) -> tuple[int | None, bool]:
    """(arrival, closed_all_day): the first moment at or after `earliest` with time for the whole
    visit before closing; None when no opening period leaves room. Unknown hours count as open."""
    intervals = opening_intervals(hours, weekday)
    if intervals is None:
        return earliest, False
    for lo, hi in intervals:
        start = max(earliest, lo)
        if start + service <= hi:
            return start, False
    return None, not intervals


def hours_text(hours: Hours | None) -> str:
    return opening_hours(EN, hours) or "unknown"


@dataclass
class _DayChecker:
    number: int
    issues: list[Issue]

    def add(self, level: Level, rule: str, message: str, suggestion: str, stop: str = "") -> None:
        self.issues.append(
            Issue(level, rule, message, suggestion, day=self.number, stop=stop or None)
        )


def _visit_service(node: PlanNode, slot: RhythmSlot | None, arrive: int) -> int:
    if node.kind != "rest":
        return node.service
    if slot is None:
        return DEFAULT_REST_MIN
    return max(to_minutes(slot.end) - arrive, MIN_REST_MIN)


def _route_stop(
    node: PlanNode, inputs: PlanInputs, stop: PlanStop | None, arrive: int, depart: int
) -> RouteStop:
    kind = node.kind
    return RouteStop(
        kind=kind,
        ref_id=None if kind == "rest" else node.ref,
        name=inputs.center.label if kind == "rest" else node.name,
        lat=node.point[0],
        lng=node.point[1],
        arrive=to_hhmm(arrive),
        depart=to_hhmm(depart),
        slot=stop.slot if stop else None,
        reason=stop.reason if stop else None,
        reason_vi=stop.reason_vi if stop else None,
    )


def _center_stop(kind: Literal["start", "end"], inputs: PlanInputs, at: int) -> RouteStop:
    center = inputs.center
    return RouteStop(
        kind=kind,
        name=center.label,
        lat=center.lat,
        lng=center.lng,
        arrive=to_hhmm(at),
        depart=to_hhmm(at),
    )


def _check_visit(
    check: _DayChecker,
    node: PlanNode,
    slot: RhythmSlot | None,
    arrive: int,
) -> None:
    place = node.place
    if place is None:
        return
    if (deadline := place.best_time.deadline if place.best_time else None) and arrive > to_minutes(
        deadline
    ):
        check.add(
            "error",
            "deadline",
            f"arrives {to_hhmm(arrive)}, after its deadline {deadline} (sells out / closes early)",
            f"move {node.name} to an earlier slot or day so it starts before {deadline}",
            node.name,
        )
    if slot and slot.categories and place.category not in slot.categories:
        allowed = ", ".join(c.value for c in slot.categories)
        check.add(
            "warning",
            "slot_category",
            f"a {place.category.value} place in the '{slot.id}' slot (suits {allowed})",
            f"move {node.name} to a slot for {place.category.value} places if the day allows",
            node.name,
        )
    best = place.best_time
    if best and best.source != "heuristic" and (window := parse_hour_range(best.hours)):
        lo, hi = window
        if not lo <= arrive <= hi:
            check.add(
                "warning",
                "best_time",
                f"arrives {to_hhmm(arrive)}, outside its best time {best.hours} ({best.source})",
                f"put {node.name} in a slot that overlaps {best.hours}",
                node.name,
            )


def _check_sectors(check: _DayChecker, nodes: Sequence[PlanNode]) -> None:
    sectors = sorted({s for n in nodes if (s := n.sector)})
    for a, b in combinations(sectors, 2):
        gap = sector_gap_deg(a, b)
        if gap is not None and gap > MAX_SECTOR_GAP_DEG:
            check.add(
                "warning",
                "directions",
                f"mixes directions {a} and {b} ({gap:.0f} degrees apart) in one day",
                "keep a day inside one or two neighbouring directions; swap places between days",
            )
            return


Resolved = tuple[PlanStop, PlanNode, RhythmSlot | None]


def _resolve(
    check: _DayChecker, stops: Sequence[PlanStop], inputs: PlanInputs, plan_cfg: PlanConfig
) -> list[Resolved]:
    resolved: list[Resolved] = []
    for stop in stops:
        node = inputs.nodes.get(stop.ref)
        if node is None:
            check.add(
                "error",
                "unknown_ref",
                f"'{stop.ref}' is not a place id, nearby spot id or 'rest'",
                "use an id from the places or nearby tables of the prompt, or 'rest'",
                stop.ref,
            )
            continue
        slot = plan_cfg.slot(stop.slot)
        if stop.slot and slot is None:
            check.add(
                "error",
                "unknown_slot",
                f"slot '{stop.slot}' is not in the rhythm",
                "use one of: " + ", ".join(s.id for s in plan_cfg.rhythm),
                node.name,
            )
        elif not stop.slot:
            check.add(
                "warning",
                "missing_slot",
                "stop has no slot",
                "give every stop the rhythm slot id it fills",
                node.name,
            )
        resolved.append((stop, node, slot))
    return resolved


def _arrival(
    check: _DayChecker, node: PlanNode, slot: RhythmSlot | None, weekday: int, earliest: int
) -> int:
    """Not before the slot starts (rest starts on arrival), then the first opening that fits."""
    arrive = earliest
    if node.kind != "rest" and slot is not None:
        arrive = max(arrive, to_minutes(slot.start))
    if node.place is None:
        return arrive
    fitted, closed_day = opening_fit(node.place.hours, weekday, arrive, node.service)
    if fitted is not None:
        return fitted
    when = "is closed that day" if closed_day else "has no time left before closing"
    check.add(
        "error",
        "closed",
        f"arrives {to_hhmm(arrive)} but {when} "
        f"(hours: {hours_text(node.place.hours)}; needs {node.service} min)",
        f"move {node.name} to a slot or day when it is open, or list it under "
        "`unplaced` with code 'closed'",
        node.name,
    )
    return arrive


def _check_order(check: _DayChecker, resolved: Sequence[Resolved], plan_cfg: PlanConfig) -> None:
    latest = -1
    for stop, node, _ in resolved:
        index = plan_cfg.slot_index(stop.slot)
        if index is None:
            continue
        if index < latest:
            check.add(
                "warning",
                "slot_order",
                f"slot '{stop.slot}' comes after a later slot of the rhythm",
                "order the stops of a day by the rhythm (sunrise, breakfast, ... evening)",
                node.name,
            )
        latest = max(latest, index)


def _check_legs(check: _DayChecker, route: Sequence[RouteStop]) -> None:
    for here, there in pairwise(route):
        travel = here.travel_min_to_next or 0
        if travel > LONG_LEG_MIN:
            check.add(
                "warning",
                "long_leg",
                f"{travel} min from {here.name} to {there.name}",
                "reorder the day or move this stop to a day in its direction",
                there.name,
            )


def time_day(
    number: int,
    stops: Sequence[PlanStop],
    inputs: PlanInputs,
    plan_cfg: PlanConfig,
    *,
    travel_mode: str,
) -> DayTiming:
    """Clock for one day: leave the center, visit the stops in the given order, come back.

    arrive = max(previous leave + travel, slot start, opening time); leave = arrive + service.
    A rest stop starts on arrival and lasts until its slot ends (at least 30 minutes).
    """
    issues: list[Issue] = []
    check = _DayChecker(number, issues)
    weekday = inputs.weekday(number - 1)
    day_start, day_end = to_minutes(plan_cfg.day_start), to_minutes(plan_cfg.day_end)
    resolved = _resolve(check, stops, inputs, plan_cfg)
    plan = DayPlan(day=number)
    if not resolved:
        check.add("warning", "empty_day", "day has no stops", "add stops or drop the day")
        return DayTiming(plan, issues)

    route: list[RouteStop] = []
    previous, clock = CENTER_ID, day_start
    for stop, node, slot in resolved:
        travel = inputs.matrix.between(previous, node.matrix_id)
        earliest = clock + travel
        arrive = _arrival(check, node, slot, weekday, earliest)
        if not route:
            leave_center = max(day_start, arrive - travel)
            route.append(_center_stop("start", inputs, leave_center))
            earliest = leave_center + travel
        elif arrive - earliest >= LONG_WAIT_MIN and node.kind != "rest":
            check.add(
                "warning",
                "long_wait",
                f"waits {arrive - earliest} min before {node.name} "
                f"(arrives {to_hhmm(earliest)}, starts {to_hhmm(arrive)})",
                "fill the gap with a nearby spot or move the stop to an earlier slot",
                node.name,
            )
        route[-1].travel_min_to_next = travel
        depart = arrive + _visit_service(node, slot, arrive)
        _check_visit(check, node, slot, arrive)
        if depart > day_end:
            check.add(
                "error",
                "day_end",
                f"leaves {to_hhmm(depart)}, after the day ends at {plan_cfg.day_end}",
                f"move {node.name} (or an earlier stop of day {number}) to another day, "
                "or list it under `unplaced`",
                node.name,
            )
        route.append(_route_stop(node, inputs, stop, arrive, depart))
        previous, clock = node.matrix_id, depart

    back = inputs.matrix.between(previous, CENTER_ID)
    route[-1].travel_min_to_next = back
    end = clock + back
    route.append(_center_stop("end", inputs, end))
    if end > day_end:
        check.add(
            "warning",
            "late_return",
            f"back at the center at {to_hhmm(end)}, after {plan_cfg.day_end}",
            "end the day nearer to the center",
        )
    _check_order(check, resolved, plan_cfg)
    _check_legs(check, route)
    _check_sectors(check, [node for _, node, _ in resolved])

    plan.stops = route
    plan.total_minutes = to_minutes(route[-1].arrive) - to_minutes(route[0].depart)
    plan.zone_ids = list(dict.fromkeys(z for _, node, _ in resolved if (z := node.zone)))
    plan.maps_urls = directions_urls(
        [(s.lat, s.lng) for s in route], TRAVELMODES.get(travel_mode, "driving")
    )
    return DayTiming(plan, issues)
