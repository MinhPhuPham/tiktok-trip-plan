from __future__ import annotations

import csv
import logging
import re

import httpx
import pytest
import respx
from fixtures.sample_dataset import build_dataset

from tiktok_trip.clients.osrm import OsrmClient, RoadRoute, parse_route, route_url
from tiktok_trip.config import AppConfig, RoadsConfig
from tiktok_trip.context import Context
from tiktok_trip.export.roads import collect_roads, fetch_roads, road_legs
from tiktok_trip.http import CachedClient, RateLimiter
from tiktok_trip.models import DayPlan, RouteStop, StopKind

ENDPOINT = "https://routing.example.org"
ROUTES = re.compile(rf"{re.escape(ENDPOINT)}/routed-\w+/route/v1/driving/.*")
GEOMETRY = "_p~iF~ps|U_ulLnnqC"
OK = {"code": "Ok", "routes": [{"geometry": GEOMETRY, "distance": 1200.5, "duration": 300}]}


def stop(kind: StopKind, ref: str | None, lat: float, lng: float) -> RouteStop:
    return RouteStop(
        kind=kind, ref_id=ref, name=ref or kind, lat=lat, lng=lng, arrive="08:00", depart="08:00"
    )


@pytest.fixture
def osrm_ctx(ctx: Context) -> Context:
    ctx.config.roads = RoadsConfig(endpoint=ENDPOINT)
    return ctx


def client_for(ctx: Context) -> OsrmClient:
    client = OsrmClient(ctx)
    client._client.rate_limiter = None
    return client


def test_legs_use_matrix_ids_once_and_skip_legs_in_place() -> None:
    day1 = DayPlan(
        day=1,
        stops=[
            stop("start", None, 10.0, 106.0),
            stop("place", "gp:a", 10.1, 106.1),
            stop("place", "gp:a2", 10.1, 106.1),
            stop("rest", "rest", 10.0, 106.0),
            stop("nearby", "osm:node/1", 10.2, 106.2),
            stop("end", None, 10.0, 106.0),
        ],
    )
    day2 = DayPlan(
        day=2, stops=[stop("start", None, 10.0, 106.0), stop("place", "gp:a", 10.1, 106.1)]
    )
    legs = road_legs([day1, day2])
    assert [leg.key for leg in legs] == [
        "center>gp:a",
        "gp:a2>center",
        "center>osm:node/1",
        "osm:node/1>center",
    ]
    assert (legs[0].start, legs[0].end) == ((10.0, 106.0), (10.1, 106.1))


def test_sample_plan_has_a_leg_per_consecutive_pair() -> None:
    itinerary = build_dataset().itinerary
    assert itinerary is not None
    pairs = sum(len(day.stops) - 1 for day in itinerary.days)
    assert len(road_legs(itinerary.days)) == pairs


def test_route_url_puts_lng_first_and_drops_an_empty_profile() -> None:
    url = route_url(ENDPOINT + "/", "routed-car", (11.9404, 108.4419), (11.9465, 108.4583))
    assert (
        url == f"{ENDPOINT}/routed-car/route/v1/driving/108.441900,11.940400;108.458300,11.946500"
    )
    assert route_url(ENDPOINT, "", (1, 2), (3, 4)).startswith(f"{ENDPOINT}/route/v1/driving/")


@pytest.mark.parametrize(
    "payload",
    [
        {"code": "NoRoute", "routes": []},
        {"code": "Ok", "routes": []},
        {"code": "Ok", "routes": [{"distance": 1}]},
        [],
        None,
    ],
)
def test_parse_route_needs_an_ok_route_with_geometry(payload: object) -> None:
    assert parse_route(payload) is None


def test_roads_config_defaults_and_partial_profiles() -> None:
    roads = AppConfig.model_validate({"city": "X"}).roads
    assert roads.enabled is True
    assert roads.endpoint == "https://routing.openstreetmap.de"
    assert roads.profiles == {
        "motorbike": "routed-car",
        "car": "routed-car",
        "walking": "routed-foot",
    }
    custom = RoadsConfig.model_validate({"profiles": {"motorbike": "routed-bike"}})
    assert custom.profiles["motorbike"] == "routed-bike"
    assert custom.profiles["walking"] == "routed-foot"


