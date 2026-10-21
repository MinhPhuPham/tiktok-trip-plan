"""The plan prompt Claude Code answers with data/plan/plan.json (agent mode of the route step)."""

from __future__ import annotations

import json
import math
from dataclasses import replace
from pathlib import Path
from string import Template

from tiktok_trip.clock import EN_DASH
from tiktok_trip.config import REST_SLOT, AppConfig, PlanConfig, RhythmSlot, TripConfig
from tiktok_trip.export.dataset import price_text
from tiktok_trip.export.i18n import EN, opening_hours
from tiktok_trip.geo import distance_km
from tiktok_trip.models import NearbySpot, Place
from tiktok_trip.planning.inputs import PlanInputs
from tiktok_trip.planning.matrix import CENTER_ID
from tiktok_trip.planning.timing import LONG_LEG_MIN
from tiktok_trip.priority import rank
from tiktok_trip.routing.windows import opening_intervals

TEMPLATE_FILE = Path(__file__).with_name("prompt_template.md")
CLOCK_24H = replace(EN, twelve_hour=False)
WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
NOTE_CHARS = 90
MUST_TRY_CHARS = 60


def cell(value: object) -> str:
    text = " ".join(str(value).split()) if value not in (None, "") else "-"
    return text.replace("|", "/")


def clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def hours_cell(place: Place, inputs: PlanInputs) -> str:
    if place.hours is None:
        return "unknown"
    text = opening_hours(CLOCK_24H, place.hours) or "unknown"
    closed = [
        str(i + 1)
        for i, weekday in enumerate(inputs.weekdays)
        if opening_intervals(place.hours, weekday) == []
    ]
    return f"{text}; CLOSED day {', '.join(closed)}" if closed else text


def best_cell(place: Place) -> str:
    best = place.best_time
    if best is None or not best.hours:
        return "-"
    return (
        f"{best.hours} ({best.source}: {best.why})" if best.why else f"{best.hours} ({best.source})"
    )


def place_row(place: Place, inputs: PlanInputs) -> str:
    spatial = place.spatial
    area = f"{spatial.sector}/{spatial.zone or '-'}" if spatial else "-"
    km = f"{spatial.distance_km:.1f}" if spatial else "-"
    note = place.notes[0].splitlines()[0] if place.notes and place.notes[0].strip() else ""
    values = [
        f"`{place.id}`",
        place.name,
        place.priority,
        place.category.value,
        area,
        km,
        inputs.matrix.between(CENTER_ID, place.id),
        f"{place.lat:.5f},{place.lng:.5f}",
        hours_cell(place, inputs),
        best_cell(place),
        place.best_time.deadline if place.best_time else None,
        price_text(place),
        clip(", ".join(place.must_try), MUST_TRY_CHARS),
        clip(note, NOTE_CHARS),
        place.mention_count,
        ", ".join(place.tags),
    ]
    return "| " + " | ".join(cell(v) for v in values) + " |"


def spot_row(spot: NearbySpot, inputs: PlanInputs) -> str:
    km = distance_km((inputs.center.lat, inputs.center.lng), (spot.lat, spot.lng))
    values = [
        f"`{spot.id}`",
        spot.name,
        spot.kind,
        spot.zone_id,
        f"{km:.1f}",
        inputs.matrix.between(CENTER_ID, spot.id),
        f"{spot.lat:.5f},{spot.lng:.5f}",
    ]
    return "| " + " | ".join(cell(v) for v in values) + " |"


def rhythm_row(slot: RhythmSlot) -> str:
    suits = ", ".join(c.value for c in slot.categories) or "no place (rest at the center)"
    values = [f"`{slot.id}`", slot.name_en, f"{slot.start}{EN_DASH}{slot.end}", suits, slot.hint]
    return "| " + " | ".join(cell(v) for v in values) + " |"


def _sort_key(place: Place) -> tuple[int, str, str, float, str]:
    """Must-go first, then high priority, then by direction, zone and distance."""
    spatial = place.spatial
    if spatial is None:
        return (rank(place.priority), "~", "~", 0.0, place.name)
    return (
        rank(place.priority),
        spatial.sector,
        spatial.zone or "~",
        spatial.distance_km,
        place.name,
    )


def day_lines(inputs: PlanInputs) -> str:
    if not inputs.dated:
        return "dates not set; opening hours are checked as if every day is a Saturday"
    return "; ".join(
        f"day {i} = {WEEKDAY_NAMES[d.weekday()]} {d.isoformat()}"
        for i, d in enumerate(inputs.dates, start=1)
        if d is not None
    )


