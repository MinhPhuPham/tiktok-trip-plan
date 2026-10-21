from __future__ import annotations

import dataclasses
import json
import logging
import re
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from fixtures.sample_dataset import CENTER_LABEL, CENTER_LABEL_EN, build_dataset

from tiktok_trip.clock import EN_DASH
from tiktok_trip.config import Secrets
from tiktok_trip.context import Context
from tiktok_trip.errors import UserFacingError
from tiktok_trip.export import map_html
from tiktok_trip.export.dataset import ExportData
from tiktok_trip.export.i18n import EN, VI
from tiktok_trip.export.map_data import (
    BASEMAPS,
    GOOGLE_MAPS_JS,
    MAP_SCHEMA_VERSION,
    ROUTING_HOSTS,
    TILE_HOSTS,
    MapExtras,
    build_map_data,
)
from tiktok_trip.export.map_html import (
    google_loader_url,
    google_map_key,
    media_urls,
    offline_json,
    render_map,
    write_app,
    write_map,
)
from tiktok_trip.geo import destination_point
from tiktok_trip.models import MediaAttribution, MediaItem
from tiktok_trip.planning.matrix import TravelMatrix
from tiktok_trip.preferences import Preferences

FAKE_KEY = "AIzaFAKE-test-key-0123456789"
PWA_CONSTANTS = Path(__file__).resolve().parents[1] / "web" / "src" / "pwa" / "constants.ts"
MAX_BYTES = 16 * 1024 * 1024
DATA_SCRIPT = re.compile(
    r'<script id="trip-data" type="application/json">(?P<json>.*?)</script>', re.DOTALL
)


@pytest.fixture
def data() -> ExportData:
    return build_dataset()


@pytest.fixture
def html(data: ExportData, tmp_path: Path) -> str:
    return write_map(data, tmp_path / "map.html").read_text(encoding="utf-8")


def embedded(html: str) -> dict[str, object]:
    match = DATA_SCRIPT.search(html)
    assert match, "trip-data script missing"
    return json.loads(match["json"].replace("<\\/", "</"))  # type: ignore[no-any-return]


def test_data_has_every_place_center_and_route(data: ExportData) -> None:
    map_data = build_map_data(data)
    assert map_data.schema_version == MAP_SCHEMA_VERSION
    assert {place.id for place in map_data.places} == {place.id for place in data.places}
    assert map_data.center is not None
    assert map_data.center.name == {"en": CENTER_LABEL_EN, "vi": CENTER_LABEL}
    assert map_data.center.kind == "city_default"
    assert [day.day for day in map_data.days] == [1, 2]
    assert data.itinerary is not None
    for day, source in zip(map_data.days, data.itinerary.days, strict=True):
        assert [stop.ref for stop in day.stops] == [
            "rest" if stop.kind == "rest" else stop.ref_id for stop in source.stops
        ]
        assert [(stop.arrive, stop.depart, stop.slot) for stop in day.stops] == [
            (stop.arrive, stop.depart, stop.slot) for stop in source.stops
        ]
    assert [item.ref for item in map_data.unplaced] == ["gp:comtam6", "gp:gone"]
    assert len(map_data.nearby) == 3
    assert len(map_data.rays) == 8
    assert [ring.label for ring in map_data.rings] == ["2 km", "5 km", "10 km"]


def test_data_formats_both_languages(data: ExportData) -> None:
    map_data = build_map_data(data)
    pho = next(place for place in map_data.places if place.id == "gp:pho1")
    assert pho.day == 1
    assert pho.stop == 1
    assert pho.priority is None
    assert pho.stars == ""
    assert pho.best == {"en": f"6:30{EN_DASH}9:00 AM", "vi": f"6:30{EN_DASH}9:00"}
    assert pho.best_source == "heuristic"
    assert pho.hours.en.startswith(f"7:00 AM{EN_DASH}9:00 PM")
    assert pho.hours.vi.startswith(f"7:00{EN_DASH}21:00")
    assert pho.hours.periods
    assert pho.best_time is not None
    assert pho.best_time.source == "heuristic"
    breakfast = map_data.days[0].stops[1]
    assert breakfast.activity == {"en": "Breakfast", "vi": "Ăn sáng"}
    assert breakfast.time == {"en": f"8:10{EN_DASH}8:55 AM", "vi": f"8:10{EN_DASH}8:55"}
    rest = map_data.days[0].stops[4]
    assert rest.kind == "rest"
    assert rest.name["en"] == EN.rest_at_center
    xeo = next(place for place in map_data.places if place.id == "gp:xeo4")
    assert xeo.best["en"] == "weekend · sells out by 2:00 PM"
    assert xeo.best["vi"] == "cuối tuần · hết hàng trước 14:00"


