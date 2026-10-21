import json
import logging

import httpx
import pytest
import respx

from tiktok_trip.clients.google_nearby import FIELD_MASK, NEARBY_URL, parse_places
from tiktok_trip.clients.overpass import (
    OVERPASS_URL,
    OverpassClient,
    OverpassElement,
    OverpassUnavailableError,
    build_query,
    is_complete_answer,
    parse_elements,
)
from tiktok_trip.context import Context
from tiktok_trip.http import CachedClient, RateLimiter
from tiktok_trip.models import Center, NearbySpot, SpatialResult, Zone
from tiktok_trip.steps import nearby
from tiktok_trip.storage import load_models, save_model

ZONE_A = Zone(id="N-1", sector="N", lat=10.80, lng=106.70, place_ids=["gp:a"])
ZONE_B = Zone(id="E-1", sector="E", lat=10.78, lng=106.74, place_ids=["gp:b"])

SHARED_TEMPLE = {
    "type": "relation",
    "id": 99,
    "center": {"lat": 10.785, "lon": 106.735},
    "tags": {"amenity": "place_of_worship", "name": "Chùa X"},
}
PAYLOAD_A = {
    "elements": [
        {
            "type": "node",
            "id": 1,
            "lat": 10.801,
            "lon": 106.701,
            "tags": {"historic": "monument", "name": "Tượng đài", "wikidata": "Q1"},
        },
        {
            "type": "way",
            "id": 2,
            "center": {"lat": 10.802, "lon": 106.702},
            "tags": {"tourism": "museum", "name": "Bảo tàng"},
        },
        {"type": "node", "id": 3, "lat": 10.8, "lon": 106.7, "tags": {"tourism": "viewpoint"}},
        {
            "type": "node",
            "id": 4,
            "lat": 10.803,
            "lon": 106.703,
            "tags": {"historic": "ruins", "name": "Phế tích"},
        },
        SHARED_TEMPLE,
    ]
}
PAYLOAD_B = {
    "elements": [
        SHARED_TEMPLE,
        {
            "type": "node",
            "id": 5,
            "lat": 10.781,
            "lon": 106.741,
            "tags": {"tourism": "viewpoint", "name": "Gác"},
        },
    ]
}


def test_build_query_covers_kinds_and_center() -> None:
    query = build_query(10.8, 106.7, 1200)
    assert "(around:1200,10.800000,106.700000)" in query
    assert '"tourism"~"^(attraction|museum|viewpoint|artwork)$"' in query
    assert '["historic"]["name"]' in query
    assert '["amenity"="place_of_worship"]["name"]' in query
    assert query.rstrip().endswith("out center;")


def test_parse_elements_handles_node_and_way_center() -> None:
    elements = parse_elements(PAYLOAD_A)
    assert [e.ref for e in elements] == ["osm:node/1", "osm:way/2", "osm:node/4", "osm:relation/99"]
    way = elements[1]
    assert (way.lat, way.lng, way.kind) == (10.802, 106.702, "museum")
    assert elements[0].kind == "monument"
    assert elements[0].is_notable
    assert elements[3].kind == "place_of_worship"


def _overpass_response(request: httpx.Request) -> httpx.Response:
    query = request.url.params["data"]
    payload = PAYLOAD_A if f"{ZONE_A.lat:.6f}" in query else PAYLOAD_B
    return httpx.Response(200, json=payload)


