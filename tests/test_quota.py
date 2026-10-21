import csv
import logging
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
import respx
from rich.console import Console
from typer.testing import CliRunner

from tiktok_trip import cli
from tiktok_trip.clients import google_nearby, google_photos, google_places
from tiktok_trip.config import DEFAULT_DAILY_CAPS, DEFAULT_MONTHLY_CAPS, QuotaConfig
from tiktok_trip.errors import ApiError, UserFacingError
from tiktok_trip.http import CachedClient
from tiktok_trip.paths import ROOT_ENV, Paths
from tiktok_trip.quota import QuotaExceededError, QuotaGuard, period_end
from tiktok_trip.storage import ApiLog

NOW = datetime(2026, 10, 19, 12, 0, tzinfo=UTC)
URL = "https://places.example.com/search"
LEGACY_HEADER = ["timestamp", "service", "endpoint", "units", "cache_hit", "note"]
LEGACY_ROWS = [
    ["2026-10-18T18:16:47+00:00", "photon", URL, "1", "False", "search:Đà Lạt"],
    ["2026-10-18T18:20:00+00:00", "google_places", URL, "1", "False", "text_search_pro:Bún bò"],
    ["2026-10-18T18:21:00+00:00", "google_places", URL, "1", "False", "details_pro:ChIJa"],
    ["2026-10-18T18:22:00+00:00", "google_places", URL, "1", "False",
     "details_enterprise:X (error 400)"],
    ["2026-10-18T18:23:00+00:00", "google_places", URL, "0", "True", "text_search_pro:Bún bò"],
    ["2026-10-18T18:25:00+00:00", "google_nearby", URL, "1", "False", "Z1"],
]  # fmt: skip


def _seed(path: Path, sku: str, times: list[datetime], *, cache_hit: bool = False) -> None:
    is_new = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        if is_new:
            writer.writerow(ApiLog.HEADER)
        for at in times:
            writer.writerow([at.isoformat(), "svc", sku, URL, 1, cache_hit, ""])


def _guard(
    project: Paths, *, monthly: dict[str, int] | None = None, daily: dict[str, int] | None = None
) -> QuotaGuard:
    """Exactly these caps (no defaults merged in), no safety margin, clock fixed at NOW."""
    config = QuotaConfig.model_construct(
        safety_margin=1.0, monthly=monthly or {}, daily=daily or {}
    )
    return QuotaGuard(config, ApiLog(project.api_log), now=lambda: NOW)


def _client(project: Paths, guard: QuotaGuard | None) -> CachedClient:
    return CachedClient("google_places", project.cache, ApiLog(project.api_log), quota=guard)


def _rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


@respx.mock
def test_sku_column_written_and_defaults_to_service(project: Paths) -> None:
    respx.get(URL).mock(return_value=httpx.Response(200, json={"ok": 1}))
    client = _client(project, None)
    client.request_json("GET", URL, params={"a": 1}, sku="text_search_pro", note="free text")
    client.request_json("GET", URL, params={"a": 1}, sku="text_search_pro")
    client.request_json("GET", URL, params={"a": 2})
    rows = _rows(project.api_log)
    assert tuple(rows[0]) == ApiLog.HEADER
    assert [(r["sku"], r["cache_hit"], r["note"]) for r in rows] == [
        ("text_search_pro", "False", "free text"),
        ("text_search_pro", "True", ""),
        ("google_places", "False", ""),
    ]


def test_paid_client_requires_an_sku(project: Paths) -> None:
    client = CachedClient("photon", project.cache, ApiLog(project.api_log), paid=True)
    with pytest.raises(ValueError, match="sku"):
        client.request_json("GET", URL)


