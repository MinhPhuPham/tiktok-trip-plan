import json
import logging
from collections.abc import Iterator

import httpx
import pytest
import respx

from tiktok_trip.clients import geocoder
from tiktok_trip.clients.google_places import TEXT_SEARCH_URL
from tiktok_trip.clients.nominatim import BASE_URL as NOMINATIM_URL
from tiktok_trip.clients.photon import BASE_URL as PHOTON_URL
from tiktok_trip.clients.photon import PhotonClient, parse_features
from tiktok_trip.config import AppConfig
from tiktok_trip.context import Context
from tiktok_trip.http import CachedClient, RateLimiter
from tiktok_trip.steps import spatial

DALAT_CITY = {
    "type": "Feature",
    "geometry": {"type": "Point", "coordinates": [108.4381, 11.9418]},
    "properties": {
        "osm_type": "N",
        "osm_id": 2525410513,
        "osm_key": "place",
        "osm_value": "city",
        "type": "city",
        "name": "Da Lat",
        "state": "Lâm Đồng Province",
        "country": "Vietnam",
        "countrycode": "VN",
        "extent": [108.35, 12.05, 108.55, 11.85],
    },
}
DALAT_LAKE = {
    "type": "Feature",
    "geometry": {"type": "Point", "coordinates": [108.4421, 11.9405]},
    "properties": {
        "osm_type": "W",
        "osm_id": 25640185,
        "osm_key": "natural",
        "osm_value": "water",
        "name": "Hồ Xuân Hương",
        "city": "Da Lat",
        "state": "Lâm Đồng Province",
        "country": "Vietnam",
        "countrycode": "VN",
    },
}
FOREIGN_CITY = {
    "type": "Feature",
    "geometry": {"type": "Point", "coordinates": [-81.5, 28.4]},
    "properties": {
        "osm_type": "N",
        "osm_id": 7,
        "osm_key": "place",
        "osm_value": "town",
        "name": "Dalat",
        "country": "United States",
        "countrycode": "US",
    },
}
GOOGLE_DALAT = {
    "places": [
        {
            "id": "ChIJdalat",
            "displayName": {"text": "Đà Lạt"},
            "formattedAddress": "Đà Lạt, Lâm Đồng, Việt Nam",
            "location": {"latitude": 11.9404, "longitude": 108.4583},
            "types": ["locality", "political"],
        }
    ]
}