@respx.mock
def test_run_overpass_ranks_dedupes_and_caps(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(RateLimiter, "wait", lambda self: None)
    route = respx.get(OVERPASS_URL).mock(side_effect=_overpass_response)
    center = Center(lat=10.77, lng=106.70, source="city_default", label="HCMC")
    save_model(
        ctx.paths.spatial_file, SpatialResult(center=center, sectors=8, zones=[ZONE_A, ZONE_B])
    )

    nearby.run(ctx)
    nearby.run(ctx)

    spots = load_models(ctx.paths.nearby_file, NearbySpot)
    by_zone: dict[str, list[str]] = {}
    for spot in spots:
        by_zone.setdefault(spot.zone_id, []).append(spot.id)
    assert by_zone["N-1"] == ["osm:node/1", "osm:way/2", "osm:node/4"]
    assert by_zone["E-1"] == ["osm:node/5", "osm:relation/99"]
    assert all(s.source == "overpass" for s in spots)
    assert route.call_count == 2
    assert route.calls[0].request.headers["User-Agent"].startswith("tiktok-trip")


def test_overpass_soft_errors_are_not_cached() -> None:
    assert is_complete_answer(PAYLOAD_A)
    assert is_complete_answer({"elements": []})
    assert not is_complete_answer({"remark": "runtime error: Query timed out", "elements": []})
    assert not is_complete_answer({"version": 0.6})


@respx.mock
def test_overpass_client_retries_after_soft_error(
    ctx: Context, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(RateLimiter, "wait", lambda self: None)
    monkeypatch.setattr(ctx.config.nearby, "overpass_endpoints", [OVERPASS_URL])
    soft = {"elements": [], "remark": 'runtime error: Query timed out in "query"'}
    route = respx.get(OVERPASS_URL).mock(
        side_effect=[httpx.Response(200, json=soft), httpx.Response(200, json=PAYLOAD_A)]
    )
    client = OverpassClient(ctx)
    with pytest.raises(OverpassUnavailableError):
        client.around(ZONE_A.lat, ZONE_A.lng, 1.2)
    assert "Query timed out" in caplog.text
    first = client.around(ZONE_A.lat, ZONE_A.lng, 1.2)
    again = client.around(ZONE_A.lat, ZONE_A.lng, 1.2)
    assert first == again == parse_elements(PAYLOAD_A)
    assert route.call_count == 2


MIRROR_1 = "https://overpass.kumi.systems/api/interpreter"
MIRROR_2 = "https://overpass.private.coffee/api/interpreter"
GATEWAY_TIMEOUT = httpx.Response(502, text="502 Gateway Timeout: server is at capacity")


@pytest.fixture
def no_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(RateLimiter, "wait", lambda self: None)
    monkeypatch.setattr(CachedClient._send.retry, "sleep", lambda seconds: None)  # type: ignore[attr-defined]


def _save_zones(ctx: Context, *zones: Zone) -> None:
    center = Center(lat=10.77, lng=106.70, source="city_default", label="HCMC")
    save_model(ctx.paths.spatial_file, SpatialResult(center=center, sectors=8, zones=list(zones)))


def _cache_files(ctx: Context) -> list[str]:
    return sorted(p.name for p in (ctx.paths.cache / "overpass").glob("*.json"))


def test_default_endpoints_start_with_canonical_url(ctx: Context) -> None:
    assert ctx.config.nearby.overpass_endpoints == [OVERPASS_URL, MIRROR_1, MIRROR_2]


@respx.mock
def test_mirror_answers_when_primary_fails_and_cache_is_shared(
    ctx: Context, no_wait: None, caplog: pytest.LogCaptureFixture
) -> None:
    primary = respx.get(OVERPASS_URL).mock(return_value=GATEWAY_TIMEOUT)
    mirror = respx.get(MIRROR_1).mock(side_effect=_overpass_response)
    last = respx.get(MIRROR_2).mock(side_effect=_overpass_response)

    assert OverpassClient(ctx).around(ZONE_A.lat, ZONE_A.lng, 1.2, note="N-1") == parse_elements(
        PAYLOAD_A
    )
    assert primary.call_count == 4
    assert mirror.call_count == 1
    assert last.call_count == 0
    assert "overpass-api.de failed for N-1 (HTTP 502)" in caplog.text

    primary.mock(side_effect=_overpass_response)
    again = OverpassClient(ctx).around(ZONE_A.lat, ZONE_A.lng, 1.2, note="N-1")
    assert again == parse_elements(PAYLOAD_A)
    assert (primary.call_count, mirror.call_count) == (4, 1)
    assert len(_cache_files(ctx)) == 1


@respx.mock
def test_transport_error_falls_through_to_next_mirror(ctx: Context, no_wait: None) -> None:
    respx.get(OVERPASS_URL).mock(side_effect=httpx.ConnectError("refused"))
    respx.get(MIRROR_1).mock(return_value=httpx.Response(200, text="<html>busy</html>"))
    respx.get(MIRROR_2).mock(side_effect=_overpass_response)
    assert OverpassClient(ctx).around(ZONE_B.lat, ZONE_B.lng, 1.2) == parse_elements(PAYLOAD_B)


def _zone_b_down(request: httpx.Request) -> httpx.Response:
    if f"{ZONE_B.lat:.6f}" in request.url.params["data"]:
        return GATEWAY_TIMEOUT
    return _overpass_response(request)


@respx.mock
def test_failed_zone_is_skipped_not_cached_and_retried_later(
    ctx: Context, no_wait: None, caplog: pytest.LogCaptureFixture
) -> None:
    routes = [respx.get(url).mock(side_effect=_zone_b_down) for url in (OVERPASS_URL, MIRROR_1)]
    routes.append(respx.get(MIRROR_2).mock(side_effect=httpx.ReadTimeout("slow")))
    _save_zones(ctx, ZONE_A, ZONE_B)

    nearby.run(ctx)

    spots = load_models(ctx.paths.nearby_file, NearbySpot)
    assert {s.zone_id for s in spots} == {"N-1"}
    assert len(_cache_files(ctx)) == 1
    assert "failed for zone E-1" in caplog.text
    assert "2 zones, 1 with nearby spots, 1 failed (E-1; re-run `tiktok-trip nearby` later)" in (
        caplog.text
    )
    sent_before = [route.call_count for route in routes]

    for route in routes:
        route.mock(side_effect=_overpass_response)
    caplog.set_level(logging.INFO, logger=nearby.__name__)
    nearby.run(ctx)

    sent = [route.call_count - before for route, before in zip(routes, sent_before, strict=True)]
    assert sent == [1, 0, 0]
    assert f"{ZONE_B.lat:.6f}" in routes[0].calls[-1].request.url.params["data"]
    spots = load_models(ctx.paths.nearby_file, NearbySpot)
    assert {s.zone_id for s in spots} == {"N-1", "E-1"}
    assert len(_cache_files(ctx)) == 2
    assert "2 zones, 2 with nearby spots, 0 failed" in caplog.text


def _element(name: str, osm_id: int = 7, **tags: str) -> OverpassElement:
    return OverpassElement(
        osm_type="node", osm_id=osm_id, lat=10.8, lng=106.7, tags={"name": name, **tags}
    )


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({"amenity": "bar", "tourism": "attraction"}, False),
        ({"amenity": "pub"}, False),
        ({"amenity": "nightclub"}, False),
        ({"shop": "gift", "tourism": "attraction"}, False),
        ({"office": "company", "historic": "building"}, False),
        ({"amenity": "bar", "tourism": "attraction", "wikidata": "Q1"}, True),
        ({"shop": "books", "historic": "building", "wikipedia": "vi:X"}, True),
        ({"tourism": "attraction"}, True),
        ({"tourism": "museum"}, True),
        ({"tourism": "viewpoint"}, True),
        ({"tourism": "artwork"}, True),
        ({"historic": "monument"}, True),
        ({"amenity": "place_of_worship"}, True),
        ({"leisure": "park", "tourism": "attraction"}, True),
        ({"leisure": "garden", "tourism": "attraction"}, True),
    ],
)
def test_overpass_is_sight(tags: dict[str, str], expected: bool) -> None:
    assert _element("Maze", **tags).is_sight is expected


