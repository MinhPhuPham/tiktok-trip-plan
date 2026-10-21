"""Single-vehicle OR-Tools routing with time windows and droppable stops.

Node 0 is the depot (start and end). Every other node can be dropped at its penalty, so the
model is always feasible: mandatory places use a penalty far above any travel cost.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise
from typing import Any

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from tiktok_trip.clock import DAY_MINUTES
from tiktok_trip.routing.windows import Interval

TRAVEL_COST_SCALE = 10
SPAN_COST = 1
MEAL_SOFT_COST = 5


@dataclass(frozen=True)
class Node:
    service: int
    windows: Sequence[Interval]
    penalty: int
    soft: Interval | None = None


@dataclass(frozen=True)
class Solution:
    order: list[int]
    arrivals: dict[int, int]
    start: int
    end: int
    dropped: list[int]


def _add_windows(routing: Any, manager: Any, time: Any, nodes: Sequence[Node]) -> None:
    for node_id, node in enumerate(nodes, start=1):
        index = manager.NodeToIndex(node_id)
        cumul = time.CumulVar(index)
        cumul.SetRange(node.windows[0][0], node.windows[-1][1])
        for (_, gap_lo), (gap_hi, _) in pairwise(node.windows):
            if gap_hi - gap_lo > 1:
                cumul.RemoveInterval(gap_lo + 1, gap_hi - 1)
        if node.soft is not None:
            time.SetCumulVarSoftLowerBound(index, node.soft[0], MEAL_SOFT_COST)
            time.SetCumulVarSoftUpperBound(index, node.soft[1], MEAL_SOFT_COST)
        routing.AddDisjunction([index], node.penalty)


def _extract(
    routing: Any, manager: Any, time: Any, assignment: Any, travel: Sequence[Sequence[int]]
) -> Solution:
    order: list[int] = []
    arrivals: dict[int, int] = {}
    index = assignment.Value(routing.NextVar(routing.Start(0)))
    while not routing.IsEnd(index):
        node_id = manager.IndexToNode(index)
        order.append(node_id)
        arrivals[node_id] = assignment.Value(time.CumulVar(index))
        index = assignment.Value(routing.NextVar(index))
    end = assignment.Value(time.CumulVar(routing.End(0)))
    start = assignment.Value(time.CumulVar(routing.Start(0)))
    if order:
        start = arrivals[order[0]] - int(travel[0][order[0]])
    visited = set(order)
    dropped = [i for i in range(1, len(travel)) if i not in visited]
    return Solution(order=order, arrivals=arrivals, start=start, end=end, dropped=dropped)


def solve(
    nodes: Sequence[Node],
    travel: Sequence[Sequence[int]],
    day: Interval,
    *,
    time_limit_s: float = 2.0,
) -> Solution | None:
    """`travel` is a square matrix of whole minutes over [depot, *nodes].
    Every node needs at least one window. Arrivals are visit start times."""
    size = len(nodes) + 1
    if len(travel) != size:
        raise ValueError(f"travel matrix is {len(travel)} rows, expected {size}")
    service = [0, *(n.service for n in nodes)]
    manager = pywrapcp.RoutingIndexManager(size, 1, 0)
    routing = pywrapcp.RoutingModel(manager)

    def transit(from_index: int, to_index: int) -> int:
        i, j = manager.IndexToNode(from_index), manager.IndexToNode(to_index)
        return int(travel[i][j] + service[i])

    def arc_cost(from_index: int, to_index: int) -> int:
        i, j = manager.IndexToNode(from_index), manager.IndexToNode(to_index)
        return int(travel[i][j] * TRAVEL_COST_SCALE)

    routing.SetArcCostEvaluatorOfAllVehicles(routing.RegisterTransitCallback(arc_cost))
    routing.AddDimension(
        routing.RegisterTransitCallback(transit), DAY_MINUTES, DAY_MINUTES, False, "time"
    )
    time = routing.GetDimensionOrDie("time")
    time.SetSpanCostCoefficientForAllVehicles(SPAN_COST)
    for index in (routing.Start(0), routing.End(0)):
        time.CumulVar(index).SetRange(day[0], day[1])
    _add_windows(routing, manager, time, nodes)
    routing.AddVariableMinimizedByFinalizer(time.CumulVar(routing.End(0)))
    routing.AddVariableMaximizedByFinalizer(time.CumulVar(routing.Start(0)))

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GREEDY_DESCENT
    params.time_limit.FromMilliseconds(int(time_limit_s * 1000))
    assignment = routing.SolveWithParameters(params)
    if assignment is None:
        return None
    return _extract(routing, manager, time, assignment, travel)
