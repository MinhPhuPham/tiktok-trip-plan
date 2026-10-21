"""Step 8: timed, ordered stops per day.

`plan.mode: agent` (default): write data/plan/prompt.md and travel_minutes.csv for Claude Code,
then turn its data/plan/plan.json into routes.json with the clock computed here.
`plan.mode: solver`: zones → days → OR-Tools route per day.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Sequence
from datetime import timedelta
from functools import partial
from pathlib import Path

from tiktok_trip.config import TripConfig
from tiktok_trip.context import Context
from tiktok_trip.errors import GateError
from tiktok_trip.models import Itinerary, NearbySpot, Place, SpatialResult
from tiktok_trip.planning.collect import collect_plan, render_validation
from tiktok_trip.planning.inputs import build_inputs
from tiktok_trip.planning.prompt import build_plan_prompt
from tiktok_trip.planning.schema import PlanParseError, parse_plan
from tiktok_trip.planning.timing import Issue
from tiktok_trip.routing.days import plan_days
from tiktok_trip.routing.planner import MatrixFn, closed_places, plan_day
from tiktok_trip.routing.travel import log_estimate, travel_matrix
from tiktok_trip.storage import load_model, load_models, save_model

log = logging.getLogger(__name__)

DEFAULT_WEEKDAY = 5


def trip_weekdays(trip: TripConfig, days: int) -> list[int]:
    """Weekday (0=Monday) of each trip day; Saturday for all days when no start date is set."""
    if trip.trip_start_date:
        return [(trip.trip_start_date + timedelta(days=offset)).weekday() for offset in range(days)]
    log.info("No trip start date set; opening hours are checked as if every day is a Saturday.")
    return [DEFAULT_WEEKDAY] * days


def cap_places(places: Sequence[Place], cap: int | None) -> tuple[list[Place], list[Place]]:
    """Keep at most `cap` places, most confident first (route order is the solver's job)."""
    if cap is None or len(places) <= cap:
        return list(places), []
    ranked = sorted(places, key=lambda p: (-p.confidence, p.id))
    kept = {p.id for p in ranked[:cap]}
    return [p for p in places if p.id in kept], [p for p in places if p.id not in kept]


def needed_days(total: int, days: int, per_day: int) -> int:
    """Days for `total` places at `per_day` a day; always more than the `days` that did not fit."""
    return max(days + 1, math.ceil(total / max(per_day, 1)))


def build_itinerary(
    places: Sequence[Place],
    spatial: SpatialResult,
    spots: Sequence[NearbySpot],
    ctx: Context,
    matrix_fn: MatrixFn,
) -> Itinerary:
    trip = ctx.config.trip
    active = {p.id: p for p in places if p.status != "skip"}
    counts = {z.id: sum(pid in active for pid in z.place_ids) for z in spatial.zones}
    zones_by_id = {z.id: z for z in spatial.zones}
    unzoned = set(active) - {pid for z in spatial.zones for pid in z.place_ids}
    if unzoned:
        log.warning("%d places have no zone; re-run the spatial step.", len(unzoned))

    day_zones = plan_days(
        spatial.zones,
        counts,
        trip.days,
        trip.max_zones_per_day,
        grouping=trip.day_grouping,
        sectors=spatial.sectors,
        max_places_per_day=trip.max_places_per_day,
    )
    planned = {zid for zone_ids in day_zones for zid in zone_ids}
    left_out = sum(counts[z.id] for z in spatial.zones if z.id not in planned)
    weekdays = trip_weekdays(trip, len(day_zones))
    plans = []
    full_days: list[int] = []
    for number, (zone_ids, weekday) in enumerate(zip(day_zones, weekdays, strict=True), start=1):
        day_places = [
            active[pid] for zid in zone_ids for pid in zones_by_id[zid].place_ids if pid in active
        ]
        day_places, over_cap = cap_places(day_places, trip.max_places_per_day)
        plan = plan_day(
            number,
            zone_ids=zone_ids,
            places=day_places,
            spots=[s for s in spots if s.zone_id in zone_ids],
            center=spatial.center,
            trip=trip,
            travel_mode=ctx.config.travel.mode,
            weekday=weekday,
            matrix_fn=matrix_fn,
            nearby_service=ctx.config.nearby.service_minutes,
        )
        plan.skipped.extend(p.id for p in over_cap)
        placed = sum(s.kind == "place" for s in plan.stops)
        dropped = set(plan.skipped) - closed_places(day_places, weekday, trip)
        if dropped:
            full_days.append(placed)
            left_out += len(dropped)
        log.info(
            "Day %d (%s): %d places, %d nearby, %d min, %d skipped",
            number,
            ", ".join(zone_ids),
            placed,
            sum(s.kind == "nearby" for s in plan.stops),
            plan.total_minutes,
            len(plan.skipped),
        )
        plans.append(plan)
    itinerary = Itinerary(
        days=plans, travel_mode=ctx.config.travel.mode, grouping=trip.day_grouping
    )
    if left_out and len(day_zones) < trip.days:
        log.warning(
            "%d places do not fit although only %d of %d days are used: a zone holds more than a "
            "day; lower spatial.cluster_eps_km to split it.",
            left_out,
            len(day_zones),
            trip.days,
        )
    elif left_out:
        per_day = min([*full_days, trip.max_places_per_day or len(active)])
        itinerary.needed_days = needed_days(len(active), trip.days, per_day)
        log.warning(
            "%d of %d places do not fit %d days: %d places need %d days at %d places/day; "
            "consider trip.days: %d",
            left_out,
            len(active),
            trip.days,
            len(active),
            itinerary.needed_days,
            per_day,
            itinerary.needed_days,
        )
    return itinerary


def write_if_changed(path: Path, text: str) -> bool:
    """Keep the file (and its mtime) when the content is the same; True when written."""
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return True


def _issue_summary(issues: list[Issue], limit: int = 12) -> str:
    lines = [
        f"  - {'day ' + str(i.day) + ' ' if i.day else ''}{i.stop or ''} [{i.rule}] {i.message}"
        for i in issues[:limit]
    ]
    if len(issues) > limit:
        lines.append(f"  - ... {len(issues) - limit} more")
    return "\n".join(lines)


def run_agent(
    ctx: Context,
    places: Sequence[Place],
    spatial: SpatialResult,
    spots: Sequence[NearbySpot],
    *,
    collect: bool = False,
) -> None:
    """Prompt for Claude Code, then validate its plan.json and write routes.json from it."""
    paths = ctx.paths
    inputs = build_inputs(
        ctx.config,
        spatial.center,
        places,
        spots,
        partial(travel_matrix, mode=ctx.config.travel.mode),
    )
    write_if_changed(paths.plan_matrix, inputs.matrix.to_csv())
    prompt = build_plan_prompt(
        inputs,
        ctx.config,
        matrix_path=paths.plan_matrix,
        output_path=paths.plan_json,
    )
    if write_if_changed(paths.plan_prompt, prompt):
        log.info("Plan prompt written: %s", paths.plan_prompt)
    log.info(
        "%d places, %d nearby spots, matrix %dx%d → %s",
        len(inputs.places),
        len(inputs.spots),
        *inputs.matrix.shape,
        paths.plan_matrix,
    )
    fresh = paths.plan_json.exists() and (
        collect or paths.plan_json.stat().st_mtime_ns > paths.plan_prompt.stat().st_mtime_ns
    )
    if not fresh:
        state = "is older than the prompt" if paths.plan_json.exists() else "is missing"
        log.warning("plan prompt waiting for Claude Code (%s %s)", paths.plan_json, state)
        raise GateError(
            f"Plan prompt waiting for Claude Code: {paths.plan_json} {state}. Read "
            f"{paths.plan_prompt}, write plan.json, then run `uv run tiktok-trip route` "
            "(or use /plan). routes.json was left as it was."
        )
    try:
        plan = parse_plan(paths.plan_json.read_text(encoding="utf-8"))
    except PlanParseError as exc:
        write_if_changed(paths.plan_validation, render_validation(None, parse_error=str(exc)))
        raise GateError(
            f"{paths.plan_json} could not be read: {exc}. Fix it and run the route step again."
        ) from None
    result = collect_plan(plan, inputs, ctx.config)
    write_if_changed(paths.plan_validation, render_validation(result))
    if result.errors:
        raise GateError(
            f"{len(result.errors)} hard violation(s) in {paths.plan_json} "
            f"(details and fixes in {paths.plan_validation}); routes.json was left as it was:\n"
            + _issue_summary(result.errors)
        )
    save_model(paths.routes_file, result.itinerary)
    for day in result.itinerary.days:
        log.info(
            "Day %d: %d places, %d nearby, %s to %s",
            day.day,
            sum(s.kind == "place" for s in day.stops),
            sum(s.kind == "nearby" for s in day.stops),
            day.stops[0].depart if day.stops else "-",
            day.stops[-1].arrive if day.stops else "-",
        )
    log.info(
        "Plan by Claude Code: %d days, %d unplaced, %d warning(s) → %s",
        len(result.itinerary.days),
        len(result.itinerary.unplaced),
        len(result.warnings),
        paths.routes_file,
    )


def run(ctx: Context, *, collect: bool = False) -> None:
    if not ctx.paths.spatial_file.exists():
        raise RuntimeError(f"{ctx.paths.spatial_file} is missing. Run the spatial step first.")
    spatial = load_model(ctx.paths.spatial_file, SpatialResult)
    places = load_models(ctx.paths.places_file, Place)
    if not ctx.paths.nearby_file.exists():
        log.warning("%s is missing; routing without nearby spots.", ctx.paths.nearby_file)
    spots = load_models(ctx.paths.nearby_file, NearbySpot)
    log_estimate(ctx.config.travel.mode)
    if ctx.config.plan.mode == "agent":
        run_agent(ctx, places, spatial, spots, collect=collect)
        return
    matrix_fn = partial(travel_matrix, mode=ctx.config.travel.mode)
    itinerary = build_itinerary(places, spatial, spots, ctx, matrix_fn)
    save_model(ctx.paths.routes_file, itinerary)
    log.info("%d days → %s", len(itinerary.days), ctx.paths.routes_file)
