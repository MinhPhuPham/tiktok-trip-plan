"""Assign zones to trip days, balancing real places per day: by compass sector or nearest zones."""

from __future__ import annotations

import logging
import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from itertools import combinations

from tiktok_trip import geo
from tiktok_trip.config import DayGrouping
from tiktok_trip.models import Zone

log = logging.getLogger(__name__)

OPPOSITE_DEG = 90.0
"""Two sectors further apart than this lie on opposite sides of the center."""
MAX_REPAIR_ROUNDS = 500
BALANCE_SLACK = 2
"""A day up to this many places under the target counts as balanced."""

Day = list[Zone]
Score = tuple[int, int, float, int]


def _distance(a: Zone, b: Zone) -> float:
    return geo.distance_km((a.lat, a.lng), (b.lat, b.lng))


def _to_bundle(zone: Zone, bundle: Sequence[Zone]) -> float:
    return min(_distance(zone, member) for member in bundle)


def neighbour_sectors(sector: str, names: Sequence[str]) -> set[str]:
    """Clockwise and counter-clockwise neighbours on the compass; none for unknown sectors."""
    if sector not in names:
        return set()
    index = names.index(sector)
    return {names[(index - 1) % len(names)], names[(index + 1) % len(names)]}


def opposite_sectors(a: str, b: str) -> bool:
    gap = geo.sector_gap_deg(a, b)
    return gap is not None and gap > OPPOSITE_DEG


def _clashes(zone: Zone, day: Sequence[Zone]) -> bool:
    return any(opposite_sectors(zone.sector, member.sector) for member in day)


def _opposite_pairs(day: Sequence[Zone]) -> int:
    return sum(opposite_sectors(a.sector, b.sector) for a, b in combinations(day, 2))


def _load(day: Sequence[Zone], counts: Mapping[str, int]) -> int:
    return sum(counts[z.id] for z in day)


def _affinity(zone: Zone, bundle: Sequence[Zone], names: Sequence[str]) -> int:
    sectors = {z.sector for z in bundle}
    if zone.sector in sectors:
        return 0
    return 1 if neighbour_sectors(zone.sector, names) & sectors else 2


def _fitting(
    day: Day, remaining: Mapping[str, Zone], counts: Mapping[str, int], target: int
) -> list[Zone]:
    load = _load(day, counts)
    return [z for z in remaining.values() if load + counts[z.id] <= target and not _clashes(z, day)]


def _sector_days(
    active: Sequence[Zone],
    counts: Mapping[str, int],
    days: int,
    *,
    target: int,
    zone_cap: int,
    names: Sequence[str],
) -> tuple[list[Day], list[Zone]]:
    """Busiest sector first: its biggest zone, then same-sector and adjacent zones that fit."""
    order = {name: index for index, name in enumerate(names)}
    remaining = {z.id: z for z in active}
    planned: list[Day] = []
    while remaining and len(planned) < days:
        totals: dict[str, int] = defaultdict(int)
        for zone in remaining.values():
            totals[zone.sector] += counts[zone.id]
        sector = min(totals, key=lambda s: (-totals[s], order.get(s, len(order)), s))
        seed = min(
            (z for z in remaining.values() if z.sector == sector),
            key=lambda z: (-counts[z.id], z.id),
        )
        day = [remaining.pop(seed.id)]
        while len(day) < zone_cap:
            sectors = {z.sector for z in day}
            adjacent = set().union(*(neighbour_sectors(s, names) for s in sectors))
            fitting = _fitting(day, remaining, counts, target)
            pool = [z for z in fitting if z.sector in sectors] or [
                z for z in fitting if z.sector in adjacent
            ]
            if not pool:
                break
            nearest = min(pool, key=lambda z: (_to_bundle(z, day), z.id))
            day.append(remaining.pop(nearest.id))
        planned.append(day)
    return planned, list(remaining.values())


def _nearest_days(
    active: Sequence[Zone], counts: Mapping[str, int], days: int, target: int, zone_cap: int
) -> tuple[list[Day], list[Zone]]:
    """Biggest zone first, then the zones nearest to it that fit, whatever their direction."""
    remaining = {z.id: z for z in active}
    planned: list[Day] = []
    for seed in active:
        if len(planned) == days:
            break
        if seed.id not in remaining:
            continue
        day = [remaining.pop(seed.id)]
        while len(day) < zone_cap:
            pool = _fitting(day, remaining, counts, target)
            if not pool:
                break
            nearest = min(pool, key=lambda z: (_distance(seed, z), z.id))
            day.append(remaining.pop(nearest.id))
        planned.append(day)
    return planned, list(remaining.values())


def _leftover_day(
    zone: Zone,
    planned: Sequence[Day],
    counts: Mapping[str, int],
    *,
    target: int,
    hard_cap: int | None,
    names: Sequence[str],
) -> Day | None:
    """Not across the center when avoidable; an adjacent day with spare room; else the lightest."""
    size = counts[zone.id]
    room = [d for d in planned if hard_cap is None or _load(d, counts) + size <= hard_cap]
    if not room:
        return None

    def key(day: Day) -> tuple[bool, bool, int, float]:
        load = _load(day, counts)
        adjacent_with_room = _affinity(zone, day, names) < 2 and load + size <= target
        return (_clashes(zone, day), not adjacent_with_room, load, _to_bundle(zone, day))

    return min(room, key=key)


