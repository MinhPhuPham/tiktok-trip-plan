# ruff: noqa: RUF001
import csv
import json

import httpx
import pytest
import respx

from tiktok_trip.clients.google_places import (
    BASE_URL,
    DETAILS_FIELD_MASK,
    SEARCH_FIELD_MASK,
    TEXT_SEARCH_URL,
    GooglePlacesClient,
    parse_hours,
    parse_price,
    to_weekday,
)
from tiktok_trip.config import MissingSecretError
from tiktok_trip.context import Context

SEARCH_RESPONSE = {
    "places": [
        {
            "id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
            "types": ["sandwich_shop", "restaurant", "food", "point_of_interest"],
            "formattedAddress": "26 Đ. Lê Thị Riêng, Phường Bến Thành, Hồ Chí Minh, Việt Nam",
            "location": {"latitude": 10.7714, "longitude": 106.6924},
            "businessStatus": "OPERATIONAL",
            "displayName": {"text": "Bánh Mì Huỳnh Hoa", "languageCode": "vi"},
        },
        {"id": "no-location", "displayName": {"text": "Broken"}},
    ]
}

DETAILS_RESPONSE = {
    "regularOpeningHours": {
        "openNow": False,
        "periods": [
            {
                "open": {"day": 0, "hour": 14, "minute": 30},
                "close": {"day": 0, "hour": 23, "minute": 0},
            },
            {
                "open": {"day": 1, "hour": 14, "minute": 30},
                "close": {"day": 1, "hour": 23, "minute": 0},
            },
            {
                "open": {"day": 6, "hour": 18, "minute": 0},
                "close": {"day": 0, "hour": 2, "minute": 0},
            },
        ],
        "weekdayDescriptions": [
            "Thứ Hai: 14:30–23:00",
            "Thứ Ba: Đóng cửa",
            "Thứ Tư: Đóng cửa",
            "Thứ Năm: Đóng cửa",
            "Thứ Sáu: Đóng cửa",
            "Thứ Bảy: 18:00–02:00",
            "Chủ Nhật: 14:30–23:00",
        ],
        "nextOpenTime": "2026-10-19T07:30:00Z",
    },
    "priceLevel": "PRICE_LEVEL_INEXPENSIVE",
    "priceRange": {
        "startPrice": {"currencyCode": "VND", "units": "50000"},
        "endPrice": {"currencyCode": "VND", "units": "100000"},
    },
    "rating": 4.4,
    "userRatingCount": 31254,
}


