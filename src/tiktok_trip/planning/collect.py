"""Turn plan.json into a timed Itinerary, with every rule violation listed for validation.md."""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field

from tiktok_trip.clock import EN_DASH
from tiktok_trip.config import AppConfig
from tiktok_trip.models import Itinerary, UnplacedPlace
from tiktok_trip.planning.inputs import PlanInputs
from tiktok_trip.planning.schema import REST_REF, AgentPlan
from tiktok_trip.planning.timing import Issue, time_day

AGENT_GROUPING = "agent"


@dataclass
class CollectResult:
    itinerary: Itinerary
    issues: list[Issue] = field(default_factory=list)

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "error"]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "warning"]


def _name(inputs: PlanInputs, ref: str) -> str:
    node = inputs.nodes.get(ref)
    return f"{node.name} ({ref})" if node else ref


def coverage_issues(plan: AgentPlan, inputs: PlanInputs, config: AppConfig) -> list[Issue]:
    """Trip-wide rules: day count, every place exactly once, caps per day, known refs."""
    used = Counter(s.ref for day in plan.days for s in day.stops if s.ref != REST_REF)
    return [
        *_day_count_issues(plan, config),
        *_usage_issues(plan, inputs, used),
        *_cap_issues(plan, inputs, config),
    ]


def _day_count_issues(plan: AgentPlan, config: AppConfig) -> list[Issue]:
    issues: list[Issue] = []
    trip = config.trip
    if len(plan.days) > trip.days:
        issues.append(
            Issue(
                "error",
                "too_many_days",
                f"{len(plan.days)} days planned but trip.days is {trip.days}",
                f"use at most {trip.days} days; list what does not fit under `unplaced` "
                "with code 'out_of_days'",
            )
        )
    return issues


def _usage_issues(plan: AgentPlan, inputs: PlanInputs, used: Counter[str]) -> list[Issue]:
    issues: list[Issue] = []
    for ref, count in sorted(used.items()):
        if count > 1 and ref in inputs.nodes:
            issues.append(
                Issue(
                    "error",
                    "duplicate",
                    f"{_name(inputs, ref)} is planned {count} times",
                    "keep it in one day only",
                    stop=inputs.nodes[ref].name,
                )
            )
    unplaced = Counter(u.ref for u in plan.unplaced)
    for ref, count in sorted(unplaced.items()):
        node = inputs.nodes.get(ref)
        if node is None or node.kind != "place":
            issues.append(
                Issue(
                    "error",
                    "unknown_ref",
                    f"unplaced '{ref}' is not a place id",
                    "list only place ids from the places table under `unplaced`",
                    stop=ref,
                )
            )
        elif ref in used:
            issues.append(
                Issue(
                    "error",
                    "duplicate",
                    f"{_name(inputs, ref)} is both planned and unplaced",
                    "keep it in a day or under `unplaced`, not both",
                    stop=node.name,
                )
            )
        elif count > 1:
            issues.append(
                Issue(
                    "error",
                    "duplicate",
                    f"{_name(inputs, ref)} is listed {count} times under `unplaced`",
                    "list it once",
                    stop=node.name,
                )
            )
        elif node.place is not None and node.place.priority == "must":
            issues.append(
                Issue(
                    "warning",
                    "must_unplaced",
                    f"{_name(inputs, ref)} is a must-go place but is under `unplaced`",
                    "plan it on a day where it is open; leave it out only when it is closed on "
                    "every trip day",
                    stop=node.name,
                )
            )
    for item in plan.unplaced:
        node = inputs.nodes.get(item.ref)
        if node is not None and item.code is None:
            issues.append(
                Issue(
                    "warning",
                    "unplaced_code",
                    f"{_name(inputs, item.ref)} is under `unplaced` without a code",
                    "add `code`: out_of_days, too_far, low_priority, closed, out_of_window or "
                    "other",
                    stop=node.name,
                )
            )
    for place in inputs.places:
        if place.id not in used and place.id not in unplaced:
            issues.append(
                Issue(
                    "error",
                    "missing_place",
                    f"{place.name} ({place.id}) is in no day and not under `unplaced`",
                    "add it to a day in its direction, or to `unplaced` with a code "
                    "(closed, too_far, out_of_days, low_priority, out_of_window, other)",
                    stop=place.name,
                )
            )
    return issues


