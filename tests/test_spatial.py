import json
import math
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
import respx

from tiktok_trip import geo
from tiktok_trip.clients import geocoder as geocoding
from tiktok_trip.clients.google_places import TEXT_SEARCH_URL
from tiktok_trip.clients.nominatim import BASE_URL
from tiktok_trip.clients.photon import BASE_URL as PHOTON_URL
from tiktok_trip.config import AppConfig, SpatialConfig
from tiktok_trip.context import Context
from tiktok_trip.http import CachedClient, RateLimiter
from tiktok_trip.models import Center, Place, SpatialResult
from tiktok_trip.steps import spatial
from tiktok_trip.storage import load_model, load_models, read_json, write_json


def band(text: str) -> str:
    return text.replace("-", geo.EN_DASH)


CENTER = Center(lat=10.7769, lng=106.7009, source="city_default", label="HCMC")
KM_LAT = 1 / 111.195


@dataclass
class Point:
    lat: float
    lng: float
    source: str = "nominatim"
    google_id: str | None = None
    display_name: str = ""


class FakeGeocoder:
    def __init__(self, geocode: Point | None = None, city: Point | None = None) -> None:
        self._geocode = geocode
        self._city = city
        self.queries: list[str] = []

    def geocode(self, query: str) -> Point | None:
        self.queries.append(query)
        return self._geocode

    def city_point(self, city: str) -> Point | None:
        self.queries.append(f"city:{city}")
        return self._city

    def find(
        self,
        query: str,
        accept: Callable[[Point], bool],
        *,
        near: tuple[float, float] | None = None,
    ) -> Point | None:
        self.queries.append(query)
        return self._geocode if self._geocode and accept(self._geocode) else None

    def google_first(self) -> "FakeGeocoder":
        return self


def _config(hotel: str = "", override: str = "", landmark: str = "") -> AppConfig:
    return AppConfig.model_validate(
        {
            "city": "HCMC",
            "center": {"hotel": hotel, "override": override},
            "city_profile": {"center_landmark": landmark, "center_landmark_en": ""},
        }
    )


def _place(pid: str, d_lat_km: float, d_lng_km: float = 0.0, **extra: object) -> Place:
    return Place.model_validate(
        {
            "id": pid,
            "name": pid,
            "address": "x",
            "lat": CENTER.lat + d_lat_km * KM_LAT,
            "lng": CENTER.lng + d_lng_km * KM_LAT / math.cos(math.radians(CENTER.lat)),
            "confidence": 0.9,
            **extra,
        }
    )


def test_center_prefers_hotel() -> None:
    geocoder = FakeGeocoder(geocode=Point(1, 2, display_name="123 Le Loi, Q1"), city=Point(1, 2))
    center = spatial.select_center(_config(hotel="123 Le Loi", override="1,1"), lambda: geocoder)
    assert (center.lat, center.lng, center.source, center.label) == (1, 2, "hotel", "123 Le Loi")
    assert center.place_id is None
    assert center.maps_url.endswith("query=1.0,2.0")
    assert geocoder.queries == ["city:HCMC", "123 Le Loi"]


def test_hotel_geocoded_by_google_keeps_place_id() -> None:
    hotel = Point(1, 2, source="google", google_id="ChIJhotel", display_name="Hotel Colline, x")
    geocoder = FakeGeocoder(geocode=hotel)
    center = spatial.select_center(_config(hotel="Hotel Colline"), lambda: geocoder)
    assert center.place_id == "ChIJhotel"
    assert "query_place_id=ChIJhotel" in center.maps_url


@pytest.mark.parametrize("field", ["hotel", "override"])
def test_center_latlng_needs_no_geocoder(field: str) -> None:
    def no_network() -> FakeGeocoder:
        raise AssertionError("geocoder should not be built")

    center = spatial.select_center(_config(**{field: "10.5, 106.5"}), no_network)
    assert (center.lat, center.lng, center.source, center.place_id) == (10.5, 106.5, field, None)


def test_center_override_by_name() -> None:
    geocoder = FakeGeocoder(geocode=Point(3, 4, display_name="Ben Thanh Market, Lê Lợi"))
    center = spatial.select_center(_config(override="Ben Thanh Market, HCMC"), lambda: geocoder)
    assert (center.source, center.label, center.lat) == ("override", "Ben Thanh Market, HCMC", 3)


def test_center_city_point_then_fallback() -> None:
    city = spatial.select_center(_config(), lambda: FakeGeocoder(Point(5, 5), Point(7, 7)))
    assert (city.lat, city.source, city.label) == (7, "city_default", "Trung tâm HCMC")
    assert (city.label_en, city.place_id) == ("HCMC center", None)
    fallback = spatial.select_center(_config(), lambda: FakeGeocoder(Point(5, 5), None))
    assert (fallback.lat, fallback.source) == (5, "city_default")


