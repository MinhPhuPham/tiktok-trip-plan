"""One travel-time matrix (minutes) over the center, every place and every nearby spot."""

from __future__ import annotations

import csv
import io
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from tiktok_trip.geo import LatLng

CENTER_ID = "center"

MatrixFn = Callable[[Sequence[LatLng]], list[list[float]]]


@dataclass(frozen=True)
class TravelMatrix:
    ids: list[str]
    minutes: list[list[int]]
    _index: dict[str, int] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "_index", {node: i for i, node in enumerate(self.ids)})

    @classmethod
    def build(cls, nodes: Sequence[tuple[str, LatLng]], matrix_fn: MatrixFn) -> TravelMatrix:
        raw = matrix_fn([point for _, point in nodes]) if nodes else []
        minutes = [[math.ceil(value - 1e-9) for value in row] for row in raw]
        return cls(ids=[node for node, _ in nodes], minutes=minutes)

    def __contains__(self, node: object) -> bool:
        return node in self._index

    def between(self, a: str, b: str) -> int:
        return self.minutes[self._index[a]][self._index[b]]

    @property
    def shape(self) -> tuple[int, int]:
        return len(self.ids), len(self.ids)

    @classmethod
    def from_csv(cls, text: str) -> TravelMatrix:
        """Inverse of `to_csv`; raises ValueError on a malformed or non-square table."""
        rows = list(csv.reader(io.StringIO(text)))
        if not rows or rows[0][:1] != ["from"]:
            raise ValueError("travel matrix CSV must start with a 'from' header")
        ids = rows[0][1:]
        body = [row for row in rows[1:] if row]
        if [row[0] for row in body] != ids or any(len(row) != len(ids) + 1 for row in body):
            raise ValueError("travel matrix CSV is not square")
        return cls(ids=ids, minutes=[[int(value) for value in row[1:]] for row in body])

    def to_csv(self) -> str:
        """Square CSV: header `from`, then one column per id; row = from, column = to."""
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(["from", *self.ids])
        for node, row in zip(self.ids, self.minutes, strict=True):
            writer.writerow([node, *row])
        return buffer.getvalue()