@pytest.fixture
def client(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> GooglePlacesClient:
    monkeypatch.setattr(ctx.secrets, "google_maps_key", "test-key")
    return GooglePlacesClient(ctx)


@respx.mock
def test_text_search_request_and_parse(client: GooglePlacesClient, ctx: Context) -> None:
    route = respx.post(TEXT_SEARCH_URL).mock(return_value=httpx.Response(200, json=SEARCH_RESPONSE))
    hits = client.text_search("Bánh mì Huỳnh Hoa HCM", center=(10.776, 106.701), radius_m=80_000)
    request = route.calls.last.request
    assert request.headers["X-Goog-Api-Key"] == "test-key"
    assert request.headers["X-Goog-FieldMask"] == SEARCH_FIELD_MASK
    body = json.loads(request.content)
    assert body["languageCode"] == "vi"
    assert body["regionCode"] == "VN"
    assert body["locationBias"]["circle"] == {
        "center": {"latitude": 10.776, "longitude": 106.701},
        "radius": 50_000.0,
    }
    assert len(hits) == 1
    hit = hits[0]
    assert hit.place_id == "gp:ChIJN1t_tDeuEmsRUsoyG83frY4"
    assert hit.name == "Bánh Mì Huỳnh Hoa"
    assert (hit.lat, hit.lng) == (10.7714, 106.6924)
    assert "restaurant" in hit.types

    client.text_search("Bánh mì Huỳnh Hoa HCM", center=(10.776, 106.701), radius_m=80_000)
    assert route.call_count == 1
    with ctx.paths.api_log.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert [r["sku"] for r in rows] == ["text_search_pro", "text_search_pro"]
    assert rows[0]["note"] == "Bánh mì Huỳnh Hoa HCM"
    assert [r["units"] for r in rows] == ["1", "0"]
    assert not any("test-key" in p.read_text() for p in ctx.paths.cache.rglob("*.json"))


@respx.mock
def test_empty_search_returns_no_hits(client: GooglePlacesClient) -> None:
    respx.post(TEXT_SEARCH_URL).mock(return_value=httpx.Response(200, json={}))
    assert client.text_search("nothing", center=(10.0, 106.0), radius_m=1000) == []


@respx.mock
def test_details_parse(client: GooglePlacesClient, ctx: Context) -> None:
    route = respx.get(f"{BASE_URL}/places/ChIJabc").mock(
        return_value=httpx.Response(200, json=DETAILS_RESPONSE)
    )
    details = client.details("ChIJabc")
    assert route.calls.last.request.headers["X-Goog-FieldMask"] == DETAILS_FIELD_MASK
    assert details.rating == 4.4
    assert details.rating_count == 31254
    assert details.price_range is not None
    assert details.price_range.value == "50.000–100.000 VND"
    assert details.hours is not None
    assert [(p.day, p.open, p.close) for p in details.hours.periods] == [
        (0, "14:30", "23:00"),
        (5, "18:00", "02:00"),
        (6, "14:30", "23:00"),
    ]
    assert details.hours.weekday_text[0] == "Thứ Hai: 14:30–23:00"
    assert [(c.sku, c.note) for c in ctx.api_log.read()] == [
        ("place_details_enterprise", "ChIJabc")
    ]


@respx.mock
def test_place_basic_lookup(client: GooglePlacesClient) -> None:
    respx.get(f"{BASE_URL}/places/ChIJN1t_tDeuEmsRUsoyG83frY4").mock(
        return_value=httpx.Response(200, json=SEARCH_RESPONSE["places"][0])
    )
    hit = client.place("ChIJN1t_tDeuEmsRUsoyG83frY4")
    assert hit is not None
    assert hit.business_status == "OPERATIONAL"


def test_missing_key_is_a_clear_error(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ctx.secrets, "google_maps_key", None)
    with pytest.raises(MissingSecretError, match="GOOGLE_MAPS_KEY"):
        GooglePlacesClient(ctx)


def test_weekday_conversion() -> None:
    assert [to_weekday(d) for d in range(7)] == [6, 0, 1, 2, 3, 4, 5]


def test_parse_hours_legacy_time_and_24_7() -> None:
    legacy = parse_hours(
        {"periods": [{"open": {"day": 2, "time": "0630"}, "close": {"day": 2, "time": "1100"}}]}
    )
    assert legacy is not None
    assert [(p.day, p.open, p.close) for p in legacy.periods] == [(1, "06:30", "11:00")]
    always = parse_hours({"periods": [{"open": {"day": 0, "hour": 0, "minute": 0}}]})
    assert always is not None
    assert len(always.periods) == 7
    assert all(p.close is None for p in always.periods)
    assert parse_hours(None) is None
    assert parse_hours({}) is None


def test_parse_price_fallbacks() -> None:
    only_start = parse_price({"startPrice": {"currencyCode": "VND", "units": "200000"}}, None)
    assert only_start is not None
    assert only_start.value == "200.000+ VND"
    level = parse_price(None, "PRICE_LEVEL_MODERATE")
    assert level is not None
    assert level.value == "$$ (moderate)"
    assert parse_price(None, "PRICE_LEVEL_UNSPECIFIED") is None


def test_parse_price_drops_placeholder_lower_bound() -> None:
    vnd = "VND"
    placeholder = parse_price(
        {
            "startPrice": {"currencyCode": vnd, "units": "1"},
            "endPrice": {"currencyCode": vnd, "units": "100000"},
        },
        "PRICE_LEVEL_INEXPENSIVE",
    )
    assert placeholder is not None and placeholder.value == "đến 100.000 VND"
    missing = parse_price({"endPrice": {"currencyCode": vnd, "units": "100000"}}, None)
    assert missing is not None and missing.value == "đến 100.000 VND"
    unusable = parse_price(
        {"startPrice": {"currencyCode": vnd, "units": "1"}}, "PRICE_LEVEL_INEXPENSIVE"
    )
    assert unusable is not None and unusable.value == "$ (inexpensive)"
    assert parse_price({"startPrice": {"currencyCode": vnd, "units": "1"}}, None) is None