def test_client_is_rate_limited_and_follows_the_travel_mode(osrm_ctx: Context) -> None:
    osrm_ctx.config.travel.mode = "walking"
    client = OsrmClient(osrm_ctx)
    assert client._client.rate_limiter is not None
    assert client._client.rate_limiter.min_interval_s == 1.0
    assert client._profile == "routed-foot"


@respx.mock
def test_route_is_parsed_cached_and_logged(osrm_ctx: Context) -> None:
    mock = respx.get(ROUTES).mock(return_value=httpx.Response(200, json=OK))
    for _ in range(2):
        route = client_for(osrm_ctx).route((10.0, 106.0), (10.1, 106.1), note="center>gp:a")
        assert route == RoadRoute(polyline=GEOMETRY, distance_m=1200.5, duration_s=300)
    assert mock.call_count == 1
    assert mock.calls[0].request.url.params["geometries"] == "polyline"
    assert mock.calls[0].request.headers["User-Agent"].startswith("tiktok-trip/")
    with osrm_ctx.paths.api_log.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert [(row["service"], row["sku"], row["cache_hit"]) for row in rows] == [
        ("osrm", "osrm_route", "False"),
        ("osrm", "osrm_route", "True"),
    ]
    assert rows[0]["note"] == "routed-car:center>gp:a"


@respx.mock
def test_no_route_is_none_and_not_cached(osrm_ctx: Context) -> None:
    mock = respx.get(ROUTES).mock(
        side_effect=[
            httpx.Response(200, json={"code": "NoRoute", "routes": []}),
            httpx.Response(400, json={"code": "NoSegment", "message": "Could not find a match"}),
            httpx.Response(200, json=OK),
        ]
    )
    client = client_for(osrm_ctx)
    assert client.route((10.0, 106.0), (10.1, 106.1)) is None
    assert client.route((10.0, 106.0), (10.1, 106.1)) is None
    assert client.route((10.0, 106.0), (10.1, 106.1)) is not None
    assert mock.call_count == 3


@respx.mock
def test_server_failure_leaves_legs_straight_and_stops_sending(
    osrm_ctx: Context, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(CachedClient._send.retry, "sleep", lambda seconds: None)  # type: ignore[attr-defined]
    itinerary = build_dataset().itinerary
    assert itinerary is not None
    legs = road_legs(itinerary.days)
    cached = legs[-1]
    respx.get(ROUTES).mock(return_value=httpx.Response(200, json=OK))
    client_for(osrm_ctx).route(cached.start, cached.end)
    respx.clear()
    failing = respx.get(ROUTES).mock(return_value=httpx.Response(503))
    with caplog.at_level(logging.WARNING):
        roads = collect_roads(client_for(osrm_ctx), legs)
    assert roads == {cached.key: GEOMETRY}
    assert failing.call_count == 4
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert f"{len(legs) - 1} of {len(legs)} legs" in warnings[0]
    assert len(list((osrm_ctx.paths.cache / "osrm").glob("*.json"))) == 1


@respx.mock
def test_transport_error_is_not_fatal(osrm_ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(CachedClient._send.retry, "sleep", lambda seconds: None)  # type: ignore[attr-defined]
    monkeypatch.setattr(RateLimiter, "wait", lambda self: None)
    respx.get(ROUTES).mock(side_effect=httpx.ConnectError("dns"))
    itinerary = build_dataset().itinerary
    assert fetch_roads(osrm_ctx, itinerary) == {}


@respx.mock
def test_fetch_roads_keys_every_leg(osrm_ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(RateLimiter, "wait", lambda self: None)
    respx.get(ROUTES).mock(return_value=httpx.Response(200, json=OK))
    itinerary = build_dataset().itinerary
    assert itinerary is not None
    roads = fetch_roads(osrm_ctx, itinerary)
    assert set(roads) == {leg.key for leg in road_legs(itinerary.days)}
    assert "center>gp:pho1" in roads


@respx.mock
def test_disabled_or_no_plan_sends_nothing(ctx: Context) -> None:
    itinerary = build_dataset().itinerary
    assert ctx.config.roads.enabled is False
    assert fetch_roads(ctx, itinerary) == {}
    ctx.config.roads.enabled = True
    assert fetch_roads(ctx, None) == {}
    assert not respx.calls