def test_legacy_six_column_log_is_read_then_upgraded_on_write(project: Paths) -> None:
    with project.api_log.open("w", newline="", encoding="utf-8") as handle:
        csv.writer(handle).writerows([LEGACY_HEADER, *LEGACY_ROWS])
    api_log = ApiLog(project.api_log)
    assert [c.sku for c in api_log.read()] == [
        "photon",
        "text_search_pro",
        "place_details_pro",
        "place_details_enterprise",
        "text_search_pro",
        "nearby_search_enterprise",
    ]
    guard = QuotaGuard(QuotaConfig(), api_log, now=lambda: NOW)
    assert guard.used("text_search_pro", "month") == 1
    assert guard.used("place_details_enterprise", "month") == 1

    api_log.record("photon", URL, sku="photon", note="search:x")
    rows = _rows(project.api_log)
    assert tuple(rows[0]) == ApiLog.HEADER
    assert len(rows) == len(LEGACY_ROWS) + 1
    assert rows[2]["sku"] == "place_details_pro"
    assert rows[2]["note"] == "details_pro:ChIJa"
    assert rows[0]["timestamp"] == LEGACY_ROWS[0][0]
    assert rows[-1]["sku"] == "photon"


@respx.mock
def test_guard_refuses_the_call_that_crosses_the_margin(project: Paths) -> None:
    route = respx.get(URL).mock(return_value=httpx.Response(200, json={"ok": 1}))
    _seed(project.api_log, "text_search_pro", [NOW] * 8)
    _seed(project.api_log, "text_search_pro", [NOW] * 5, cache_hit=True)
    config = QuotaConfig(safety_margin=0.9, monthly={"text_search_pro": 10})
    guard = QuotaGuard(config, ApiLog(project.api_log), now=lambda: NOW)
    client = _client(project, guard)

    client.request_json("GET", URL, params={"q": 1}, sku="text_search_pro")
    assert route.call_count == 1
    rows_before = _rows(project.api_log)
    with pytest.raises(QuotaExceededError) as caught:
        client.request_json("GET", URL, params={"q": 2}, sku="text_search_pro")
    assert route.call_count == 1
    assert _rows(project.api_log) == rows_before
    assert isinstance(caught.value, UserFacingError)
    message = str(caught.value)
    assert "text_search_pro" in message
    assert "9 of 10" in message
    assert "month (2026-10 UTC)" in message
    assert "config.yaml under `quota`" in message
    assert "\n" not in message


@respx.mock
def test_cache_hits_are_neither_counted_nor_refused(project: Paths) -> None:
    route = respx.get(URL).mock(return_value=httpx.Response(200, json={"ok": 1}))
    guard = _guard(project, monthly={"text_search_pro": 1})
    client = _client(project, guard)
    for _ in range(3):
        client.request_json("GET", URL, params={"q": 1}, sku="text_search_pro")
    assert route.call_count == 1
    assert guard.used("text_search_pro", "month") == 1
    with pytest.raises(QuotaExceededError):
        client.request_json("GET", URL, params={"q": 2}, sku="text_search_pro")
    client.request_json("GET", URL, params={"q": 3}, sku="other_sku")
    assert route.call_count == 2


@respx.mock
def test_failed_calls_count_toward_usage(project: Paths) -> None:
    route = respx.get(URL).mock(return_value=httpx.Response(400, json={"error": "bad"}))
    client = _client(project, _guard(project, monthly={"place_details_enterprise": 2}))
    for q in range(2):
        with pytest.raises(ApiError):
            client.request_json("GET", URL, params={"q": q}, sku="place_details_enterprise")
    with pytest.raises(QuotaExceededError):
        client.request_json("GET", URL, params={"q": 9}, sku="place_details_enterprise")
    assert route.call_count == 2
    reloaded = _guard(project, monthly={"place_details_enterprise": 2})
    assert reloaded.used("place_details_enterprise", "month") == 2


def test_warns_once_past_80_percent(project: Paths, caplog: pytest.LogCaptureFixture) -> None:
    _seed(project.api_log, "nearby_search_enterprise", [NOW] * 6)
    guard = _guard(project, monthly={"nearby_search_enterprise": 10})
    with caplog.at_level(logging.WARNING, logger="tiktok_trip.quota"):
        guard.add("nearby_search_enterprise")
        assert not caplog.records
        for _ in range(3):
            guard.check("nearby_search_enterprise")
            guard.add("nearby_search_enterprise")
    assert len(caplog.records) == 1
    assert "nearby_search_enterprise has used 8 of its local limit 10" in caplog.text


