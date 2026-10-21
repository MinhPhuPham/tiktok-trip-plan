from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any, ClassVar

import httpx
import pytest
import respx
from PIL import Image

from tiktok_trip.clients.tiktok_comments import PostScrape
from tiktok_trip.config import FetchConfig
from tiktok_trip.context import Context
from tiktok_trip.extraction.raw import PostPage, RawComment, VideoFiles
from tiktok_trip.steps import fetch
from tiktok_trip.storage import read_json

FIXTURE = Path(__file__).parent / "fixtures" / "tiktok_info.json"
URL = "https://www.tiktok.com/@reviewer/video/7400000000000000001"
SHORT_URL = "https://vt.tiktok.com/ZSabc123/"
BAD_URL = "https://www.tiktok.com/@nobody/video/999"


class FakeYoutubeDL:
    """Stands in for yt_dlp.YoutubeDL: records calls, writes files like a real download."""

    calls: ClassVar[list[tuple[str, bool]]] = []
    fail_urls: ClassVar[set[str]] = set()
    info: ClassVar[dict[str, Any] | None] = None

    def __init__(self, params: dict[str, Any]) -> None:
        self.params = params

    def __enter__(self) -> FakeYoutubeDL:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def extract_info(self, url: str, download: bool = True) -> dict[str, Any]:
        self.calls.append((url, download))
        if url in self.fail_urls:
            raise RuntimeError("Unable to extract webpage video data")
        if self.info is not None:
            info = json.loads(json.dumps(self.info))
        else:
            info = json.loads(FIXTURE.read_text(encoding="utf-8"))
        if download and "writeinfojson" not in self.params:
            Path(self.params["outtmpl"]["default"].replace("%(ext)s", "mp3")).write_bytes(b"mp3")
            return info
        if download:
            assert self.params["getcomments"] and self.params["writeinfojson"]
            target = Path(self.params["outtmpl"]["default"].replace("%(ext)s", "mp4"))
            if not self.params["skip_download"]:
                target.write_bytes(b"fake-mp4")
            target.with_name("video.info.json").write_text(json.dumps(info), encoding="utf-8")
        return info

    def sanitize_info(self, info: dict[str, Any]) -> dict[str, Any]:
        return info


@pytest.fixture
def fake_ydl(monkeypatch: pytest.MonkeyPatch) -> type[FakeYoutubeDL]:
    FakeYoutubeDL.calls = []
    FakeYoutubeDL.fail_urls = set()
    FakeYoutubeDL.info = None
    monkeypatch.setattr(fetch, "YoutubeDL", FakeYoutubeDL)
    return FakeYoutubeDL


def test_parse_links_skips_comments_blanks_and_duplicates() -> None:
    text = "# my links\n\nhttps://a\n  https://b  \nhttps://a\n#https://c\n"
    assert fetch.parse_links(text) == ["https://a", "https://b"]


def test_merge_links_appends_only_new_and_keeps_file_tidy() -> None:
    text = "# header\nhttps://a\n\n\n"
    merged = fetch.merge_links(text, ["https://a", " https://b ", "https://b", "", "# no"])
    assert merged == "# header\nhttps://a\nhttps://b\n"
    assert fetch.merge_links("", []) == ""


def test_add_links_writes_links_file(ctx: Context) -> None:
    ctx.paths.links_file.write_text("# One TikTok URL per line.\n", encoding="utf-8")
    fetch.add_links(ctx, [URL, URL])
    fetch.add_links(ctx, [URL])
    assert (
        ctx.paths.links_file.read_text(encoding="utf-8") == f"# One TikTok URL per line.\n{URL}\n"
    )


def test_normalize_comments_maps_yt_dlp_shape() -> None:
    info = json.loads(FIXTURE.read_text(encoding="utf-8"))
    comments = fetch.normalize_comments(info["comments"], info)
    assert [c.author for c in comments] == ["fan1", "fan2", "reviewer", "fan3"]
    first, _, creator, liked = comments
    assert first.parent is None and first.timestamp == 1720000000 and not first.is_creator
    assert creator.is_creator and creator.parent == "2"
    assert liked.like_count == 1200 and liked.timestamp is None


def test_normalize_comments_detects_creator_by_id_without_flag() -> None:
    comments = fetch.normalize_comments(
        [{"comment": "Quán mở tới 2h sáng", "author_id": "42", "like_count": None}],
        {"uploader_id": "42"},
    )
    assert comments[0].is_creator and comments[0].author == "42" and comments[0].like_count == 0


