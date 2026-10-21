import logging

import pytest

from tiktok_trip import geo
from tiktok_trip.routing import travel


def test_travel_matrix_estimates_straight_line() -> None:
    points = [(10.7769, 106.7009), (10.7769 + 9 / 111.195, 106.7009)]
    matrix = travel.travel_matrix(points, "motorbike")
    assert matrix[0][1] == pytest.approx(9 * 1.3 / 18 * 60, rel=0.01)
    assert matrix[0][0] == 0


@pytest.mark.parametrize("n", [0, 1])
def test_travel_matrix_needs_two_points(n: int) -> None:
    points = [(10.0, 106.0)][:n]
    assert travel.travel_matrix(points, "car") == [[0.0] * n for _ in range(n)]


@pytest.mark.parametrize(("mode", "speed"), [("walking", 4.5), ("motorbike", 18), ("car", 22)])
def test_estimate_speeds(mode: str, speed: float) -> None:
    a, b = (0.0, 0.0), (0.0, 1.0)
    km = geo.distance_km(a, b)
    assert travel.estimate_minutes(a, b, mode) == pytest.approx(km * 1.3 / speed * 60)


def test_log_estimate_is_info(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO):
        travel.log_estimate("motorbike")
    assert [r.levelno for r in caplog.records] == [logging.INFO]