def example_plan() -> str:
    example = {
        "days": [
            {
                "day": 1,
                "stops": [
                    {
                        "ref": "gp:EXAMPLE_HILL",
                        "slot": "sunrise",
                        "reason": "Cloud hunting at dawn",
                        "reason_vi": "Săn mây lúc bình minh",
                    },
                    {
                        "ref": "gp:EXAMPLE_NOODLES",
                        "slot": "breakfast",
                        "reason": "Bún bò on the way back, opens 6:00",
                        "reason_vi": "Bún bò trên đường về, mở cửa 6:00",
                    },
                    {
                        "ref": "osm:node/EXAMPLE",
                        "slot": "morning",
                        "reason": "Quiet garden walk nearby",
                        "reason_vi": "Dạo vườn yên tĩnh gần đó",
                    },
                    {
                        "ref": "rest",
                        "slot": "rest",
                        "reason": "Rest after an early start",
                        "reason_vi": "Nghỉ ngơi sau buổi sáng dậy sớm",
                    },
                    {
                        "ref": "gp:EXAMPLE_CAFE",
                        "slot": "cafe",
                        "reason": "Forest-view café, best in the afternoon light",
                        "reason_vi": "Cà phê view rừng, đẹp nhất lúc chiều",
                    },
                ],
            }
        ],
        "unplaced": [
            {"ref": "gp:EXAMPLE_FAR", "code": "too_far", "reason": "45 km out of town"},
            {"ref": "gp:EXAMPLE_SNACK", "code": "low_priority"},
        ],
    }
    return json.dumps(example, ensure_ascii=False, indent=2)


def target_per_day(total: int, days: int, trip: TripConfig, plan: PlanConfig) -> int:
    """Places a day to aim for: balanced, but never above the traveller-friendly target or cap."""
    balanced = math.ceil(total / max(days, 1)) if total else 0
    limits = [balanced, plan.target_places_per_day]
    if trip.max_places_per_day is not None:
        limits.append(trip.max_places_per_day)
    return min(limits)


def build_plan_prompt(
    inputs: PlanInputs, config: AppConfig, *, matrix_path: Path, output_path: Path
) -> str:
    trip, plan = config.trip, config.plan
    center = inputs.center
    days = trip.days
    per_day = target_per_day(len(inputs.places), days, trip, plan)
    center_name = center.label if not center.label_en else f"{center.label} ({center.label_en})"
    center_kind = (
        "the hotel"
        if center.source == "hotel"
        else "not the hotel (no hotel set; "
        + ("chosen manually)" if center.source == "override" else "city default landmark)")
    )
    service = ", ".join(f"{c.value} {m}" for c, m in trip.service_minutes.items())
    rest_rule = (
        "When a day runs from morning into the evening, insert a `rest` stop (ref `rest`, slot "
        f"`{REST_SLOT}`) at the center between lunch and the café slot."
        if plan.rest_at_center
        else "Do not add `rest` stops (plan.rest_at_center is off)."
    )
    values = {
        "city": config.city,
        "days": days,
        "days_text": f"{days}-day",
        "day_lines": day_lines(inputs),
        "day_start": plan.day_start,
        "day_end": plan.day_end,
        "travel_mode": config.travel.mode,
        "matrix_source": "estimated from straight-line distance",
        "center_name": center_name,
        "center_kind": center_kind,
        "center_url": center.maps_url,
        "place_count": len(inputs.places),
        "spot_count": len(inputs.spots),
        "per_day": per_day,
        "cap_note": (
            f" (hard cap {trip.max_places_per_day})" if trip.max_places_per_day is not None else ""
        ),
        "max_nearby": trip.max_nearby_per_day,
        "service_text": f"{service}; nearby spots {config.nearby.service_minutes}; rest until "
        "the rest slot ends",
        "nearby_service": config.nearby.service_minutes,
        "rhythm_table": "\n".join(rhythm_row(s) for s in plan.rhythm),
        "places_table": "\n".join(
            place_row(p, inputs) for p in sorted(inputs.places, key=_sort_key)
        )
        or "| (no places) |",
        "spots_table": "\n".join(spot_row(s, inputs) for s in inputs.spots)
        or "| (no nearby spots) |",
        "matrix_path": matrix_path.resolve(),
        "matrix_shape": f"{inputs.matrix.shape[0]} x {inputs.matrix.shape[1]}",
        "output_path": output_path.resolve(),
        "validation_path": output_path.with_name("validation.md").resolve(),
        "slot_order": " → ".join(f"`{s.id}`" for s in plan.rhythm),
        "long_leg": LONG_LEG_MIN,
        "rest_rule": rest_rule,
        "example": example_plan(),
    }
    template = Template(TEMPLATE_FILE.read_text(encoding="utf-8"))
    return template.substitute(values)
