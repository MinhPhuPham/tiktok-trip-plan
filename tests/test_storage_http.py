import csv
from typing import Any

import httpx
import pytest
import respx

from tiktok_trip.errors import ApiError
from tiktok_trip.http import CachedClient, error_body
from tiktok_trip.models import Candidate
from tiktok_trip.paths import Paths
from tiktok_trip.storage import ApiLog, load_models, save_models


def test_models_round_trip(project: Paths) -> None:
    items = [Candidate(video_id="v", video_url="u", name="A", confidence=0.5)]
    save_models(project.candidates_file, items)
    assert load_models(project.candidates_file, Candidate) == items
    assert load_models(project.data / "missing.json", Candidate) == []


@respx.mock
def test_cached_client_caches_and_logs(project: Paths) -> None:
    route = respx.get("https://api.example.com/x").mock(
        return_value=httpx.Response(200, json={"ok": 1})
    )
    client = CachedClient("example", project.cache, ApiLog(project.api_log))
    for _ in range(2):
        assert client.request_json("GET", "https://api.example.com/x", params={"q": "a"}) == {
            "ok": 1
        }
    assert route.call_count == 1
    with project.api_log.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert [row["cache_hit"] for row in rows] == ["False", "True"]


@respx.mock
def test_cached_client_cache_only_never_sends(project: Paths) -> None:
    route = respx.get("https://api.example.com/c").mock(
        return_value=httpx.Response(200, json={"ok": 1})
    )
    client = CachedClient("example", project.cache, ApiLog(project.api_log))
    url = "https://api.example.com/c"
    assert client.request_json("GET", url, cache_only=True) is None
    assert client.request_json("GET", url) == {"ok": 1}
    assert client.request_json("GET", url, cache_only=True) == {"ok": 1}
    assert route.call_count == 1


@respx.mock
def test_cached_client_retries_then_raises(project: Paths) -> None:
    respx.get("https://api.example.com/y").mock(return_value=httpx.Response(503))
    client = CachedClient("example", project.cache, ApiLog(project.api_log))
    client._send.retry.wait = lambda *_: 0  # type: ignore[attr-defined]
    with pytest.raises(httpx.HTTPStatusError):
        client.request_json("GET", "https://api.example.com/y")


@respx.mock
def test_cached_client_skips_cache_when_payload_is_not_cacheable(project: Paths) -> None:
    route = respx.get("https://api.example.com/z").mock(
        side_effect=[
            httpx.Response(200, json={"error": "soft"}),
            httpx.Response(200, json={"ok": 1}),
            httpx.Response(200, json={"ok": 2}),
        ]
    )
    client = CachedClient("example", project.cache, ApiLog(project.api_log))

    def ok(payload: Any) -> bool:
        return "ok" in payload

    url = "https://api.example.com/z"
    assert client.request_json("GET", url, cacheable=ok) == {"error": "soft"}
    assert client.request_json("GET", url, cacheable=ok) == {"ok": 1}
    assert client.request_json("GET", url, cacheable=ok) == {"ok": 1}
    assert route.call_count == 2


GOOGLE_400 = {
    "error": {
        "code": 400,
        "message": "API key not valid. Please pass a valid API key.",
        "status": "INVALID_ARGUMENT",
    }
}


@respx.mock
def test_cached_client_4xx_raises_api_error_with_body_and_logs_it(project: Paths) -> None:
    route = respx.post("https://api.example.com/search").mock(
        return_value=httpx.Response(400, json=GOOGLE_400)
    )
    client = CachedClient("example", project.cache, ApiLog(project.api_log))
    with pytest.raises(ApiError) as caught:
        client.request_json(
            "POST",
            "https://api.example.com/search?key=secret-value",
            json_body={"q": "a"},
            headers={"X-Goog-Api-Key": "secret-header"},
            note="sku:a",
        )
    message = str(caught.value)
    assert "API key not valid" in message
    assert "INVALID_ARGUMENT" in message
    assert "400" in message
    assert "example" in message
    assert "https://api.example.com/search" in message
    assert "secret" not in message
    assert isinstance(caught.value, httpx.HTTPStatusError)
    assert route.call_count == 1
    with project.api_log.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert [(row["units"], row["cache_hit"]) for row in rows] == [("1", "False")]
    assert "error 400" in rows[0]["note"]
    assert not list(project.cache.rglob("*.json"))


def test_error_body_is_compact_and_truncated() -> None:
    long = httpx.Response(500, text="x" * 2000)
    assert error_body(long) == "x" * 500 + "..."
    assert error_body(httpx.Response(400, json={"a": 1})) == '{"a":1}'
