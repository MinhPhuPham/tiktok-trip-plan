"""Time windows in minutes since midnight. Intervals are inclusive (lo, hi) pairs."""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence

from tiktok_trip.clock import DAY_MINUTES, to_minutes
from tiktok_trip.models import BestTime, Hours

LUNCH = (11 * 60, 13 * 60 + 30)
DINNER = (17 * 60 + 30, 20 * 60 + 30)

Interval = tuple[int, int]

_RANGE_RE = re.compile(
    r"(\d{1,2})(?:[:hH.](\d{2}))?\s*[hH]?\s*(?:[\u2013\u2014-]|to)\s*(\d{1,2})(?:[:hH.](\d{2}))?"
)


def merge(intervals: Iterable[Interval]) -> list[Interval]:
    merged: list[Interval] = []
    for lo, hi in sorted(i for i in intervals if i[0] <= i[1]):
        if merged and lo <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], hi))
        else:
            merged.append((lo, hi))
    return merged


def intersect(a: Sequence[Interval], b: Sequence[Interval]) -> list[Interval]:
    out = [
        (max(lo1, lo2), min(hi1, hi2))
        for lo1, hi1 in a
        for lo2, hi2 in b
        if max(lo1, lo2) <= min(hi1, hi2)
    ]
    return merge(out)


def opening_intervals(hours: Hours | None, weekday: int) -> list[Interval] | None:
    """Union of the weekday's opening periods. None means hours are unknown (assume open);
    an empty list means closed that day. Overnight periods spill into the next weekday."""
    if hours is None or not hours.periods:
        return None
    periods = hours.periods
    if len(periods) == 1 and periods[0].close is None and periods[0].open == "00:00":
        return [(0, DAY_MINUTES)]
    found: list[Interval] = []
    for period in periods:
        start = to_minutes(period.open)
        end = DAY_MINUTES if period.close is None else to_minutes(period.close)
        overnight = period.close is not None and end <= start
        if period.day == weekday:
            found.append((start, DAY_MINUTES if overnight else end))
        elif overnight and (period.day + 1) % 7 == weekday:
            found.append((0, end))
    return merge(found)


def parse_hour_range(text: str | None) -> Interval | None:
    """Hour range text ("17:00-20:00", "17h-20h", "7-9", en dash too) to minutes.

    A range that runs past midnight ends at 24:00.
    """
    if not text:
        return None
    match = _RANGE_RE.search(text)
    if not match:
        return None
    h1, m1, h2, m2 = match.groups()
    start = int(h1) * 60 + int(m1 or 0)
    end = int(h2) * 60 + int(m2 or 0)
    if start >= DAY_MINUTES or end > DAY_MINUTES:
        return None
    if end <= start:
        end = DAY_MINUTES
    return start, end


def arrival_windows(
    hours: Hours | None,
    best_time: BestTime | None,
    weekday: int,
    service: int,
    day: Interval,
    *,
    use_best_time: bool = True,
) -> list[Interval]:
    """When a visit may start: open long enough for the whole service, inside the day,
    before any deadline, and within the best-time hours when they leave room."""
    opening = opening_intervals(hours, weekday)
    visit = [(0, DAY_MINUTES)] if opening is None else opening
    windows = [(lo, hi - service) for lo, hi in visit if hi - service >= lo]
    windows = intersect(windows, [(day[0], day[1] - service)])
    if best_time and best_time.deadline:
        windows = intersect(windows, [(0, to_minutes(best_time.deadline))])
    if use_best_time and best_time and (preferred := parse_hour_range(best_time.hours)):
        narrowed = intersect(windows, [preferred])
        if narrowed:
            windows = narrowed
    return windows


def meal_window(windows: Sequence[Interval], prefer: Interval = LUNCH) -> Interval | None:
    """`prefer` when it overlaps the windows, else the other meal slot, else None."""
    for meal in (prefer, DINNER if prefer == LUNCH else LUNCH):
        if intersect(windows, [meal]):
            return meal
    return None
