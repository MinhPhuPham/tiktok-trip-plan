""" "HH:MM" strings and minutes since midnight, shared by best time, routing and exporters."""

from __future__ import annotations

DAY_MINUTES = 24 * 60
LAST_MINUTE = DAY_MINUTES - 1
EN_DASH = "\u2013"


def to_minutes(hhmm: str) -> int:
    hours, minutes = hhmm.split(":")
    return int(hours) * 60 + int(minutes)


def to_hhmm(minutes: int) -> str:
    """No wrap-around: negative values become 00:00 and values past midnight stay above 24:00."""
    minutes = max(0, minutes)
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def wall_clock(minutes: int) -> str:
    """Clock-face time, wrapping past midnight (25:30 becomes 01:30); for display of ranges."""
    return to_hhmm(minutes % DAY_MINUTES)


def clamp_to_day(minutes: int) -> int:
    """Keep a point in time inside the same calendar day (00:00 to 23:59)."""
    return min(max(minutes, 0), LAST_MINUTE)