@pytest.mark.parametrize(
    ("raw", "expected"), [(7, 7), ("1,234", 1234), ("3.5k", 3500), ("2M", 2_000_000), ("n/a", 0)]
)
def test_parse_count(raw: object, expected: int) -> None:
    assert fetch.parse_count(raw) == expected


def test_run_downloads_then_skips(ctx: Context, fake_ydl: type[FakeYoutubeDL]) -> None:
    ctx.paths.links_file.write_text(f"{URL}\n", encoding="utf-8")
    fetch.run(ctx)

    files = VideoFiles.of(ctx.paths, "7400000000000000001")
    assert files.video.exists() and files.info.exists()
    assert not (files.root / "video.info.json").exists()
    assert read_json(files.source) == {
        "url": URL,
        "video_id": "7400000000000000001",
        "comments_source": "yt-dlp",
        "has_video": True,
        "image_count": None,
        "images_source": None,
    }
    comments = read_json(files.comments)
    assert len(comments) == 4
    assert set(comments[0]) == {"author", "text", "is_creator", "like_count", "parent", "timestamp"}
    assert fake_ydl.calls == [(URL, True)]

    fetch.run(ctx)
    assert fake_ydl.calls == [(URL, True)]


def test_short_link_is_probed_once_then_known(ctx: Context, fake_ydl: type[FakeYoutubeDL]) -> None:
    ctx.paths.links_file.write_text(f"{SHORT_URL}\n", encoding="utf-8")
    fetch.run(ctx)
    assert fake_ydl.calls == [(SHORT_URL, False), (SHORT_URL, True)]

    fetch.run(ctx)
    assert len(fake_ydl.calls) == 2


