from __future__ import annotations

import io
import json
import logging
from html.parser import HTMLParser
from pathlib import Path

import pytest
from fixtures.sample_dataset import build_dataset
from PIL import Image
from pydantic import ValidationError

from tiktok_trip.config import ExportConfig
from tiktok_trip.export import og_image
from tiktok_trip.export.dataset import ExportData
from tiktok_trip.export.map_data import MapData
from tiktok_trip.export.map_html import SEO_MARKER, image_url, write_app
from tiktok_trip.export.og_image import render_og_image
from tiktok_trip.export.site import (
    OG_IMAGE_SIZE,
    ROBOTS_TXT,
    SITE_NAME,
    TripFacts,
    head_tags,
)

SITE = "https://trip.example.app"
WEB = Path(__file__).resolve().parents[1] / "web"
MAX_IMAGE_BYTES = 300 * 1024
MAX_SHORT_NAME = 12


class HeadParser(HTMLParser):
    """Reads <head> the way a link-preview crawler does: static tags only, no scripts run."""

    def __init__(self) -> None:
        super().__init__()
        self.meta: dict[str, list[str]] = {}
        self.links: dict[str, str] = {}
        self.title = ""
        self.json_ld: list[str] = []
        self._in: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        if tag == "meta" and "content" in values:
            key = values.get("property") or values.get("name") or ""
            self.meta.setdefault(key, []).append(values["content"])
        elif tag == "link":
            self.links[values.get("rel", "")] = values.get("href", "")
        elif tag == "title":
            self._in = "title"
        elif tag == "script" and values.get("type") == "application/ld+json":
            self._in = "ld"

    def handle_endtag(self, tag: str) -> None:
        self._in = None

    def handle_data(self, data: str) -> None:
        if self._in == "title":
            self.title += data
        elif self._in == "ld":
            self.json_ld.append(data)

    def one(self, key: str) -> str:
        values = self.meta.get(key, [])
        assert len(values) == 1, f"{key}: {values}"
        return values[0]


def parse_head(html: str) -> HeadParser:
    parser = HeadParser()
    parser.feed(html)
    return parser


@pytest.fixture
def data() -> ExportData:
    return build_dataset()


def test_app_head_carries_absolute_preview_tags(data: ExportData, tmp_path: Path) -> None:
    app_dir = write_app(data, tmp_path / "app", tmp_path / "media", site_url=SITE)
    head = parse_head((app_dir / "index.html").read_text(encoding="utf-8"))
    manifest = json.loads((app_dir / "manifest.webmanifest").read_text(encoding="utf-8"))
    description = head.one("description")
    assert head.title == head.one("og:title") == SITE_NAME
    assert head.one("og:site_name") == head.one("apple-mobile-web-app-title") == SITE_NAME
    assert head.one("og:description") == description == manifest["description"]
    assert description.startswith(f"{data.config.city}: lịch trình 2 ngày, ")
    assert head.links["canonical"] == head.one("og:url") == f"{SITE}/"
    assert head.one("og:type") == "website"
    assert head.one("og:locale") == "vi_VN"
    assert head.one("og:locale:alternate") == "en_US"
    assert head.one("og:image").startswith(f"{SITE}/og-image.png?v=")
    assert (head.one("og:image:width"), head.one("og:image:height")) == ("1200", "630")
    assert data.config.city in head.one("og:image:alt")
    assert head.one("twitter:card") == "summary_large_image"
    (ld,) = head.json_ld
    assert json.loads(ld) | {"description": ""} == {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": SITE_NAME,
        "url": f"{SITE}/",
        "description": "",
        "inLanguage": "vi",
    }
    assert (app_dir / "robots.txt").read_text(encoding="utf-8") == ROBOTS_TXT


def test_app_without_site_url_warns_and_keeps_a_relative_image(
    data: ExportData, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING):
        app_dir = write_app(data, tmp_path / "app", tmp_path / "media")
    head = parse_head((app_dir / "index.html").read_text(encoding="utf-8"))
    assert "canonical" not in head.links
    assert "og:url" not in head.meta
    assert not head.json_ld
    assert head.one("og:image").startswith("og-image.png?v=")
    assert any("export.site_url is empty" in record.getMessage() for record in caplog.records)