def _cap_issues(plan: AgentPlan, inputs: PlanInputs, config: AppConfig) -> list[Issue]:
    issues: list[Issue] = []
    trip = config.trip
    for number, day in enumerate(plan.days, start=1):
        kinds = Counter(
            node.kind for s in day.stops if (node := inputs.nodes.get(s.ref)) is not None
        )
        cap = trip.max_places_per_day
        if cap is not None and kinds["place"] > cap:
            issues.append(
                Issue(
                    "error",
                    "max_places_per_day",
                    f"{kinds['place']} places, more than trip.max_places_per_day ({cap})",
                    "move places to a lighter day or to `unplaced`",
                    day=number,
                )
            )
        if kinds["nearby"] > trip.max_nearby_per_day:
            issues.append(
                Issue(
                    "error",
                    "max_nearby_per_day",
                    f"{kinds['nearby']} nearby spots, more than trip.max_nearby_per_day "
                    f"({trip.max_nearby_per_day})",
                    "drop the nearby spots that fill the least time",
                    day=number,
                )
            )
        if day.day is not None and day.day != number:
            issues.append(
                Issue(
                    "warning",
                    "day_number",
                    f"day {day.day} is in position {number}; days are numbered by position",
                    "list the days in order 1, 2, 3, ...",
                    day=number,
                )
            )
    return issues


def collect_plan(plan: AgentPlan, inputs: PlanInputs, config: AppConfig) -> CollectResult:
    issues = coverage_issues(plan, inputs, config)
    days = []
    for number, day in enumerate(plan.days, start=1):
        timing = time_day(number, day.stops, inputs, config.plan, travel_mode=config.travel.mode)
        days.append(timing.plan)
        issues.extend(timing.issues)
    itinerary = Itinerary(
        days=days,
        travel_mode=config.travel.mode,
        grouping=AGENT_GROUPING,
        unplaced=[
            UnplacedPlace(ref_id=u.ref, reason=u.reason, code=u.code)
            for u in plan.unplaced
            if u.ref in inputs.nodes
        ],
    )
    return CollectResult(itinerary=itinerary, issues=issues)


def _issue_line(issue: Issue) -> str:
    where = " · ".join(
        part for part in (f"day {issue.day}" if issue.day else "", issue.stop or "") if part
    )
    prefix = f"**{where}** " if where else ""
    return f"- {prefix}[{issue.rule}] {issue.message}. Fix: {issue.suggestion}."


def render_validation(result: CollectResult | None, *, parse_error: str | None = None) -> str:
    lines = ["# Plan validation", ""]
    if parse_error is not None:
        lines += [
            "Status: **FAILED**, plan.json could not be read.",
            "",
            f"- {parse_error}",
            "",
            "Rewrite data/plan/plan.json as JSON matching the schema in data/plan/prompt.md.",
        ]
        return "\n".join(lines) + "\n"
    assert result is not None
    errors, warnings = result.errors, result.warnings
    status = "**FAILED**" if errors else "**OK**"
    lines.append(
        f"Status: {status}: {len(errors)} hard violation(s), {len(warnings)} warning(s). "
        + (
            "data/routes.json was NOT updated; fix plan.json and run `uv run tiktok-trip route`."
            if errors
            else "data/routes.json was written."
        )
    )
    lines += ["", "## Hard violations (must fix)", ""]
    lines += [_issue_line(i) for i in errors] or ["None."]
    lines += ["", "## Warnings (fix when it does not break a hard rule)", ""]
    lines += [_issue_line(i) for i in warnings] or ["None."]
    lines += ["", "## Computed clock", ""]
    lines += _clock_lines(result)
    return "\n".join(lines) + "\n"


def _clock_lines(result: CollectResult) -> Sequence[str]:
    lines: list[str] = []
    for day in result.itinerary.days:
        lines.append(f"### Day {day.day}")
        for stop in day.stops:
            slot = f" [{stop.slot}]" if stop.slot else ""
            leg = f" → {stop.travel_min_to_next} min" if stop.travel_min_to_next is not None else ""
            lines.append(
                f"- {stop.arrive}{EN_DASH}{stop.depart} {stop.kind}: {stop.name}{slot}{leg}"
            )
        lines.append("")
    return lines or ["(no days)"]