@pytest.fixture
def fast(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(RateLimiter, "wait", lambda self: None)
    monkeypatch.setattr(CachedClient._send.retry, "sleep", lambda seconds: None)  # type: ignore[attr-defined]


@pytest.fixture
def no_key(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> Context:
    monkeypatch.setattr(ctx.secrets, "google_maps_key", None)
    return ctx


@pytest.fixture
def router(fast: None) -> Iterator[respx.MockRouter]:
    with respx.mock(assert_all_called=False) as mock:
        yield mock


def test_parse_photon_feature_filters_country() -> None:
    points = parse_features({"features": [FOREIGN_CITY, DALAT_LAKE, DALAT_CITY]}, "VN")
    assert [p.osm_ref for p in points] == ["osm:way/25640185", "osm:node/2525410513"]
    lake = points[0]
    assert (lake.lat, lake.lng, lake.source) == (11.9405, 108.4421, "photon")
    assert (lake.osm_class, lake.osm_kind) == ("natural", "water")
    assert lake.display_name == "Hồ Xuân Hương, Da Lat, Lâm Đồng Province, Vietnam"


def test_photon_city_point_prefers_place_city(no_key: Context, router: respx.MockRouter) -> None:
    route = router.get(PHOTON_URL).mock(
        return_value=httpx.Response(200, json={"features": [DALAT_LAKE, DALAT_CITY]})
    )
    point = PhotonClient(no_key).city_point("Đà Lạt")
    assert point is not None
    assert point.osm_ref == "osm:node/2525410513"
    params = route.calls.last.request.url.params
    assert (params["q"], params["lang"]) == ("Đà Lạt", "en")


def test_nominatim_connect_error_falls_back_to_photon(
    no_key: Context, router: respx.MockRouter, caplog: pytest.LogCaptureFixture
) -> None:
    nominatim = router.get(f"{NOMINATIM_URL}/search").mock(
        side_effect=httpx.ConnectError("nodename nor servname provided")
    )
    router.get(PHOTON_URL).mock(return_value=httpx.Response(200, json={"features": [DALAT_CITY]}))
    chain = geocoder.build(no_key)
    with caplog.at_level(logging.WARNING, logger="tiktok_trip.clients.geocoder"):
        first = chain.city_point("Đà Lạt")
        second = chain.geocode("Da Lat")
    assert first is not None and first.source == "photon"
    assert second is not None and second.source == "photon"
    calls_after_failure = nominatim.call_count
    chain.city_point("Đà Lạt")
    assert nominatim.call_count == calls_after_failure
    warnings = [r.getMessage() for r in caplog.records]
    assert len([w for w in warnings if "nominatim" in w]) == 1
    assert "ConnectError" in warnings[0]


def test_nominatim_empty_falls_back_to_photon(no_key: Context, router: respx.MockRouter) -> None:
    router.get(f"{NOMINATIM_URL}/search").mock(return_value=httpx.Response(200, json=[]))
    router.get(PHOTON_URL).mock(return_value=httpx.Response(200, json={"features": [DALAT_LAKE]}))
    point = geocoder.build(no_key).geocode("Hồ Xuân Hương")
    assert point is not None
    assert (point.source, point.osm_ref) == ("photon", "osm:way/25640185")


def test_all_fail_without_key_finds_nothing(
    no_key: Context, router: respx.MockRouter, caplog: pytest.LogCaptureFixture
) -> None:
    router.get(f"{NOMINATIM_URL}/search").mock(side_effect=httpx.ConnectError("dns"))
    router.get(PHOTON_URL).mock(return_value=httpx.Response(503))
    chain = geocoder.build(no_key)
    with caplog.at_level(logging.WARNING, logger="tiktok_trip.clients.geocoder"):
        assert chain.city_point("Đà Lạt") is None
        assert chain.search("Đà Lạt") == []
    messages = [r.getMessage() for r in caplog.records if r.name == geocoder.log.name]
    assert [m.split(":")[0] for m in messages] == [
        "Geocoder nominatim skipped",
        "Geocoder photon skipped",
        "Geocoder google skipped",
    ]
    assert "GOOGLE_MAPS_KEY" in messages[2]
    config = AppConfig.model_validate({"city": "Đà Lạt"})
    with pytest.raises(spatial.CenterNotFoundError):
        spatial.select_center(config, lambda: chain)


def test_google_fallback_maps_first_locality(ctx: Context, router: respx.MockRouter) -> None:
    ctx.secrets.google_maps_key = "test-key"
    router.get(f"{NOMINATIM_URL}/search").mock(side_effect=httpx.ConnectError("dns"))
    router.get(PHOTON_URL).mock(return_value=httpx.Response(200, json={"features": []}))
    google = router.post(TEXT_SEARCH_URL).mock(return_value=httpx.Response(200, json=GOOGLE_DALAT))
    chain = geocoder.build(ctx)
    point = chain.city_point("Đà Lạt")
    assert point is not None
    assert (point.lat, point.lng, point.source) == (11.9404, 108.4583, "google")
    assert point.osm_ref is None
    assert point.display_name == "Đà Lạt, Lâm Đồng, Việt Nam"
    body = json.loads(google.calls.last.request.content)
    assert body["regionCode"] == "VN"
    assert "locationBias" not in body

    config = AppConfig.model_validate({"city": "Đà Lạt", "city_profile": {"center_landmark": ""}})
    center = spatial.select_center(config, lambda: chain)
    assert (center.label, center.place_id) == ("Trung tâm Đà Lạt", None)

    assert chain.osm_only().geocode("Đà Lạt") is None
    assert google.call_count == 1