def test_center_landmark_without_city_point_is_accepted() -> None:
    geocoder = FakeGeocoder(geocode=Point(5, 5, source="photon"))
    center = spatial.select_center(_config(landmark="Chợ Bến Thành"), lambda: geocoder)
    assert (center.lat, center.source, center.label) == (5, "city_default", "Chợ Bến Thành")
    assert geocoder.queries == ["city:HCMC", "HCMC", "Chợ Bến Thành, HCMC"]


def test_center_not_found_is_clear() -> None:
    with pytest.raises(spatial.CenterNotFoundError, match=r"center\.hotel.*lat,lng"):
        spatial.select_center(_config(hotel="nowhere"), FakeGeocoder)
    wrong = FakeGeocoder(geocode=Point(1, 2, display_name="Somewhere Else"))
    with pytest.raises(spatial.CenterNotFoundError, match=r"center\.override"):
        spatial.select_center(_config(override="Ben Thanh Market"), lambda: wrong)
    with pytest.raises(spatial.CenterNotFoundError, match="override"):
        spatial.select_center(_config(), FakeGeocoder)


def test_analyze_sectors_rings_and_zones() -> None:
    places = [
        _place("n_near", 1.0),
        _place("n_near2", 1.8),
        _place("n_far", 8.0),
        _place("east", 0.0, 3.0),
        _place("south", -12.0),
    ]
    cfg = SpatialConfig(sectors=8, cluster_eps_km=1.5, cluster_min_places=1, center_sanity_km=50)
    spatials, result = spatial.analyze(places, CENTER, cfg)
    by_id = {p.id: s for p, s in zip(places, spatials, strict=True)}
    assert by_id["n_near"].sector == "N"
    assert by_id["n_near"].ring == band("0-2km")
    assert by_id["n_far"].ring == band("5-10km")
    assert by_id["east"].sector == "E"
    assert by_id["east"].distance_km == pytest.approx(3.0, abs=0.05)
    assert by_id["south"].ring == "10km+"
    assert by_id["n_near"].zone == by_id["n_near2"].zone == "N-1"
    assert by_id["n_far"].zone == "N-2"
    zones = {z.id: z for z in result.zones}
    assert set(zones) == {"N-1", "N-2", "E-1", "S-1"}
    assert zones["N-1"].place_ids == ["n_near", "n_near2"]
    assert zones["N-1"].lat == pytest.approx(CENTER.lat + 1.4 * KM_LAT, abs=1e-5)
    assert result.warnings == []


def test_noise_points_become_single_zones_numbered_by_distance() -> None:
    places = [_place("far", 6.0), _place("near", 2.0), _place("mid", 4.0)]
    cfg = SpatialConfig(cluster_eps_km=0.5, cluster_min_places=2)
    _, result = spatial.analyze(places, CENTER, cfg)
    assert [(z.id, z.place_ids) for z in result.zones] == [
        ("N-1", ["near"]),
        ("N-2", ["mid"]),
        ("N-3", ["far"]),
    ]


def test_sanity_warning_when_center_is_far() -> None:
    places = [_place("a", 30.0), _place("b", 31.0)]
    _, result = spatial.analyze(places, CENTER, SpatialConfig(center_sanity_km=10))
    assert len(result.warnings) == 1
    assert "center.hotel" in result.warnings[0]


@respx.mock
def test_run_writes_spatial_and_preserves_place_fields(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(RateLimiter, "wait", lambda self: None)
    monkeypatch.setattr(ctx.secrets, "google_maps_key", None)
    route = respx.get(f"{BASE_URL}/search").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "lat": str(CENTER.lat),
                    "lon": str(CENTER.lng),
                    "display_name": "HCMC",
                    "osm_type": "node",
                    "osm_id": 1,
                    "class": "place",
                    "type": "city",
                }
            ],
        )
    )
    raw = [
        {**_place("a", 1.0, status="skip").model_dump(mode="json"), "custom_field": 7},
        _place("b", 0.0, -4.0).model_dump(mode="json"),
    ]
    write_json(ctx.paths.places_file, raw)

    spatial.run(ctx)
    spatial.run(ctx)

    stored = read_json(ctx.paths.places_file)
    assert stored[0]["custom_field"] == 7
    assert stored[0]["status"] == "skip"
    places = load_models(ctx.paths.places_file, Place)
    assert [p.spatial.sector if p.spatial else None for p in places] == ["N", "W"]
    assert [p.spatial.zone if p.spatial else None for p in places] == [None, "W-1"]
    result = load_model(ctx.paths.spatial_file, SpatialResult)
    assert (result.center.source, result.center.label) == ("city_default", "Chợ Bến Thành")
    assert result.center.label_en == "Ben Thanh Market"
    assert {z.id for z in result.zones} == {"W-1"}
    assert route.call_count == 2


