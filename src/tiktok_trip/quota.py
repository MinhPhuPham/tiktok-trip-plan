"""Local per-sku call caps that keep every run inside the services' free tiers.

Usage is counted from `data/api_log.csv`: every real call (cache_hit False, failed ones too) is one
call against its sku, whatever its `units`. The log is read once per guard and then kept current in
memory as calls are made.
"""

from __future__ import annotations

import bisect
import logging
import math
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from tiktok_trip.config import QuotaConfig
from tiktok_trip.errors import UserFacingError
from tiktok_trip.storage import ApiLog

log = logging.getLogger(__name__)

Period = Literal["month", "day"]
WARN_FRACTION = 0.8
FREE_SERVICES = ("photon", "overpass", "nominatim")


def utc_now() -> datetime:
    return datetime.now(UTC)


def period_start(period: Period, now: datetime) -> datetime:
    day = now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return day.replace(day=1) if period == "month" else day


def period_end(period: Period, now: datetime) -> datetime:
    start = period_start(period, now)
    if period == "day":
        return start + timedelta(days=1)
    return (start + timedelta(days=32)).replace(day=1)


def period_label(period: Period, now: datetime) -> str:
    start = period_start(period, now)
    return start.strftime("%Y-%m") if period == "month" else start.strftime("%Y-%m-%d")


@dataclass(frozen=True)
class QuotaLimit:
    sku: str
    period: Period
    cap: int
    effective_cap: int


@dataclass(frozen=True)
class QuotaStatus:
    limit: QuotaLimit
    used: int
    resets_at: datetime

    @property
    def remaining(self) -> int:
        return max(self.limit.effective_cap - self.used, 0)


class QuotaExceededError(UserFacingError):
    def __init__(self, limit: QuotaLimit, used: int, now: datetime, safety_margin: float) -> None:
        self.limit = limit
        self.used = used
        reset = period_end(limit.period, now).strftime("%Y-%m-%d %H:%M UTC")
        super().__init__(
            f"Quota stop for {limit.sku}: {used} of {limit.cap} calls used this {limit.period} "
            f"({period_label(limit.period, now)} UTC); the local limit is {limit.effective_cap} "
            f"({safety_margin:.0%} of the free cap), so the call was not sent. "
            f"Resets {reset}. The cap lives in config.yaml under `quota`."
        )


class QuotaGuard:
    """Refuses a call that would take a capped sku past `cap * safety_margin` this period."""

    def __init__(
        self,
        config: QuotaConfig,
        api_log: ApiLog,
        *,
        now: Callable[[], datetime] = utc_now,
    ) -> None:
        self.safety_margin = config.safety_margin
        self.limits = [
            *(self._limit(sku, "month", cap) for sku, cap in config.monthly.items()),
            *(self._limit(sku, "day", cap) for sku, cap in config.daily.items()),
        ]
        self._api_log = api_log
        self._now = now
        self._calls: defaultdict[str, list[datetime]] | None = None
        self._warned: set[str] = set()

    def _limit(self, sku: str, period: Period, cap: int) -> QuotaLimit:
        return QuotaLimit(sku, period, cap, math.floor(cap * self.safety_margin + 1e-9))

    def _history(self) -> defaultdict[str, list[datetime]]:
        if self._calls is None:
            calls: defaultdict[str, list[datetime]] = defaultdict(list)
            for call in self._api_log.read():
                if not call.cache_hit:
                    calls[call.sku].append(call.timestamp)
            for times in calls.values():
                times.sort()
            self._calls = calls
        return self._calls

    def limits_for(self, sku: str) -> list[QuotaLimit]:
        return [limit for limit in self.limits if limit.sku == sku]

    def used(self, sku: str, period: Period, now: datetime | None = None) -> int:
        times = self._history().get(sku, [])
        start = period_start(period, now or self._now())
        return len(times) - bisect.bisect_left(times, start)

    def check(self, sku: str, calls: int = 1) -> None:
        """Raise QuotaExceededError when `calls` more real calls would pass a cap on `sku`."""
        now = self._now()
        for limit in self.limits_for(sku):
            used = self.used(sku, limit.period, now)
            if used + calls > limit.effective_cap:
                error = QuotaExceededError(limit, used, now, self.safety_margin)
                log.error("%s", error)
                raise error

    def add(self, sku: str, calls: int = 1) -> None:
        """Count real calls that were just sent; warns once per sku past 80% of its local cap."""
        now = self._now()
        times = self._history()[sku]
        for _ in range(calls):
            bisect.insort(times, now)
        if sku in self._warned:
            return
        for limit in self.limits_for(sku):
            used = self.used(sku, limit.period, now)
            if used >= WARN_FRACTION * limit.effective_cap:
                self._warned.add(sku)
                log.warning(
                    "Quota: %s has used %d of its local limit %d this %s (free cap %d). "
                    "Calls stop at the limit; see `tiktok-trip quota`.",
                    sku,
                    used,
                    limit.effective_cap,
                    limit.period,
                    limit.cap,
                )
                return

    def statuses(self) -> list[QuotaStatus]:
        now = self._now()
        return [
            QuotaStatus(
                limit, self.used(limit.sku, limit.period, now), period_end(limit.period, now)
            )
            for limit in self.limits
        ]
