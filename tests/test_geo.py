import math

import pytest

from tiktok_trip import geo


def band(text: str) -> str:
    return text.replace("-", geo.EN_DASH)


CENTER = (10.7769, 106.7009)


@pytest.mark.parametrize(
    ("bearing", "expected"),
    [
        (0.0, "N"),
        (359.99, "N"),
        (337.5, "N"),
        (337.49, "NW"),
        (22.49, "N"),
        (22.5, "NE"),
        (67.5, "E"),
        (90.0, "E"),
        (112.5, "SE"),
        (180.0, "S"),
        (202.5, "SW"),
        (270.0, "W"),
        (292.5, "NW"),
        (360.0, "N"),
    ],
)
def test_sector_name_8(bearing: float, expected: str) -> None:
    assert geo.sector_name(bearing, 8) == expected


@pytest.mark.parametrize(
    ("bearing", "expected"),
    [
        (0.0, "N"),
        (44.99, "N"),
        (45.0, "E"),
        (134.99, "E"),
        (135.0, "S"),
        (225.0, "W"),
        (314.99, "W"),
        (315.0, "N"),
        (359.99, "N"),
    ],
)
def test_sector_name_4(bearing: float, expected: str) -> None:
    assert geo.sector_name(bearing, 4) == expected


def test_sector_name_rejects_other_counts() -> None:
    with pytest.raises(ValueError, match="4 or 8"):
        geo.sector_name(10, 6)


@pytest.mark.parametrize(
    ("offset", "bearing", "sector"),
    [
        ((0.05, 0.0), 0.0, "N"),
        ((0.0, 0.05), 90.0, "E"),
        ((-0.05, 0.0), 180.0, "S"),
        ((0.0, -0.05), 270.0, "W"),
    ],
)
def test_points_due_compass_directions(
    offset: tuple[float, float], bearing: float, sector: str
) -> None:
    lat, lng = CENTER[0] + offset[0], CENTER[1] + offset[1]
    measured = geo.bearing_deg(*CENTER, lat, lng)
    assert min(abs(measured - bearing), 360 - abs(measured - bearing)) < 0.05
    assert geo.sector_name(measured) == sector


def test_bearing_is_normalized() -> None:
    value = geo.bearing_deg(*CENTER, CENTER[0] + 0.01, CENTER[1] - 0.01)
    assert 0 <= value < 360
    assert 300 < value < 330


def test_haversine_known_distance() -> None:
    assert geo.haversine_km(0, 0, 0, 1) == pytest.approx(111.195, abs=0.01)
    assert geo.haversine_km(*CENTER, *CENTER) == 0
    hcmc_to_hanoi = geo.haversine_km(10.7769, 106.7009, 21.0285, 105.8542)
    assert hcmc_to_hanoi == pytest.approx(1140, rel=0.01)


@pytest.mark.parametrize(
    ("distance", "label"),
    [
        (0.0, band("0-2km")),
        (1.99, band("0-2km")),
        (2.0, band("2-5km")),
        (4.99, band("2-5km")),
        (5.0, band("5-10km")),
        (9.99, band("5-10km")),
        (10.0, "10km+"),
        (42.0, "10km+"),
    ],
)
def test_ring_label(distance: float, label: str) -> None:
    assert geo.ring_label(distance, [2, 5, 10]) == label


def test_ring_label_fractional_and_unsorted() -> None:
    assert geo.ring_label(1.0, [3, 1.5]) == band("0-1.5km")
    assert geo.ring_label(2.0, [3, 1.5]) == band("1.5-3km")
    assert geo.ring_labels([2, 5, 10]) == [band("0-2km"), band("2-5km"), band("5-10km"), "10km+"]


def _km_north(km: float) -> tuple[float, float]:
    return CENTER[0] + km / 111.195, CENTER[1]


def test_dbscan_chains_within_eps_and_marks_noise() -> None:
    points = [_km_north(0), _km_north(1), _km_north(2), _km_north(10), _km_north(10.5)]
    assert geo.dbscan(points, eps_km=1.2, min_samples=1) == [0, 0, 0, 1, 1]
    assert geo.dbscan(points, eps_km=1.2, min_samples=3) == [0, 0, 0, -1, -1]
    assert geo.dbscan([], eps_km=1, min_samples=1) == []


def test_dbscan_border_point_joins_cluster() -> None:
    points = [_km_north(0), _km_north(0.5), _km_north(-0.5), _km_north(1.4)]
    assert geo.dbscan(points, eps_km=1.0, min_samples=3) == [0, 0, 0, 0]


def test_centroid_median_and_parse() -> None:
    assert geo.centroid([(0, 0), (2, 4)]) == (1, 2)
    assert geo.median_point([(0, 0), (1, 10), (5, 3)]) == (1, 3)
    assert geo.parse_latlng(" 10.77, 106.70 ") == (10.77, 106.70)
    assert geo.parse_latlng("-33.9,151.2") == (-33.9, 151.2)
    assert geo.parse_latlng("Ben Thanh Market") is None
    assert geo.parse_latlng("100,20") is None
    with pytest.raises(ValueError):
        geo.centroid([])
    assert not math.isnan(geo.bearing_deg(0, 0, 0, 0))


def test_clock_helpers_do_not_wrap_unless_asked() -> None:
    from tiktok_trip import clock

    assert clock.to_minutes("23:59") == clock.LAST_MINUTE
    assert clock.to_hhmm(-5) == "00:00"
    assert clock.to_hhmm(25 * 60) == "25:00"
    assert clock.wall_clock(25 * 60 + 30) == "01:30"
    assert clock.clamp_to_day(25 * 60) == clock.LAST_MINUTE


def test_coord_maps_url_is_shared_by_nearby_spots() -> None:
    from tiktok_trip.models import NearbySpot

    spot = NearbySpot(
        id="osm:node/1",
        name="x",
        kind="museum",
        lat=10.5,
        lng=106.25,
        zone_id="N-1",
        source="overpass",
    )
    assert spot.maps_url == geo.coord_maps_url(10.5, 106.25)
    assert geo.coord_maps_url(10.5, 106.25).endswith("query=10.5,106.25")
