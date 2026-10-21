"""Everything the agent planner sees: active places, nearby spots, center, matrix, weekdays."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from tiktok_trip.config import AppConfig
from tiktok_trip.geo import LatLng
from tiktok_trip.models import Category, Center, NearbySpot, Place
from tiktok_trip.planning.matrix import CENTER_ID, MatrixFn, TravelMatrix
from tiktok_trip.planning.schema import REST_REF
from tiktok_trip.routing.planner import service_minutes

NodeKind = Literal["place", "nearby", "rest"]
DEFAULT_WEEKDAY = 5


@dataclass(frozen=True)
class PlanNode:
    ref: str
    kind: NodeKind
    name: str
    point: LatLng
    service: int
    category: Category | None = None
    place: Place | None = None
    spot: NearbySpot | None = None

    @property
    def matrix_id(self) -> str:
        return CENTER_ID if self.kind == "rest" else self.ref

    @property
    def sector(self) -> str | None:
        return self.place.spatial.sector if self.place and self.place.spatial else None

    @property
    def zone(self) -> str | None:
        if self.place and self.place.spatial:
            return self.place.spatial.zone
        return self.spot.zone_id if self.spot else None


@dataclass(frozen=True)
class PlanInputs:
    center: Center
    places: list[Place]
    spots: list[NearbySpot]
    nodes: dict[str, PlanNode]
    matrix: TravelMatrix
    weekdays: list[int]
    dates: list[date | None]

    @property
    def dated(self) -> bool:
        return any(self.dates)

    def weekday(self, index: int) -> int:
        """Weekday of trip day `index` (0-based), also for days past trip.days."""
        first = self.dates[0] if self.dates else None
        return (first + timedelta(days=index)).weekday() if first else DEFAULT_WEEKDAY


def trip_days(config: AppConfig) -> tuple[list[int], list[date | None]]:
    trip = config.trip
    if trip.trip_start_date is None:
        return [DEFAULT_WEEKDAY] * trip.days, [None] * trip.days
    dates = [trip.trip_start_date + timedelta(days=i) for i in range(trip.days)]
    return [d.weekday() for d in dates], list(dates)


def build_inputs(
    config: AppConfig,
    center: Center,
    places: Sequence[Place],
    spots: Sequence[NearbySpot],
    matrix_fn: MatrixFn,
) -> PlanInputs:
    active = [p for p in places if p.status != "skip"]
    place_ids = {p.id for p in active}
    fillers = [s for s in spots if s.id not in place_ids]
    nodes: dict[str, PlanNode] = {
        REST_REF: PlanNode(
            ref=REST_REF, kind="rest", name=center.label, point=(center.lat, center.lng), service=0
        )
    }
    for place in active:
        nodes[place.id] = PlanNode(
            ref=place.id,
            kind="place",
            name=place.name,
            point=(place.lat, place.lng),
            service=service_minutes(config.trip, place.category),
            category=place.category,
            place=place,
        )
    for spot in fillers:
        nodes.setdefault(
            spot.id,
            PlanNode(
                ref=spot.id,
                kind="nearby",
                name=spot.name,
                point=(spot.lat, spot.lng),
                service=config.nearby.service_minutes,
                spot=spot,
            ),
        )
    points = [(CENTER_ID, (center.lat, center.lng))]
    points += [(n.ref, n.point) for n in nodes.values() if n.kind != "rest"]
    weekdays, dates = trip_days(config)
    return PlanInputs(
        center=center,
        places=active,
        spots=[n.spot for n in nodes.values() if n.spot is not None],
        nodes=nodes,
        matrix=TravelMatrix.build(points, matrix_fn),
        weekdays=weekdays,
        dates=dates,
    )