CITY_NAMES = ["Đà Lạt", "Da Lat", "Dalat", "Lâm Đồng"]


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Đà Lạt", False),
        ("ĐÀ LẠT", False),
        (" Dalat ", False),
        ("Da-Lat", False),
        ("Lam Dong", False),
        ("Ga Đà Lạt", True),
        ("Đình Đà Lạt", True),
        ("Yersin", True),
        ("3D World", True),
        ("Ab", False),
        ("  ", False),
        ("11.94083, 108.470294", False),
    ],
)
def test_is_listable_name(name: str, expected: bool) -> None:
    assert nearby.is_listable_name(name, CITY_NAMES) is expected


NOISY_PAYLOAD = {
    "elements": [
        *PAYLOAD_A["elements"],
        {
            "type": "node",
            "id": 6,
            "lat": 10.8005,
            "lon": 106.7005,
            "tags": {"tourism": "artwork", "name": "Sài Gòn"},
        },
        {
            "type": "node",
            "id": 7,
            "lat": 10.8001,
            "lon": 106.7001,
            "tags": {"tourism": "attraction", "amenity": "bar", "name": "Maze Bar"},
        },
        {
            "type": "node",
            "id": 8,
            "lat": 10.8002,
            "lon": 106.7002,
            "tags": {"tourism": "artwork", "name": "10.8, 106.7"},
        },
    ]
}


