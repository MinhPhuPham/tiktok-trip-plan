from __future__ import annotations

import dataclasses
import io
import json
from pathlib import Path

import httpx
import pytest
import respx
from PIL import Image

from tiktok_trip.clients.google_photos import SKU_DETAILS_ESSENTIALS, SKU_PHOTOS
from tiktok_trip.config import QuotaConfig
from tiktok_trip.context import Context
from tiktok_trip.export import media
from tiktok_trip.models import Candidate, Evidence, EvidenceSource, Place
from tiktok_trip.quota import QuotaGuard
from tiktok_trip.storage import save_models, write_json

V1, V2 = "7000000000000000001", "7000000000000000002"
URL1 = f"https://www.tiktok.com/@a/video/{V1}"
URL2 = f"https://www.tiktok.com/@b/photo/{V2}"
GOOGLE_ID = "ChIJabc"
PLACE_ID = f"gp:{GOOGLE_ID}"
PHOTO_NAME = f"places/{GOOGLE_ID}/photos/ph1"
PHOTO_URI = "https://lh3.googleusercontent.com/places/ph1=s640"
DETAILS = {
    "photos": [
        {
            "name": PHOTO_NAME,
            "widthPx": 4000,
            "heightPx": 3000,
            "authorAttributions": [
                {"displayName": "Lan Nguyen", "uri": "https://maps.google.com/maps/contrib/1"}
            ],
            "googleMapsUri": "https://maps.google.com/photo/ph1",
        },
        {"name": f"places/{GOOGLE_ID}/photos/ph2"},
    ]
}


def frame_ev(timestamp: str, quote: str) -> Evidence:
    return Evidence(source=EvidenceSource.FRAME, quote=quote, timestamp=timestamp)


def image_bytes(size: tuple[int, int], fmt: str = "JPEG") -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 80, 40)).save(buffer, format=fmt)
    return buffer.getvalue()


def write_post(ctx: Context, video_id: str, url: str, frames: int, *, photo: bool = False) -> None:
    root = ctx.paths.raw_video(video_id)
    write_json(root / "source.json", {"url": url, "video_id": video_id, "has_video": not photo})
    (root / "frames").mkdir(parents=True)
    for n in range(1, frames + 1):
        (root / "frames" / f"{n:03d}.jpg").write_bytes(image_bytes((1920, 1080)))


def make_place(evidence: list[Evidence], videos: list[str], place_id: str = PLACE_ID) -> Place:
    return Place(
        id=place_id,
        name="Bún Bò Cô Ba",
        address="1 Lê Lợi",
        lat=11.94,
        lng=108.44,
        videos=videos,
        evidence=evidence,
        confidence=0.9,
    )


def candidate(video_id: str, url: str, evidence: list[Evidence]) -> Candidate:
    return Candidate(
        video_id=video_id, video_url=url, name="Bún Bò Cô Ba", evidence=evidence, confidence=0.9
    )


def seed(ctx: Context) -> Place:
    """Two posts of one place: V1 cites 002 and 005 (menu), V2 cites 001 (prices) and 003."""
    write_post(ctx, V1, URL1, 6)
    write_post(ctx, V2, URL2, 4, photo=True)
    v1 = [frame_ev("002.jpg", "Bún Bò Cô Ba - 1 Lê Lợi"), frame_ev("005.jpg", "MENU bún bò")]
    v2 = [frame_ev("slide 1.jpg", "Bún bò đặc biệt 45.000đ"), frame_ev("003.jpg", "Cô Ba")]
    other = [Evidence(source=EvidenceSource.CAPTION, quote="ngon")]
    place = make_place([*v1, *v2, *other], [URL1, URL2])
    save_models(ctx.paths.places_file, [place])
    save_models(ctx.paths.candidates_file, [candidate(V1, URL1, v1), candidate(V2, URL2, v2)])
    return place


@pytest.mark.parametrize(
    ("timestamp", "expected"),
    [
        ("011.jpg", "011.jpg"),
        ("slide 7.JPG (price list)", "007.jpg"),
        ("video 00:12-00:15 (extra frame extracted from video.mp4, not in frames/)", None),
        (None, None),
    ],
)
def test_frame_name(timestamp: str | None, expected: str | None) -> None:
    assert media.frame_name(timestamp) == expected