def test_html_embeds_data_and_both_label_sets(data: ExportData, html: str) -> None:
    payload = embedded(html)
    assert payload["schema_version"] == MAP_SCHEMA_VERSION
    assert {place["id"] for place in payload["places"]} == {p.id for p in data.places}  # type: ignore[union-attr, index]
    labels = payload["labels"]
    assert isinstance(labels, dict)
    assert labels["en"]["ui"] == dict(EN.map_ui)
    assert labels["vi"]["ui"] == dict(VI.map_ui)
    for place in data.places:
        assert place.name in html
    assert CENTER_LABEL in html


def test_default_basemaps_hide_osm_and_default_to_openfreemap(html: str) -> None:
    payload = embedded(html)
    basemaps = payload["basemaps"]
    assert isinstance(basemaps, list)
    assert [b["id"] for b in basemaps] == ["openfreemap", "esri_streets", "esri_satellite"]
    assert payload["default_basemap"] == "openfreemap"
    vector = basemaps[0]
    assert vector["kind"] == "vector"
    assert vector["url"] == "https://tiles.openfreemap.org/styles/liberty"
    assert "OpenMapTiles" in vector["attribution"]
    assert {b["kind"] for b in basemaps[1:]} == {"raster"}
    assert "tile.openstreetmap.org" not in html


def test_basemap_list_follows_config(data: ExportData) -> None:
    data.config.export.basemaps = ["osm", "esri_satellite"]
    map_data = build_map_data(data)
    assert [b.id for b in map_data.basemaps] == ["osm", "esri_satellite"]
    assert map_data.default_basemap == "osm"
    assert {b.id for b in BASEMAPS} == {"openfreemap", "osm", "esri_streets", "esri_satellite"}
    data.config.export.basemaps = ["esri_satellite", "esri_streets"]
    assert build_map_data(data).default_basemap == "esri_streets"
    data.config.export.basemaps = ["google"]
    assert [b.id for b in build_map_data(data).basemaps] == ["esri_streets"]


def test_every_basemap_has_labels_in_both_languages() -> None:
    for basemap in BASEMAPS:
        assert EN.map_ui[f"basemap_{basemap.id}"]
        assert VI.map_ui[f"basemap_{basemap.id}"]


def test_data_carries_road_legs(data: ExportData) -> None:
    roads = {"center>gp:pho1": "_p~iF~ps|U", "gp:pho1>gp:banhmi2": "_ulLnnqC"}
    payload = json.loads(build_map_data(data, extras=MapExtras(roads=roads)).model_dump_json())
    assert payload["roads"] == roads
    assert build_map_data(data).roads == {}


def test_data_carries_the_routing_server_for_the_travel_mode(data: ExportData) -> None:
    data.config.travel.mode = "walking"
    data.config.roads.enabled = True
    payload = json.loads(build_map_data(data).model_dump_json())
    assert payload["roads_enabled"] is True
    assert payload["roads_endpoint"] == "https://routing.openstreetmap.de"
    assert payload["roads_profile"] == "routed-foot"
    data.config.roads.enabled = False
    assert build_map_data(data).roads_enabled is False


def test_default_routing_host_is_cached_by_the_service_worker(data: ExportData) -> None:
    host = urlsplit(build_map_data(data).roads_endpoint).hostname
    assert host in ROUTING_HOSTS


@pytest.mark.parametrize(
    ("name", "hosts"), [("TILE_HOSTS", TILE_HOSTS), ("ROUTING_HOSTS", ROUTING_HOSTS)]
)
def test_service_worker_host_lists_mirror_python(name: str, hosts: tuple[str, ...]) -> None:
    source = PWA_CONSTANTS.read_text(encoding="utf-8")
    match = re.search(rf"export const {name}: readonly string\[\] = \[([^\]]*)\]", source)
    assert match, f"{name} not found in {PWA_CONSTANTS.name}"
    assert tuple(re.findall(r'"([^"]+)"', match.group(1))) == hosts


def test_google_needs_the_basemap_listed(data: ExportData) -> None:
    src = google_loader_url(FAKE_KEY)
    with_google = build_map_data(data, src)
    assert with_google.google is not None
    assert with_google.default_basemap == "google"
    data.config.export.basemaps = ["esri_streets", "openfreemap"]
    without = build_map_data(data, src)
    assert without.google is None
    assert without.default_basemap == "openfreemap"


