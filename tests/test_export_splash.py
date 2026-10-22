from __future__ import annotations

import io
import re
from pathlib import Path

import pytest
from fixtures.sample_dataset import build_dataset
from PIL import Image

from tiktok_trip.export.dataset import ExportData
from tiktok_trip.export.map_html import write_app
from tiktok_trip.export.splash import SCREENS, Screen, render_splash, write_splash_screens

ICON_COLOR = (75, 83, 199)
BACKGROUND = (0x16, 0x18, 0x1D)
MAX_SPLASH_BYTES = 120 * 1024


@pytest.fixture
def data() -> ExportData:
    return build_dataset()


def icon_file(path: Path) -> Path:
    Image.new("RGB", (512, 512), ICON_COLOR).save(path)
    return path


def test_splash_is_the_icon_centred_on_the_manifest_background() -> None:
    screen = Screen(390, 844, 3)
    image = Image.open(io.BytesIO(render_splash(Image.new("RGBA", (512, 512), ICON_COLOR), screen)))
    assert image.size == (1170, 2532)
    assert image.getpixel((5, 5)) == BACKGROUND
    assert image.getpixel((585, 1266)) == ICON_COLOR
    assert image.getpixel((585, 900)) == BACKGROUND


def test_screens_are_unique_portrait_iphones() -> None:
    assert len({screen.path for screen in SCREENS}) == len(SCREENS)
    assert all(screen.height > screen.width and screen.ratio in (2, 3) for screen in SCREENS)
    assert Screen(430, 932, 3).media == (
        "(device-width: 430px) and (device-height: 932px) and "
        "(-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
    )


def test_no_icon_no_launch_screens(tmp_path: Path) -> None:
    assert write_splash_screens(tmp_path, tmp_path / "missing.png") == ""
    assert not (tmp_path / "splash").exists()


def test_app_links_one_launch_screen_per_iphone(
    data: ExportData, tmp_path: Path, fake_web_dist: Path
) -> None:
    icon_file(fake_web_dist / "app" / "icon-512.png")
    app_dir = write_app(data, tmp_path / "app", tmp_path / "media")
    index = (app_dir / "index.html").read_text(encoding="utf-8")
    links = re.findall(
        r'<link rel="apple-touch-startup-image" href="([^"]+)" media="([^"]+)">', index
    )
    assert [href for href, _ in links] == [screen.path for screen in SCREENS]
    for href, media in links:
        file = app_dir / href
        width, height = Image.open(file).size
        assert f"{width}x{height}" in href
        assert "orientation: portrait" in media
        assert file.stat().st_size < MAX_SPLASH_BYTES