def test_is_menu_and_dir_name() -> None:
    assert media.is_menu("Phở bò 45.000đ")
    assert media.is_menu("bánh căn 30k / dĩa")
    assert media.is_menu("Xem menu")
    assert not media.is_menu("Hẻm 31 Sào Nam")
    assert media.place_dir_name("osm:node/123") == "osm_node_123"
    assert media.place_dir_name("gp:ChIJ-a_b") == "gp_ChIJ-a_b"


def test_select_frames_owner_menu_first_limit(tmp_path: Path) -> None:
    evidence = [
        frame_ev("001.jpg", "Quán A"),
        frame_ev("002.jpg", "Quán A - 2 Lê Lợi"),
        frame_ev("002.jpg", "Quán A - 2 Lê Lợi"),
        frame_ev("003.jpg", "Menu 35.000"),
        frame_ev("004.jpg", "Quán A"),
        frame_ev("009.jpg", "missing file"),
    ]
    place = make_place(evidence, [URL1, URL2])
    owners = {(e.quote, e.timestamp): {V1} for e in evidence}
    owners[("Quán A", "004.jpg")] = {V2}

    def locate(video_id: str, frame: str) -> Path | None:
        return None if frame == "009.jpg" else tmp_path / video_id / frame

    refs = media.select_frames(place, [(V1, URL1), (V2, URL2)], owners, locate, limit=3)
    assert [(r.video_id, r.frame, r.menu) for r in refs] == [
        (V1, "003.jpg", True),
        (V1, "001.jpg", False),
        (V1, "002.jpg", False),
    ]
    assert refs[0].file_name == f"frame-{V1}-003.jpg"
    assert refs[0].video_url == URL1

    unknown = media.select_frames(place, [(V1, URL1), (V2, URL2)], {}, locate, limit=4)
    assert unknown == []
    single = media.select_frames(place, [(V1, URL1)], {}, locate, limit=10)
    assert [r.frame for r in single] == ["003.jpg", "001.jpg", "002.jpg", "004.jpg"]


def test_build_media_resizes_and_writes_index(ctx: Context) -> None:
    seed(ctx)
    summary = media.build_media(ctx)
    assert (summary.places, summary.places_with_frames, summary.frames) == (1, 1, 4)
    assert summary.frames_written == 4
    assert summary.google == "off"

    folder = ctx.paths.media_dir / "gp_ChIJabc"
    assert sorted(p.name for p in folder.iterdir()) == [
        f"frame-{V1}-002.jpg",
        f"frame-{V1}-005.jpg",
        f"frame-{V2}-001.jpg",
        f"frame-{V2}-003.jpg",
    ]
    with Image.open(folder / f"frame-{V1}-005.jpg") as image:
        assert image.format == "JPEG"
        assert image.size == (640, 360)

    index = json.loads(ctx.paths.media_index.read_text(encoding="utf-8"))
    assert list(index) == [PLACE_ID]
    items = index[PLACE_ID]
    assert [i["src"] for i in items[:2]] == [
        f"media/gp_ChIJabc/frame-{V1}-005.jpg",
        f"media/gp_ChIJabc/frame-{V2}-001.jpg",
    ]
    assert items[0] == {
        "src": f"media/gp_ChIJabc/frame-{V1}-005.jpg",
        "kind": "frame",
        "caption": "MENU bún bò",
        "source_url": URL1,
        "attributions": [],
    }
    assert {i["kind"] for i in items} == {"frame"}
    assert all((ctx.paths.output / i["src"]).exists() for i in items)
    assert media.media_index(ctx) == summary.index


def test_build_media_is_idempotent_and_drops_stale_frames(ctx: Context) -> None:
    seed(ctx)
    media.build_media(ctx)
    stale = ctx.paths.media_dir / "gp_gone" / f"frame-{V1}-001.jpg"
    stale.parent.mkdir(parents=True)
    stale.write_bytes(b"old")
    kept_photo = ctx.paths.media_dir / "gp_kept" / "google-1.jpg"
    kept_photo.parent.mkdir(parents=True)
    kept_photo.write_bytes(b"paid")

    again = media.build_media(ctx)
    assert again.frames == 4
    assert again.frames_written == 0
    assert not stale.parent.exists()
    assert kept_photo.exists()


def test_media_index_empty_before_first_build(ctx: Context) -> None:
    assert media.media_index(ctx) == {}