def test_existing_download_is_not_refetched(ctx: Context, fake_ydl: type[FakeYoutubeDL]) -> None:
    files = VideoFiles.of(ctx.paths, "7400000000000000001")
    files.root.mkdir(parents=True)
    files.video.write_bytes(b"x")
    files.info.write_text(FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
    ctx.paths.links_file.write_text(f"{URL}\n", encoding="utf-8")

    fetch.run(ctx)

    assert fake_ydl.calls == []
    assert files.comments.exists() and files.source.exists()


def test_failure_retries_once_records_and_continues(
    ctx: Context, fake_ydl: type[FakeYoutubeDL]
) -> None:
    fake_ydl.fail_urls = {BAD_URL}
    ctx.paths.links_file.write_text(f"{BAD_URL}\n{URL}\n", encoding="utf-8")

    fetch.run(ctx)

    assert fake_ydl.calls.count((BAD_URL, True)) == 2
    failures = read_json(ctx.paths.fetch_failures)
    assert [f["url"] for f in failures] == [BAD_URL]
    assert "Unable to extract" in failures[0]["error"]
    assert VideoFiles.of(ctx.paths, "7400000000000000001").video.exists()


def test_download_without_mp4_is_a_failure(
    ctx: Context, monkeypatch: pytest.MonkeyPatch, fake_ydl: type[FakeYoutubeDL]
) -> None:
    def no_video(self: FakeYoutubeDL, url: str, download: bool = True) -> dict[str, Any]:
        self.calls.append((url, download))
        return {"id": "7400000000000000001"}

    monkeypatch.setattr(FakeYoutubeDL, "extract_info", no_video)
    ctx.paths.links_file.write_text(f"{URL}\n", encoding="utf-8")
    fetch.run(ctx)
    assert "no video file" in read_json(ctx.paths.fetch_failures)[0]["error"]


class FakeScraper:
    """Stands in for tiktok_comments.scrape_post."""

    def __init__(self, result: list[RawComment] | PostScrape | Exception) -> None:
        self.result = result
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def __call__(self, url: str, **kwargs: Any) -> PostScrape:
        self.calls.append((url, kwargs))
        if isinstance(self.result, Exception):
            raise self.result
        if isinstance(self.result, PostScrape):
            return self.result
        return PostScrape(comments=self.result if kwargs["comments"] else [])


def downloaded_without_comments(ctx: Context, comment_count: int = 10) -> VideoFiles:
    """A video fetched earlier whose comments.json yt-dlp left empty."""
    info = json.loads(FIXTURE.read_text(encoding="utf-8"))
    info["comments"] = []
    info["comment_count"] = comment_count
    files = VideoFiles.of(ctx.paths, "7400000000000000001")
    files.root.mkdir(parents=True)
    files.video.write_bytes(b"x")
    files.info.write_text(json.dumps(info), encoding="utf-8")
    files.comments.write_text("[]", encoding="utf-8")
    files.source.write_text(json.dumps({"url": URL, "video_id": files.video_id}), encoding="utf-8")
    ctx.paths.links_file.write_text(f"{URL}\n", encoding="utf-8")
    return files


SCRAPED = [
    RawComment(author="Reviewer", text="534 Vĩnh Khánh nha", is_creator=True, parent="1"),
    RawComment(author="fan", text="Ở đâu vậy?", like_count=3),
]


def test_empty_comments_are_scraped_without_redownload(
    ctx: Context, fake_ydl: type[FakeYoutubeDL], monkeypatch: pytest.MonkeyPatch
) -> None:
    files = downloaded_without_comments(ctx)
    scraper = FakeScraper(SCRAPED)
    monkeypatch.setattr(fetch.tiktok_comments, "scrape_post", scraper)

    fetch.run(ctx)

    assert fake_ydl.calls == []
    url, kwargs = scraper.calls[0]
    assert url == URL
    assert kwargs["max_comments"] == ctx.config.fetch.max_comments
    assert "6800000000000000000" in kwargs["creator_ids"]
    assert kwargs["video_id"] == "7400000000000000001"
    assert kwargs["comments"] is True and kwargs["images"] is False
    assert [c["author"] for c in read_json(files.comments)] == ["Reviewer", "fan"]
    assert read_json(files.source)["comments_source"] == "playwright"

    fetch.run(ctx)
    assert len(scraper.calls) == 1


def test_scraper_failure_is_logged_not_fatal(
    ctx: Context, fake_ydl: type[FakeYoutubeDL], monkeypatch: pytest.MonkeyPatch
) -> None:
    files = downloaded_without_comments(ctx)
    monkeypatch.setattr(fetch.tiktok_comments, "scrape_post", FakeScraper(RuntimeError("boom")))

    fetch.run(ctx)

    assert read_json(ctx.paths.fetch_failures) == []
    assert read_json(files.comments) == []
    assert read_json(files.source)["comments_source"] == "none"


@pytest.mark.parametrize(
    ("config", "comment_count"),
    [(FetchConfig(comments="none"), 10), (FetchConfig(), 0)],
)
def test_scraper_skipped_when_disabled_or_no_comments(
    ctx: Context, monkeypatch: pytest.MonkeyPatch, config: FetchConfig, comment_count: int
) -> None:
    files = downloaded_without_comments(ctx, comment_count)
    scraper = FakeScraper(SCRAPED)
    monkeypatch.setattr(fetch.tiktok_comments, "scrape_post", scraper)

    fetch.ensure_page_data(files, config)

    assert scraper.calls == []
    assert read_json(files.source)["comments_source"] == "none"


PHOTO_ID = "7400000000000000003"
PHOTO_URL = f"https://www.tiktok.com/@reviewer/photo/{PHOTO_ID}"
PHOTO_PAGE_URL = f"https://www.tiktok.com/@reviewer/video/{PHOTO_ID}"
AUDIO_FORMAT = {"format_id": "audio", "ext": "mp3", "vcodec": "none", "acodec": "mp3"}
SLIDE_URLS = [
    [
        f"https://p16-sign.tiktokcdn.com/photomode/{n}.jpeg",
        f"https://p19-sign.tiktokcdn.com/{n}.jpeg",
    ]
    for n in ("a", "b", "c")
]


def jpeg(color: str, size: tuple[int, int] = (40, 50)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="JPEG")
    return buffer.getvalue()


def photo_info(**extra: Any) -> dict[str, Any]:
    """What yt-dlp 2026.08 returns for a photo post: one mp3 format, the cover as thumbnail."""
    info: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))
    info.update(
        id=PHOTO_ID,
        webpage_url=PHOTO_PAGE_URL,
        formats=[{**AUDIO_FORMAT, "url": "https://v16m.tiktokcdn.com/audio.mp3"}],
        thumbnails=[{"id": "cover", "url": "https://p16-sign.tiktokcdn.com/photomode/a.jpeg"}],
        track="âm thanh gốc - Music For Life",
        artist="Music For Life",
    )
    info.update(extra)
    return info


@pytest.fixture
def photo_ydl(fake_ydl: type[FakeYoutubeDL], ctx: Context) -> type[FakeYoutubeDL]:
    fake_ydl.info = photo_info()
    ctx.paths.links_file.write_text(f"{PHOTO_URL}\n", encoding="utf-8")
    return fake_ydl