def _tree_km(day: Sequence[Zone]) -> float:
    """Length of the minimum spanning tree over the day's zone centroids (Prim)."""
    if len(day) < 2:
        return 0.0
    reach = {zone.id: _distance(day[0], zone) for zone in day[1:]}
    total = 0.0
    while reach:
        zid = min(reach, key=lambda k: (reach[k], k))
        total += reach.pop(zid)
        joined = next(z for z in day if z.id == zid)
        for other in day:
            if other.id in reach:
                reach[other.id] = min(reach[other.id], _distance(joined, other))
    return total


def _score(planned: Sequence[Day], counts: Mapping[str, int], target: int) -> Score:
    """Opposite pairs; places outside [target - BALANCE_SLACK, target]; spread; squared loads."""
    loads = [_load(day, counts) for day in planned]
    off_band = sum(max(0, load - target, target - BALANCE_SLACK - load) for load in loads)
    return (
        sum(_opposite_pairs(day) for day in planned),
        off_band,
        round(sum(_tree_km(day) for day in planned), 6),
        sum(load * load for load in loads),
    )


def _candidates(planned: list[Day]) -> list[list[Day]]:
    """Every plan one zone move or one zone swap away; no day is left empty."""
    found: list[list[Day]] = []
    for i, j in ((i, j) for i in range(len(planned)) for j in range(len(planned)) if i != j):
        for zone in planned[i]:
            if len(planned[i]) > 1:
                moved = [list(day) for day in planned]
                moved[i].remove(zone)
                moved[j].append(zone)
                found.append(moved)
            if i < j:
                for other in planned[j]:
                    swapped = [list(day) for day in planned]
                    swapped[i][swapped[i].index(zone)] = other
                    swapped[j][swapped[j].index(other)] = zone
                    found.append(swapped)
    return found


def _repair(
    planned: list[Day], counts: Mapping[str, int], target: int, hard_cap: int | None
) -> list[Day]:
    """Best-improvement local search over zone moves and swaps; never breaks the hard cap."""
    current, best = planned, _score(planned, counts, target)
    for _ in range(MAX_REPAIR_ROUNDS):
        options = [
            (score, plan)
            for plan in _candidates(current)
            if hard_cap is None or all(_load(d, counts) <= hard_cap for d in plan if len(d) > 1)
            if (score := _score(plan, counts, target)) < best
        ]
        if not options:
            break
        best, current = min(options, key=lambda item: item[0])
    return current


def place_target(total_places: int, days: int, max_places_per_day: int | None = None) -> int:
    """Balanced places per day, never above the hard cap."""
    target = max(1, math.ceil(total_places / max(days, 1)))
    return min(target, max_places_per_day) if max_places_per_day else target


def plan_days(
    zones: Sequence[Zone],
    place_counts: Mapping[str, int],
    days: int,
    max_zones_per_day: int,
    *,
    grouping: DayGrouping = "sector",
    sectors: int = 8,
    max_places_per_day: int | None = None,
) -> list[list[str]]:
    """One list of zone ids per non-empty day, balanced on real places, busiest day first.

    Each day may hold `place_target` places: ceil(places / days), lowered to `max_places_per_day`.
    `sector`: busiest compass sector first, topped up with same-sector then adjacent-sector zones
    that keep the day within the target. `nearest`: biggest zone first, with its nearest zones that
    fit. Neither puts zones from opposite sides of the center (sectors > 90 degrees apart) on one
    day while building. A zone bigger than the target gets a day of its own (the solver drops what
    does not fit the hours). `max_zones_per_day` is a soft cap while building and rises evenly when
    there are many zones.

    Leftover zones go to a day that does not face them across the center when one exists: an
    adjacent day with room, else the day with the fewest places. A local search then moves or swaps
    zones to remove opposite pairs, then to bring every day within [target - 2, target] places, then
    to keep days compact (shortest spanning tree over zone centroids), then to even out loads. With
    `max_places_per_day`, no day goes over it after building; zones that fit nowhere are left out
    and logged.
    """
    active = [z for z in zones if place_counts.get(z.id, 0) > 0]
    active.sort(key=lambda z: (-place_counts[z.id], z.id))
    if not active:
        return []
    names = geo.sector_names(sectors)
    total = sum(place_counts[z.id] for z in active)
    target = place_target(total, days, max_places_per_day)
    zone_cap = max(max_zones_per_day, math.ceil(len(active) / max(days, 1)))
    if grouping == "sector":
        planned, leftover = _sector_days(
            active, place_counts, days, target=target, zone_cap=zone_cap, names=names
        )
    else:
        planned, leftover = _nearest_days(active, place_counts, days, target, zone_cap)

    def place_leftovers(zones_left: Sequence[Zone]) -> list[Zone]:
        unplaced: list[Zone] = []
        for zone in sorted(zones_left, key=lambda z: (-place_counts[z.id], z.id)):
            day = _leftover_day(
                zone, planned, place_counts, target=target, hard_cap=max_places_per_day, names=names
            )
            if day is None:
                unplaced.append(zone)
            else:
                day.append(zone)
        return unplaced

    left_out = place_leftovers(leftover)
    planned = _repair(planned, place_counts, target, max_places_per_day)
    left_out = place_leftovers(left_out)
    if left_out:
        log.warning(
            "%d zones (%s, %d places) do not fit %d days at max_places_per_day %s; left out.",
            len(left_out),
            ", ".join(z.id for z in left_out),
            sum(place_counts[z.id] for z in left_out),
            days,
            max_places_per_day,
        )
    planned.sort(key=lambda day: (-_load(day, place_counts), day[0].id))
    return [[z.id for z in day] for day in planned]