def test_og_image_is_a_small_1200x630_png(data: ExportData, tmp_path: Path) -> None:
    app_dir = write_app(data, tmp_path / "app", tmp_path / "media", site_url=SITE)
    raw = (app_dir / "og-image.png").read_bytes()
    assert len(raw) < MAX_IMAGE_BYTES
    with Image.open(io.BytesIO(raw)) as image:
        assert image.format == "PNG"
        assert image.size == OG_IMAGE_SIZE


def test_og_image_is_deterministic_and_versioned_by_content() -> None:
    first = render_og_image(SITE_NAME, "Đà Lạt", "3 ngày · 184 địa điểm")
    assert render_og_image(SITE_NAME, "Đà Lạt", "3 ngày · 184 địa điểm") == first
    other = render_og_image(SITE_NAME, "Huế", "2 ngày · 40 địa điểm")
    assert image_url(SITE, first) == image_url(SITE, first)
    assert image_url(SITE, first) != image_url(SITE, other)


def test_og_image_fits_a_long_city_name() -> None:
    raw = render_og_image(SITE_NAME, "Thành phố Hồ Chí Minh và vùng phụ cận " * 3, "1 ngày")
    with Image.open(io.BytesIO(raw)) as image:
        assert image.size == OG_IMAGE_SIZE


def test_og_image_without_system_fonts_still_renders(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(og_image, "FONT_FACES", {"bold": (), "medium": ()})
    og_image.face_for.cache_clear()
    try:
        with caplog.at_level(logging.WARNING):
            raw = render_og_image(SITE_NAME, "Đà Lạt", "3 ngày")
    finally:
        og_image.face_for.cache_clear()
    with Image.open(io.BytesIO(raw)) as image:
        assert image.size == OG_IMAGE_SIZE
    assert any("No font" in record.getMessage() for record in caplog.records)


def test_description_without_a_plan_promises_no_day_routes() -> None:
    facts = TripFacts(city="Huế", days=0, places=5)
    assert facts.stats == "5 địa điểm"
    assert facts.description == "Huế: 5 địa điểm từ review TikTok — bản đồ, dùng offline."
    assert "lộ trình" not in facts.description


def test_head_escapes_the_city() -> None:
    tags = head_tags(TripFacts(city='Đà "<Lạt>"', days=1, places=1))
    head = parse_head(tags)
    assert head.one("description").startswith('Đà "<Lạt>":')
    assert "<Lạt>" not in tags


def test_site_name_is_one_constant_for_python_and_web() -> None:
    assert MapData.model_fields["site_name"].default == SITE_NAME
    assert len(SITE_NAME) <= MAX_SHORT_NAME
    index = (WEB / "index.html").read_text(encoding="utf-8")
    assert '<html lang="vi">' in index
    assert index.count(SEO_MARKER) == 1
    assert SITE_NAME not in index
    manifest = json.loads((WEB / "public" / "manifest.webmanifest").read_text(encoding="utf-8"))
    assert manifest["lang"] == "vi"
    assert manifest["short_name"] == "__TRIP_SHORT_NAME__"


@pytest.mark.parametrize(
    ("value", "stored"),
    [("", ""), ("https://trip.example.app/", "https://trip.example.app"), (f" {SITE} ", SITE)],
)
def test_site_url_is_normalised(value: str, stored: str) -> None:
    assert ExportConfig(site_url=value).site_url == stored


def test_site_url_needs_a_scheme() -> None:
    with pytest.raises(ValidationError, match="https://"):
        ExportConfig(site_url="trip.example.app")


def test_installed_app_launches_inside_its_scope_below_the_ios_status_bar() -> None:
    manifest = json.loads((WEB / "public" / "manifest.webmanifest").read_text(encoding="utf-8"))
    assert manifest["id"] == manifest["start_url"] == manifest["scope"] == "./"
    assert manifest["display"] == "standalone"
    assert manifest["orientation"] == "any"
    index = (WEB / "index.html").read_text(encoding="utf-8")
    assert '<meta name="apple-mobile-web-app-status-bar-style" content="default">' in index
    assert "viewport-fit=cover" in index