def test_photo_post_slides_from_yt_dlp_formats(
    ctx: Context, photo_ydl: type[FakeYoutubeDL], monkeypatch: pytest.MonkeyPatch
) -> None:
    images = [
        {"format_id": f"image-{i}", "ext": "jpg", "vcodec": "none", "acodec": "none", "url": url}
        for i, (url, _) in enumerate(SLIDE_URLS)
    ]
    photo_ydl.info = photo_info(formats=[*photo_info()["formats"], *images])
    scraper = FakeScraper(RuntimeError("the browser must not open"))
    monkeypatch.setattr(fetch.tiktok_comments, "scrape_post", scraper)
    with respx.mock(assert_all_called=True) as router:
        for (url, _), color in zip(SLIDE_URLS, ("red", "green", "blue"), strict=True):
            router.get(url).respond(200, content=jpeg(color))
        fetch.run(ctx)

    files = VideoFiles.of(ctx.paths, PHOTO_ID)
    assert photo_ydl.calls == [(PHOTO_PAGE_URL, True)]
    assert [p.name for p in files.image_paths()] == ["001.jpg", "002.jpg", "003.jpg"]
    with Image.open(files.image_path(3)) as third:
        assert third.getpixel((20, 25))[2] > 200
    source = read_json(files.source)
    assert source["has_video"] is False and source["image_count"] == 3
    assert source["images_source"] == "yt-dlp"
    assert len(read_json(files.comments)) == 4
    assert scraper.calls == []
    assert not files.video.exists() and files.audio_file() is None
    assert read_json(ctx.paths.fetch_failures) == []


def test_photo_post_slides_from_the_page_then_never_again(
    ctx: Context, photo_ydl: type[FakeYoutubeDL], monkeypatch: pytest.MonkeyPatch
) -> None:
    page = PostPage(title="Đà Lạt cuối năm", poi={"name": "Đà Lạt"})
    scraper = FakeScraper(PostScrape(images=SLIDE_URLS, page=page))
    monkeypatch.setattr(fetch.tiktok_comments, "scrape_post", scraper)
    with respx.mock() as router:
        first_cdn = [router.get(p16).respond(403) for p16, _ in SLIDE_URLS]
        backups = [router.get(p19).respond(200, content=jpeg("white")) for _, p19 in SLIDE_URLS]
        fetch.run(ctx)
        fetch.run(ctx)

    files = VideoFiles.of(ctx.paths, PHOTO_ID)
    assert len(files.image_paths()) == 3
    assert [r.call_count for r in first_cdn] == [1, 1, 1]
    assert [r.call_count for r in backups] == [1, 1, 1]
    url, kwargs = scraper.calls[0]
    assert len(scraper.calls) == 1 and url == PHOTO_URL
    assert kwargs["images"] is True and kwargs["comments"] is False
    source = read_json(files.source)
    assert (source["image_count"], source["images_source"]) == (3, "playwright")
    assert read_json(files.post)["title"] == "Đà Lạt cuối năm"
    assert photo_ydl.calls == [(PHOTO_PAGE_URL, True)]
    assert fetch.is_complete(files)


def test_missing_slides_are_retried_and_present_ones_kept(
    ctx: Context, photo_ydl: type[FakeYoutubeDL], monkeypatch: pytest.MonkeyPatch
) -> None:
    scraper = FakeScraper(PostScrape(images=SLIDE_URLS))
    monkeypatch.setattr(fetch.tiktok_comments, "scrape_post", scraper)
    with respx.mock() as router:
        router.get(SLIDE_URLS[0][0]).respond(200, content=jpeg("red"))
        router.get(SLIDE_URLS[1][0]).respond(200, content=jpeg("red"))
        flaky = router.get(SLIDE_URLS[2][0]).mock(
            side_effect=[httpx.Response(500), httpx.Response(200, content=jpeg("blue"))]
        )
        router.get(SLIDE_URLS[2][1]).respond(404)
        fetch.run(ctx)
        files = VideoFiles.of(ctx.paths, PHOTO_ID)
        assert len(files.image_paths()) == 2
        assert read_json(files.source)["image_count"] == 3

        fetch.run(ctx)
        assert len(files.image_paths()) == 3
        assert flaky.call_count == 2
        assert router.get(SLIDE_URLS[0][0]).call_count == 1

        fetch.run(ctx)
    assert len(scraper.calls) == 2