def enable_google(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ctx.secrets, "google_maps_key", "test-key")
    ctx.config.export.google_photos = True


def google_routes(router: respx.MockRouter) -> tuple[respx.Route, respx.Route, respx.Route]:
    details = router.get(host="places.googleapis.com", path=f"/v1/places/{GOOGLE_ID}").mock(
        return_value=httpx.Response(200, json=DETAILS)
    )
    photo = router.get(host="places.googleapis.com", path=f"/v1/{PHOTO_NAME}/media").mock(
        return_value=httpx.Response(200, json={"name": PHOTO_NAME, "photoUri": PHOTO_URI})
    )
    download = router.get(PHOTO_URI).mock(
        return_value=httpx.Response(200, content=image_bytes((1600, 1200), "PNG"))
    )
    return details, photo, download


def test_google_photo_flow_with_quota_accounting(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed(ctx)
    enable_google(ctx, monkeypatch)
    with respx.mock(assert_all_called=True) as router:
        details, photo, download = google_routes(router)
        summary = media.build_media(ctx)

        assert details.calls.last.request.headers["X-Goog-FieldMask"] == "photos"
        media_params = photo.calls.last.request.url.params
        assert media_params["maxWidthPx"] == "640"
        assert media_params["skipHttpRedirect"] == "true"
        assert (summary.google, summary.photos_new, summary.photos_cached) == ("on", 1, 0)
        assert summary.places_with_photos == 1

        image_path = ctx.paths.media_dir / "gp_ChIJabc" / "google-1.jpg"
        with Image.open(image_path) as image:
            assert image.size == (640, 480)
        last = media.media_index(ctx)[PLACE_ID][-1]
        assert last.kind == "photo"
        assert last.src == "media/gp_ChIJabc/google-1.jpg"
        assert last.caption == "Google Maps photo by Lan Nguyen"
        assert last.source_url == "https://maps.google.com/photo/ph1"
        assert [a.name for a in last.attributions] == ["Lan Nguyen"]

        calls = [c for c in ctx.api_log.read() if not c.cache_hit]
        assert sorted(c.sku for c in calls) == [SKU_DETAILS_ESSENTIALS, SKU_PHOTOS]
        assert ctx.quota.used(SKU_PHOTOS, "month") == 1

        again = media.build_media(ctx)
        assert (again.photos_new, again.photos_cached) == (0, 1)
        assert (details.call_count, photo.call_count, download.call_count) == (1, 1, 1)
        assert again.index[PLACE_ID][-1] == last


def test_google_photo_uri_reused_from_cache_when_file_deleted(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed(ctx)
    enable_google(ctx, monkeypatch)
    with respx.mock(assert_all_called=True) as router:
        details, photo, download = google_routes(router)
        media.build_media(ctx)
        (ctx.paths.media_dir / "gp_ChIJabc" / "google-1.jpg").unlink()
        summary = media.build_media(ctx)
        assert summary.photos_new == 1
        assert (details.call_count, photo.call_count, download.call_count) == (1, 1, 2)
    assert ctx.quota.used(SKU_PHOTOS, "month") == 1


def test_google_photos_stop_at_quota(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    seed(ctx)
    enable_google(ctx, monkeypatch)
    capped = QuotaGuard(QuotaConfig(monthly={SKU_PHOTOS: 0}), ctx.api_log)
    capped_ctx = dataclasses.replace(ctx, quota=capped)
    with respx.mock(assert_all_called=False) as router:
        details, photo, download = google_routes(router)
        summary = media.build_media(capped_ctx)
        assert summary.google == "quota stop"
        assert (details.call_count, photo.call_count, download.call_count) == (1, 0, 0)
    assert summary.frames == 4
    assert {i.kind for i in media.media_index(ctx)[PLACE_ID]} == {"frame"}


def test_flag_off_or_no_key_makes_no_google_call(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed(ctx)
    monkeypatch.setattr(ctx.secrets, "google_maps_key", "test-key")
    with respx.mock(assert_all_called=False) as router:
        google_routes(router)
        assert media.build_media(ctx).google == "off"
        monkeypatch.setattr(ctx.secrets, "google_maps_key", None)
        ctx.config.export.google_photos = True
        assert media.build_media(ctx).google == "no key"
        assert not router.calls
    assert not ctx.paths.api_log.exists()
