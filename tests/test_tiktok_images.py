from __future__ import annotations

import io
from pathlib import Path

import pytest
import respx
from PIL import Image

from tiktok_trip.clients import tiktok_images

REFERER = "https://www.tiktok.com/@a/photo/1"


def _image(fmt: str) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(buffer, format=fmt)
    return buffer.getvalue()


def test_download_tries_each_url_and_sends_browser_headers(tmp_path: Path) -> None:
    targets = [tmp_path / "images" / "001.jpg", tmp_path / "images" / "002.jpg"]
    with respx.mock() as router:
        router.get("https://p16/1").respond(403)
        backup = router.get("https://p19/1").respond(200, content=_image("JPEG"))
        router.get("https://p16/2").respond(200, content=_image("WEBP"))
        present = tiktok_images.download_images(
            [["https://p16/1", "https://p19/1"], ["https://p16/2"]], targets, referer=REFERER
        )
    assert present == 2
    request = backup.calls[0].request
    assert request.headers["Referer"] == REFERER
    assert "Chrome" in request.headers["User-Agent"]
    assert all(t.read_bytes().startswith(tiktok_images.JPEG_MAGIC) for t in targets)
    assert not list(targets[0].parent.glob("*.part"))


def test_existing_files_are_not_downloaded_again(tmp_path: Path) -> None:
    target = tmp_path / "001.jpg"
    target.write_bytes(b"already here")
    with respx.mock(assert_all_called=False) as router:
        route = router.get("https://p16/1").respond(200, content=_image("JPEG"))
        assert tiktok_images.download_images([["https://p16/1"]], [target], referer=REFERER) == 1
    assert route.call_count == 0 and target.read_bytes() == b"already here"


def test_html_error_page_is_not_saved_as_an_image(tmp_path: Path) -> None:
    target = tmp_path / "001.jpg"
    with respx.mock() as router:
        router.get("https://p16/1").respond(200, content=b"<html>blocked</html>")
        assert tiktok_images.download_images([["https://p16/1"]], [target], referer=REFERER) == 0
    assert not target.exists()


def test_as_jpeg_rejects_non_images() -> None:
    with pytest.raises(tiktok_images.NotAnImageError):
        tiktok_images.as_jpeg(b"nope")
