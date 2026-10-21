from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml

from tiktok_trip.context import Context
from tiktok_trip.export import map_html
from tiktok_trip.paths import Paths

TEST_CONFIG: dict[str, Any] = {
    "city": "Ho Chi Minh City",
    "country_code": "VN",
    "center": {"hotel": "", "override": ""},
    "spatial": {"sectors": 8},
    "fetch": {"comments": "playwright", "headless": True},
    "roads": {"enabled": False},
}
"""Fixed test config: HCMC, 8 sectors, no road geometry requests, defaults elsewhere. Never the
repo's live config.yaml."""


@pytest.fixture
def project(tmp_path: Path) -> Paths:
    paths = Paths(tmp_path)
    paths.config_file.write_text(
        yaml.safe_dump(TEST_CONFIG, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )
    paths.ensure()
    return paths


@pytest.fixture
def ctx(project: Paths) -> Context:
    return Context.load(project)


SINGLE_PAGE = (
    '<!doctype html><html lang="vi"><head><title>__TRIP_TITLE__</title>\n<!--__SEO_HEAD__-->'
    '</head><body><script id="trip-data" type="application/json">__TRIP_DATA__</script>'
    "</body></html>"
)
MANIFEST = (
    '{"name": "__TRIP_NAME__", "short_name": "__TRIP_SHORT_NAME__", '
    '"description": "__TRIP_DESCRIPTION__", "start_url": "./"}'
)


@pytest.fixture(autouse=True)
def fake_web_dist(
    tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch
) -> Path:
    """A tiny stand-in for the npm build in export/web_dist, so tests never need node."""
    dist = tmp_path_factory.mktemp("web_dist")
    (dist / "single").mkdir()
    (dist / "single" / "index.html").write_text(SINGLE_PAGE, encoding="utf-8")
    (dist / "app" / "assets").mkdir(parents=True)
    (dist / "app" / "index.html").write_text(SINGLE_PAGE, encoding="utf-8")
    (dist / "app" / "sw.js").write_text("self;", encoding="utf-8")
    (dist / "app" / "assets" / "index-abc.js").write_text("console.log(1);", encoding="utf-8")
    (dist / "app" / "manifest.webmanifest").write_text(MANIFEST, encoding="utf-8")
    monkeypatch.setattr(map_html, "web_dist", lambda: dist)
    return dist