def test_no_google_key_without_flag(html: str) -> None:
    assert GOOGLE_MAPS_JS not in html
    assert "maps.googleapis.com/maps/api/js" not in html
    assert embedded(html)["google"] is None


def test_google_basemap_with_flag_and_key(
    ctx: Context, data: ExportData, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    ctx.config.export.google_map = True
    keyed = dataclasses.replace(ctx, secrets=Secrets(google_maps_browser_key=FAKE_KEY))
    key = google_map_key(keyed)
    assert key == FAKE_KEY
    with caplog.at_level(logging.WARNING):
        html = write_map(data, tmp_path / "map.html", google_key=key).read_text(encoding="utf-8")
    google = embedded(html)["google"]
    assert isinstance(google, dict)
    assert google["src"].startswith(GOOGLE_MAPS_JS + "?key=" + FAKE_KEY)
    assert "callback=tripGoogleReady" in google["src"]
    assert FAKE_KEY in html
    assert any("referrer-restricted" in record.getMessage() for record in caplog.records)


def test_google_key_needs_flag_and_secret(ctx: Context, caplog: pytest.LogCaptureFixture) -> None:
    keyed = dataclasses.replace(ctx, secrets=Secrets(google_maps_browser_key=FAKE_KEY))
    assert google_map_key(keyed) is None
    ctx.config.export.google_map = True
    keyless = dataclasses.replace(ctx, secrets=Secrets())
    with caplog.at_level(logging.WARNING):
        assert google_map_key(keyless) is None
    assert any("GOOGLE_MAPS_BROWSER_KEY is empty" in r.getMessage() for r in caplog.records)


def test_server_key_is_never_embedded(
    ctx: Context, data: ExportData, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    ctx.config.export.google_map = True
    server_only = dataclasses.replace(ctx, secrets=Secrets(google_maps_key=FAKE_KEY))
    with caplog.at_level(logging.WARNING):
        key = google_map_key(server_only)
    assert key is None
    assert any("never embedded" in r.getMessage() for r in caplog.records)
    html = write_map(data, tmp_path / "map.html", google_key=key).read_text(encoding="utf-8")
    assert embedded(html)["google"] is None
    app = tmp_path / "app"
    write_app(data, app, tmp_path / "media", google_key=key)
    assert FAKE_KEY not in html
    assert all(FAKE_KEY not in f.read_text(encoding="utf-8") for f in app.rglob("*.json"))
    assert FAKE_KEY not in (app / "index.html").read_text(encoding="utf-8")


def test_script_json_cannot_close_the_script(data: ExportData) -> None:
    data.places[0] = data.places[0].model_copy(update={"name": "</script><script>alert(1)"})
    html = render_map(build_map_data(data))
    assert "</script><script>alert(1)" not in html
    assert embedded(html)["places"][0]["name"] == "</script><script>alert(1)"  # type: ignore[index]


def test_file_size_under_limit(html: str) -> None:
    assert len(html.encode("utf-8")) < MAX_BYTES


def test_four_sector_map_has_four_rays() -> None:
    assert len(build_map_data(build_dataset(sectors=4)).rays) == 4


def test_map_without_spatial_or_plan_still_renders(data: ExportData, tmp_path: Path) -> None:
    data.spatial = None
    data.itinerary = None
    html = write_map(data, tmp_path / "map.html").read_text(encoding="utf-8")
    payload = embedded(html)
    assert payload["center"] is None
    assert payload["rays"] == []
    assert payload["days"] == []
    assert data.places[0].name in html


def test_destination_point_cardinal_directions() -> None:
    lat, lng = destination_point(10.0, 106.0, 0, 1.0)
    assert lat > 10.0
    assert lng == pytest.approx(106.0, abs=1e-6)
    lat, lng = destination_point(10.0, 106.0, 90, 1.0)
    assert lng > 106.0
    assert lat == pytest.approx(10.0, abs=1e-3)


def test_data_has_travel_matrix_plan_config_media_and_preferences(data: ExportData) -> None:
    ids = ["center", "gp:pho1", "gp:temple5"]
    matrix = TravelMatrix(ids=ids, minutes=[[0, 5, 9], [5, 0, 7], [9, 7, 0]])
    item = MediaItem(
        src="media/gp_pho1/google-1.jpg",
        kind="photo",
        caption="Google Maps photo by Ana",
        source_url="https://maps.google.com/?cid=1",
        attributions=[MediaAttribution(name="Ana", uri="https://maps.google.com/contrib/1")],
    )
    extras = MapExtras(
        media={"gp:pho1": [item], "gp:not-a-place": [item]},
        travel=TravelMatrix.from_csv(matrix.to_csv()),
        preferences=Preferences(must_go=["Phở Hòa"], removed=["gp:old"]),
    )
    payload = json.loads(build_map_data(data, extras=extras).model_dump_json(by_alias=True))
    assert payload["travel"] == {"ids": ids, "minutes": matrix.minutes}
    config = payload["config"]
    assert config["dayStart"] == data.config.plan.day_start
    assert config["dayEnd"] == data.config.plan.day_end
    assert [slot["id"] for slot in config["rhythm"]] == [s.id for s in data.config.plan.rhythm]
    assert set(config["rhythm"][0]) == {"id", "start", "end", "name_en", "name_vi", "categories"}
    assert config["serviceMinutes"] == {"food": 45, "cafe": 45, "attraction": 75, "other": 30}
    assert config["nearbyServiceMinutes"] == data.config.nearby.service_minutes
    assert config["restMinutes"] == 60
    assert config["tripDays"] == data.config.trip.days
    assert config["maxNearbyPerDay"] == data.config.trip.max_nearby_per_day
    assert config["dated"] is False
    assert payload["tripWeekdays"] == [5] * data.config.trip.days
    assert payload["tripDates"] == [None] * data.config.trip.days
    assert list(payload["media"]) == ["gp:pho1"]
    assert payload["media"]["gp:pho1"][0]["attributions"][0]["name"] == "Ana"
    assert payload["preferences"] == {"must_go": ["Phở Hòa"], "removed": ["gp:old"]}
    assert "tags" in payload["labels"]["en"]
    assert payload["labels"]["vi"]["tags"] == dict(VI.tags)


def test_travel_matrix_csv_round_trip_rejects_ragged_tables() -> None:
    matrix = TravelMatrix(ids=["center", "a"], minutes=[[0, 3], [4, 0]])
    assert TravelMatrix.from_csv(matrix.to_csv()) == matrix
    with pytest.raises(ValueError, match="square"):
        TravelMatrix.from_csv("from,center,a\ncenter,0,3\n")


def make_media(tmp_path: Path) -> tuple[Path, MapExtras]:
    media_dir = tmp_path / "media"
    (media_dir / "gp_pho1").mkdir(parents=True)
    (media_dir / "gp_pho1" / "frame-v1-001.jpg").write_bytes(b"\xff\xd8jpg")
    (media_dir / "gp_pho1" / "google-1.jpg").write_bytes(b"\xff\xd8g")
    items = [
        MediaItem(src="media/gp_pho1/google-1.jpg", kind="photo", caption="g", source_url="u"),
        MediaItem(src="media/gp_pho1/frame-v1-001.jpg", kind="frame", caption="f", source_url="u"),
    ]
    return media_dir, MapExtras(media={"gp:pho1": items})


def test_map_fills_title_and_data(data: ExportData, tmp_path: Path) -> None:
    data.config.city = "Đà <Lạt> & co"
    html = write_map(data, tmp_path / "map.html").read_text(encoding="utf-8")
    assert "<title>TwLP-Trips</title>" in html
    assert '<meta name="description" content="Đà &lt;Lạt&gt; &amp; co: lịch trình' in html
    assert "og:url" not in html
    assert "og:image" not in html
    for marker in ("__TRIP_DATA__", "__TRIP_TITLE__", "__SEO_HEAD__"):
        assert marker not in html
    assert embedded(html)["city"] == "Đà <Lạt> & co"


def test_missing_dist_explains_the_build(
    data: ExportData, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(map_html, "web_dist", lambda: tmp_path / "nope")
    with pytest.raises(UserFacingError, match=r"npm --prefix web ci && npm --prefix web run build"):
        write_map(data, tmp_path / "map.html")
    with pytest.raises(UserFacingError, match="npm --prefix web ci"):
        write_app(data, tmp_path / "app", tmp_path / "media")
    assert not (tmp_path / "map.html").exists()


@pytest.mark.parametrize(
    "page", ["<title>x</title>", "__TRIP_TITLE__ __TRIP_TITLE__ __TRIP_DATA__"]
)
def test_placeholder_not_exactly_once_is_an_error(
    data: ExportData, tmp_path: Path, fake_web_dist: Path, page: str
) -> None:
    (fake_web_dist / "single" / "index.html").write_text(page, encoding="utf-8")
    with pytest.raises(UserFacingError, match="exactly one"):
        write_map(data, tmp_path / "map.html")


def test_app_is_the_dist_copy_plus_trip_manifest_media_and_offline(
    data: ExportData, tmp_path: Path
) -> None:
    media_dir, extras = make_media(tmp_path)
    data.config.city = 'Đà "Lạt"'
    app_dir = write_app(data, tmp_path / "app", media_dir, extras=extras)
    names = {p.relative_to(app_dir).as_posix() for p in app_dir.rglob("*") if p.is_file()}
    assert names == {
        "index.html",
        "sw.js",
        "assets/index-abc.js",
        "manifest.webmanifest",
        "trip.json",
        "offline.json",
        "og-image.png",
        "robots.txt",
        "media/gp_pho1/frame-v1-001.jpg",
        "media/gp_pho1/google-1.jpg",
    }
    index = (app_dir / "index.html").read_text(encoding="utf-8")
    assert "__TRIP_DATA__" in index
    assert "<title>TwLP-Trips</title>" in index
    assert "__SEO_HEAD__" not in index
    trip = json.loads((app_dir / "trip.json").read_bytes())
    assert trip["city"] == 'Đà "Lạt"'
    assert trip["schema_version"] == MAP_SCHEMA_VERSION
    manifest = json.loads((app_dir / "manifest.webmanifest").read_text(encoding="utf-8"))
    assert manifest["name"] == f'TwLP-Trips {EN_DASH} Đà "Lạt"'
    assert manifest["short_name"] == "TwLP-Trips"
    assert manifest["description"].startswith('Đà "Lạt": lịch trình')
    offline = json.loads((app_dir / "offline.json").read_text(encoding="utf-8"))
    assert offline["urls"] == [
        "trip.json",
        "media/gp_pho1/frame-v1-001.jpg",
        "media/gp_pho1/google-1.jpg",
    ]
    assert re.fullmatch(r"[0-9a-f]{16}", offline["version"])
    for url in offline["urls"]:
        assert (app_dir / url).is_file()


def test_app_rewrite_drops_stale_files(data: ExportData, tmp_path: Path) -> None:
    app_dir = tmp_path / "app"
    app_dir.mkdir()
    (app_dir / "old.js").write_text("x", encoding="utf-8")
    write_app(data, app_dir, tmp_path / "no-media")
    assert not (app_dir / "old.js").exists()
    assert not (app_dir / "media").exists()


def test_app_rewrite_keeps_the_deploy_link(data: ExportData, tmp_path: Path) -> None:
    app_dir = tmp_path / "app"
    link = app_dir / ".vercel" / "project.json"
    link.parent.mkdir(parents=True)
    link.write_text('{"projectId": "prj_1"}', encoding="utf-8")
    write_app(data, app_dir, tmp_path / "no-media")
    assert link.read_text(encoding="utf-8") == '{"projectId": "prj_1"}'
    assert (app_dir / "index.html").is_file()


def test_offline_version_follows_trip_and_media(data: ExportData, tmp_path: Path) -> None:
    media_dir, extras = make_media(tmp_path)

    def version(name: str, map_extras: MapExtras | None) -> str:
        app_dir = write_app(data, tmp_path / name, media_dir, extras=map_extras)
        return str(json.loads((app_dir / "offline.json").read_text(encoding="utf-8"))["version"])

    first = version("a", extras)
    assert version("b", extras) == first
    assert version("c", None) != first
    data.places[0] = data.places[0].model_copy(update={"name": "Renamed"})
    assert version("d", extras) != first


def test_media_urls_are_sorted_and_unique() -> None:
    item = MediaItem(src="media/a/1.jpg", kind="photo", caption="", source_url="u")
    other = MediaItem(src="media/a/0.jpg", kind="photo", caption="", source_url="u")
    map_data = build_map_data(build_dataset(), extras=MapExtras(media={"gp:pho1": [item, other]}))
    assert media_urls(map_data) == ["media/a/0.jpg", "media/a/1.jpg"]
    assert json.loads(offline_json(b"{}", ["media/a/0.jpg"]))["urls"] == [
        "trip.json",
        "media/a/0.jpg",
    ]


def test_google_key_warns_for_the_app_too(
    data: ExportData, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING):
        app_dir = write_app(data, tmp_path / "app", tmp_path / "m", google_key=FAKE_KEY)
    assert FAKE_KEY in (app_dir / "trip.json").read_text(encoding="utf-8")
    assert any("referrer-restricted" in record.getMessage() for record in caplog.records)