def test_photo_post_without_slides_logs_and_retries_next_run(
    ctx: Context, photo_ydl: type[FakeYoutubeDL], monkeypatch: pytest.MonkeyPatch
) -> None:
    scraper = FakeScraper(RuntimeError("captcha"))
    monkeypatch.setattr(fetch.tiktok_comments, "scrape_post", scraper)
    fetch.run(ctx)
    fetch.run(ctx)
    files = VideoFiles.of(ctx.paths, PHOTO_ID)
    assert read_json(files.source)["image_count"] is None
    assert read_json(ctx.paths.fetch_failures) == []
    assert len(scraper.calls) == 2 and photo_ydl.calls == [(PHOTO_PAGE_URL, True)]


def test_photo_post_downloads_the_creators_own_sound_only(
    ctx: Context, photo_ydl: type[FakeYoutubeDL], monkeypatch: pytest.MonkeyPatch
) -> None:
    photo_ydl.info = photo_info(track="âm thanh gốc - Reviewer Sài Gòn", artist="Reviewer Sài Gòn")
    monkeypatch.setattr(fetch.tiktok_comments, "scrape_post", FakeScraper(PostScrape()))
    fetch.run(ctx)
    files = VideoFiles.of(ctx.paths, PHOTO_ID)
    assert files.audio_file() == files.root / "audio.mp3"
    assert photo_ydl.calls == [(PHOTO_PAGE_URL, True), (PHOTO_PAGE_URL, True)]


def test_photo_post_without_any_format_is_fetched(
    ctx: Context, photo_ydl: type[FakeYoutubeDL], monkeypatch: pytest.MonkeyPatch
) -> None:
    original = FakeYoutubeDL.extract_info

    def no_formats(self: FakeYoutubeDL, url: str, download: bool = True) -> dict[str, Any]:
        if not self.params.get("ignore_no_formats_error"):
            raise RuntimeError("ERROR: [TikTok] No video formats found!")
        return original(self, url, download)

    photo_ydl.info = photo_info(formats=[])
    monkeypatch.setattr(FakeYoutubeDL, "extract_info", no_formats)
    monkeypatch.setattr(fetch.tiktok_comments, "scrape_post", FakeScraper(PostScrape()))
    fetch.run(ctx)
    files = VideoFiles.of(ctx.paths, PHOTO_ID)
    assert read_json(files.source)["has_video"] is False
    assert read_json(ctx.paths.fetch_failures) == []
    assert not fetch.download_options(files)["ignore_no_formats_error"]


def test_own_sound() -> None:
    assert fetch.own_sound({"artist": "reviewer", "uploader": "Reviewer"})
    assert fetch.own_sound({"artists": ["Nga Ré Bản"], "channel": "Nga Ré Bản"})
    assert not fetch.own_sound({"artist": "Music For Life", "channel": "Nga Ré Bản"})
    assert not fetch.own_sound({"channel": "Nga Ré Bản"})


def test_image_urls_from_info() -> None:
    assert fetch.image_urls_from_info(photo_info()) == []
    entries = [{"url": "https://x/1.jpg", "ext": "jpg"}, {"url": "https://x/2.mp3", "ext": "mp3"}]
    assert fetch.image_urls_from_info({"entries": entries}) == [["https://x/1.jpg"]]


def test_short_link_to_photo_post_is_detected_from_formats(
    ctx: Context, monkeypatch: pytest.MonkeyPatch, fake_ydl: type[FakeYoutubeDL]
) -> None:
    def audio_only(self: FakeYoutubeDL, url: str, download: bool = True) -> dict[str, Any]:
        self.calls.append((url, download))
        info = {"id": PHOTO_ID, "formats": [{"vcodec": "none", "acodec": "mp3"}]}
        return info

    monkeypatch.setattr(FakeYoutubeDL, "extract_info", audio_only)
    monkeypatch.setattr(fetch.tiktok_comments, "scrape_post", FakeScraper(PostScrape()))
    ctx.paths.links_file.write_text(f"{SHORT_URL}\n", encoding="utf-8")
    fetch.run(ctx)
    files = VideoFiles.of(ctx.paths, PHOTO_ID)
    assert read_json(files.source)["has_video"] is False
    assert read_json(ctx.paths.fetch_failures) == []


def test_is_photo_post() -> None:
    assert fetch.is_photo_post(PHOTO_URL)
    assert not fetch.is_photo_post(URL)
    assert fetch.is_photo_post(SHORT_URL, {"webpage_url": PHOTO_URL})
    assert not fetch.is_photo_post(SHORT_URL, {"formats": [{"vcodec": "h264"}]})


def test_video_page_url_rewrites_photo_links_only() -> None:
    assert fetch.video_page_url(PHOTO_URL) == PHOTO_PAGE_URL
    assert fetch.video_page_url(URL) == URL