DALAT_CITY = (11.9418, 108.4381)
DALAT_MARKET = (11.9425, 108.4382)
DALAT_CONFIG = AppConfig.model_validate(
    {
        "city": "Đà Lạt",
        "city_profile": {"center_landmark": "Chợ Đà Lạt", "center_landmark_en": "Da Lat Market"},
    }
)


def _photon_feature(point: tuple[float, float], name: str, key: str, value: str) -> dict[str, Any]:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [point[1], point[0]]},
        "properties": {
            "osm_type": "N",
            "osm_id": 1,
            "osm_key": key,
            "osm_value": value,
            "name": name,
            "countrycode": "VN",
        },
    }


@pytest.fixture
def router(monkeypatch: pytest.MonkeyPatch) -> Iterator[respx.MockRouter]:
    monkeypatch.setattr(RateLimiter, "wait", lambda self: None)
    monkeypatch.setattr(CachedClient._send.retry, "sleep", lambda seconds: None)  # type: ignore[attr-defined]
    with respx.mock(assert_all_called=False) as mock:
        mock.get(f"{BASE_URL}/search").mock(side_effect=httpx.ConnectError("dns"))
        yield mock


def _photon(router: respx.MockRouter, landmark: tuple[float, float] | None) -> respx.Route:
    """Photon answers the city query with the city node and the landmark query with `landmark`."""

    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.params["q"].startswith("Chợ Đà Lạt"):
            hits = (
                [_photon_feature(landmark, "Chợ Đà Lạt", "amenity", "marketplace")]
                if landmark
                else []
            )
            return httpx.Response(200, json={"features": hits})
        city = _photon_feature(DALAT_CITY, "Đà Lạt", "place", "city")
        return httpx.Response(200, json={"features": [city]})

    return router.get(PHOTON_URL).mock(side_effect=answer)


def test_landmark_via_google_links_the_listing(ctx: Context, router: respx.MockRouter) -> None:
    ctx.secrets.google_maps_key = "test-key"
    _photon(router, None)
    google = router.post(TEXT_SEARCH_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "places": [
                    {
                        "id": "ChIJmarket",
                        "displayName": {"text": "Chợ Đà Lạt"},
                        "formattedAddress": "Nguyễn Thị Minh Khai, Đà Lạt",
                        "location": {"latitude": DALAT_MARKET[0], "longitude": DALAT_MARKET[1]},
                        "types": ["market"],
                    }
                ]
            },
        )
    )
    chain = geocoding.build(ctx)
    center = spatial.select_center(DALAT_CONFIG, lambda: chain)
    assert (center.lat, center.lng) == DALAT_MARKET
    assert (center.source, center.label, center.label_en) == (
        "city_default",
        "Chợ Đà Lạt",
        "Da Lat Market",
    )
    assert center.place_id == "ChIJmarket"
    assert "query_place_id=ChIJmarket" in center.maps_url
    assert google.call_count == 1
    assert json.loads(google.calls.last.request.content)["textQuery"] == "Chợ Đà Lạt, Đà Lạt"
    assert ctx.api_log.path.read_text(encoding="utf-8").count("text_search_pro") == 1


def test_landmark_via_photon_without_key(ctx: Context, router: respx.MockRouter) -> None:
    ctx.secrets.google_maps_key = None
    _photon(router, DALAT_MARKET)
    center = spatial.select_center(DALAT_CONFIG, lambda: geocoding.build(ctx))
    assert (center.lat, center.lng, center.label) == (*DALAT_MARKET, "Chợ Đà Lạt")
    assert center.place_id is None
    assert center.maps_url.endswith(f"query={DALAT_MARKET[0]},{DALAT_MARKET[1]}")


def test_landmark_too_far_from_city_point_is_rejected(
    ctx: Context, router: respx.MockRouter
) -> None:
    ctx.secrets.google_maps_key = None
    _photon(router, (DALAT_CITY[0] + 6 * KM_LAT, DALAT_CITY[1]))
    center = spatial.select_center(DALAT_CONFIG, lambda: geocoding.build(ctx))
    assert (center.lat, center.lng) == DALAT_CITY
    assert (center.label, center.label_en, center.place_id) == (
        "Trung tâm Đà Lạt",
        "Đà Lạt center",
        None,
    )