@respx.mock
def test_run_drops_city_named_bar_and_coordinate_spots(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(RateLimiter, "wait", lambda self: None)
    monkeypatch.setattr(ctx.config.nearby, "top_n", 10)
    respx.get(OVERPASS_URL).mock(return_value=httpx.Response(200, json=NOISY_PAYLOAD))
    _save_zones(ctx, ZONE_A)

    nearby.run(ctx)

    ids = {s.id for s in load_models(ctx.paths.nearby_file, NearbySpot)}
    assert ids == {"osm:node/1", "osm:way/2", "osm:node/4", "osm:relation/99"}


def test_select_spots_excludes_known_places() -> None:
    found = [nearby.overpass_found(e, ZONE_A) for e in parse_elements(PAYLOAD_A)]
    spots = nearby.select_spots(found, [ZONE_A], top_n=10, exclude_ids={"osm:way/2"})
    assert "osm:way/2" not in {s.id for s in spots}


GOOGLE_PAYLOAD = {
    "places": [
        {
            "id": "abc",
            "displayName": {"text": "Dinh Độc Lập"},
            "location": {"latitude": 10.777, "longitude": 106.695},
            "rating": 4.5,
            "userRatingCount": 900,
        },
        {
            "id": "def",
            "displayName": {"text": "Nhà thờ"},
            "location": {"latitude": 10.779, "longitude": 106.699},
            "rating": 4.7,
            "userRatingCount": 30000,
        },
    ]
}


def test_parse_google_places() -> None:
    hits = parse_places(GOOGLE_PAYLOAD)
    assert [h.ref for h in hits] == ["gp:abc", "gp:def"]
    assert hits[1].rating_count == 30000


@respx.mock
def test_run_google_provider(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ctx.config.nearby, "provider", "google")
    monkeypatch.setattr(ctx.secrets, "google_maps_key", "KEY")
    monkeypatch.setattr(ctx.config.nearby, "top_n", 1)
    route = respx.post(NEARBY_URL).mock(return_value=httpx.Response(200, json=GOOGLE_PAYLOAD))
    center = Center(lat=10.77, lng=106.70, source="city_default", label="HCMC")
    save_model(ctx.paths.spatial_file, SpatialResult(center=center, sectors=8, zones=[ZONE_A]))

    nearby.run(ctx)

    spots = load_models(ctx.paths.nearby_file, NearbySpot)
    assert [(s.id, s.source, s.kind) for s in spots] == [("gp:def", "google", "tourist_attraction")]
    request = route.calls[0].request
    assert request.headers["X-Goog-FieldMask"] == FIELD_MASK
    body = json.loads(request.content)
    assert body["includedTypes"] == ["tourist_attraction"]
    assert body["rankPreference"] == "POPULARITY"
    assert body["locationRestriction"]["circle"]["radius"] == 1200


def test_run_requires_spatial(ctx: Context) -> None:
    with pytest.raises(RuntimeError, match="spatial"):
        nearby.run(ctx)