def test_month_and_day_periods_are_utc_calendar_boundaries(project: Paths) -> None:
    _seed(
        project.api_log,
        "text_search_pro",
        [datetime(2026, 9, 30, 23, 59, 59, tzinfo=UTC), datetime(2026, 10, 1, tzinfo=UTC)],
    )
    _seed(
        project.api_log,
        "daily_sku",
        [
            datetime(2026, 10, 1, tzinfo=UTC),
            datetime(2026, 10, 18, 23, 59, 59, tzinfo=UTC),
            datetime(2026, 10, 19, tzinfo=UTC),
        ],
    )
    guard = _guard(project, monthly={"text_search_pro": 5}, daily={"daily_sku": 2})
    assert guard.used("text_search_pro", "month") == 1
    assert guard.used("daily_sku", "day") == 1
    assert guard.used("daily_sku", "month") == 3
    guard.check("daily_sku")
    guard.add("daily_sku")
    with pytest.raises(QuotaExceededError, match=r"this day \(2026-10-19 UTC\)"):
        guard.check("daily_sku")
    resets = {s.limit.sku: s.resets_at for s in guard.statuses()}
    assert resets == {
        "text_search_pro": datetime(2026, 11, 1, tzinfo=UTC),
        "daily_sku": datetime(2026, 10, 20, tzinfo=UTC),
    }
    assert period_end("month", datetime(2026, 12, 31, 23, 0, tzinfo=UTC)) == datetime(
        2027, 1, 1, tzinfo=UTC
    )


def test_config_defaults_cover_every_paid_sku_and_merge_overrides() -> None:
    config = QuotaConfig.model_validate({"monthly": {"text_search_pro": 100}, "daily": None})
    assert config.safety_margin == 0.9
    assert config.monthly == {**DEFAULT_MONTHLY_CAPS, "text_search_pro": 100}
    assert config.daily == DEFAULT_DAILY_CAPS == {}
    paid = {
        google_places.SKU_TEXT_SEARCH,
        google_places.SKU_DETAILS_PRO,
        google_places.SKU_DETAILS_ENTERPRISE,
        google_nearby.SKU_NEARBY_ENTERPRISE,
        google_photos.SKU_DETAILS_ESSENTIALS,
        google_photos.SKU_PHOTOS,
    }
    assert set(DEFAULT_MONTHLY_CAPS) == paid
    guard = QuotaGuard(QuotaConfig(), ApiLog(Path("unused.csv")))
    assert {(lim.sku, lim.effective_cap) for lim in guard.limits} == {
        ("text_search_pro", 4500),
        ("place_details_pro", 4500),
        ("place_details_enterprise", 900),
        ("nearby_search_enterprise", 900),
        ("place_details_essentials", 9000),
        ("place_photos", 900),
    }


def test_quota_command_prints_usage(project: Paths, monkeypatch: pytest.MonkeyPatch) -> None:
    api_log = ApiLog(project.api_log)
    for _ in range(3):
        api_log.record("google_places", URL, sku="text_search_pro")
    api_log.record("google_places", URL, sku="text_search_pro", units=0, cache_hit=True)
    api_log.record("photon", URL, sku="photon")
    monkeypatch.setenv(ROOT_ENV, str(project.root))
    monkeypatch.setattr(cli, "console", Console(width=160))

    result = CliRunner().invoke(cli.app, ["quota"])

    assert result.exit_code == 0, result.output
    lines = {line.split()[1]: line.split() for line in result.output.splitlines() if "│" in line}
    assert lines["text_search_pro"][2:8] == ["│", "month", "│", "3", "│", "5000"]
    assert "4497" in lines["text_search_pro"]
    assert "photon 1 today / 1 this month" in result.output
    assert "overpass 0 today" in result.output