def test_landmark_not_found_falls_back_to_city_point(
    ctx: Context, router: respx.MockRouter
) -> None:
    ctx.secrets.google_maps_key = None
    _photon(router, None)
    center = spatial.select_center(DALAT_CONFIG, lambda: geocoding.build(ctx))
    assert (center.lat, center.lng, center.label) == (*DALAT_CITY, "Trung tâm Đà Lạt")


MEEK_HOME = (11.9383279, 108.4591222)
GIOT_SUONG = (11.941659, 108.4721143)
HOTEL_CONFIG = AppConfig.model_validate(
    {
        "city": "Đà Lạt",
        "center": {"hotel": "Meek Home, Đà Lạt"},
        "city_profile": {"aliases": ["Đà Lạt", "Da Lat", "Lâm Đồng"]},
    }
)


def _photon_hotel(router: respx.MockRouter) -> respx.Route:
    """Photon: the city node for the city query, a wrongly named home stay for the hotel query."""

    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.params["q"].startswith("Meek Home"):
            wrong = _photon_feature(GIOT_SUONG, "Giọt Sương Bay Lên Home Garden", "tourism", "x")
            return httpx.Response(200, json={"features": [wrong]})
        city = _photon_feature(DALAT_CITY, "Đà Lạt", "place", "city")
        return httpx.Response(200, json={"features": [city]})

    return router.get(PHOTON_URL).mock(side_effect=answer)


def _google_hotel(router: respx.MockRouter, *hits: tuple[str, tuple[float, float]]) -> respx.Route:
    places = [
        {
            "id": f"ChIJ{n}",
            "displayName": {"text": name},
            "formattedAddress": "Đà Lạt, Lâm Đồng, Việt Nam",
            "location": {"latitude": point[0], "longitude": point[1]},
            "types": ["lodging"],
        }
        for n, (name, point) in enumerate(hits)
    ]
    return router.post(TEXT_SEARCH_URL).mock(
        return_value=httpx.Response(200, json={"places": places})
    )


def test_find_rejects_wrong_name_and_asks_the_next_provider(
    ctx: Context, router: respx.MockRouter
) -> None:
    ctx.secrets.google_maps_key = "test-key"
    photon = _photon_hotel(router)
    google = _google_hotel(router, ("Meek Home", MEEK_HOME))
    found = geocoding.build(ctx).find(
        "Meek Home, Đà Lạt", lambda p: p.display_name.startswith("Meek Home"), near=DALAT_CITY
    )
    assert found is not None
    assert (found.source, found.google_id, found.lat) == ("google", "ChIJ0", MEEK_HOME[0])
    assert (photon.call_count, google.call_count) == (1, 1)
    assert photon.calls.last.request.url.params["lat"] == str(DALAT_CITY[0])


def test_hotel_by_name_via_google_with_place_id(ctx: Context, router: respx.MockRouter) -> None:
    ctx.secrets.google_maps_key = "test-key"
    photon = _photon_hotel(router)
    google = _google_hotel(
        router, ("Giọt Sương Bay Lên Home Garden", GIOT_SUONG), ("Meek Home", MEEK_HOME)
    )
    center = spatial.select_center(HOTEL_CONFIG, lambda: geocoding.build(ctx))
    assert (center.lat, center.lng) == MEEK_HOME
    assert (center.source, center.label, center.place_id) == ("hotel", "Meek Home, Đà Lạt", "ChIJ1")
    assert google.call_count == 1
    body = json.loads(google.calls.last.request.content)
    assert (body["textQuery"], body["regionCode"]) == ("Meek Home, Đà Lạt", "VN")
    bias = body["locationBias"]["circle"]["center"]
    assert (bias["latitude"], bias["longitude"]) == DALAT_CITY
    assert [c.request.url.params["q"] for c in photon.calls] == ["Đà Lạt"]


def test_hotel_rejected_by_every_provider_is_an_error(
    ctx: Context, router: respx.MockRouter
) -> None:
    ctx.secrets.google_maps_key = "test-key"
    _photon_hotel(router)
    far = (MEEK_HOME[0] + 40 * KM_LAT, MEEK_HOME[1])
    _google_hotel(router, ("Giọt Sương Bay Lên Home Garden", GIOT_SUONG), ("Meek Home", far))
    with pytest.raises(spatial.CenterNotFoundError, match=r'center\.hotel.*"lat,lng"'):
        spatial.select_center(HOTEL_CONFIG, lambda: geocoding.build(ctx))
