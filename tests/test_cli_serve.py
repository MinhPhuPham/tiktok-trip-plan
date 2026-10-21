from __future__ import annotations

import threading
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path

import pytest
from typer.testing import CliRunner

from tiktok_trip.cli import app
from tiktok_trip.export.serve import AppRequestHandler, handler_factory, make_server
from tiktok_trip.paths import ROOT_ENV, Paths


@pytest.fixture
def served(tmp_path: Path) -> Iterator[str]:
    app_dir = tmp_path / "app"
    (app_dir / "assets").mkdir(parents=True)
    (app_dir / "media" / "gp_x").mkdir(parents=True)
    (app_dir / "index.html").write_text("<!doctype html><title>t</title>", encoding="utf-8")
    (app_dir / "assets" / "index.js").write_text("console.log(1);", encoding="utf-8")
    (app_dir / "trip.json").write_text("{}", encoding="utf-8")
    (app_dir / "offline.json").write_text("{}", encoding="utf-8")
    (app_dir / "sw.js").write_text("self;", encoding="utf-8")
    (app_dir / "manifest.webmanifest").write_text("{}", encoding="utf-8")
    (app_dir / "assets" / "app.css").write_text("a{}", encoding="utf-8")
    (app_dir / "media" / "gp_x" / "frame.jpg").write_bytes(b"\xff\xd8\xff\xe0jpeg")
    (tmp_path / "secret.txt").write_text("no", encoding="utf-8")
    server = make_server(app_dir, "127.0.0.1", 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def fetch(url: str) -> tuple[int, str, str, bytes]:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return (
                response.status,
                response.headers.get_content_type(),
                response.headers.get("Cache-Control", ""),
                response.read(),
            )
    except urllib.error.HTTPError as exc:
        return exc.code, "", "", b""


@pytest.mark.parametrize(
    ("path", "mime"),
    [
        ("/", "text/html"),
        ("/assets/index.js", "text/javascript"),
        ("/trip.json", "application/json"),
        ("/sw.js", "text/javascript"),
        ("/manifest.webmanifest", "application/manifest+json"),
        ("/assets/app.css", "text/css"),
        ("/media/gp_x/frame.jpg", "image/jpeg"),
    ],
)
def test_serves_app_and_media_with_mime_types(served: str, path: str, mime: str) -> None:
    status, content_type, _, body = fetch(served + path)
    assert status == 200
    assert content_type == mime
    assert body


def test_shell_and_worker_are_not_cached(served: str) -> None:
    assert fetch(served + "/sw.js")[2] == "no-cache"
    assert fetch(served + "/index.html")[2] == "no-cache"
    assert fetch(served + "/trip.json")[2] == "no-cache"
    assert fetch(served + "/offline.json")[2] == "no-cache"
    assert fetch(served + "/manifest.webmanifest")[2] == "no-cache"
    assert fetch(served + "/assets/index.js")[2] == ""


def test_cannot_escape_the_app_folder(served: str) -> None:
    assert fetch(served + "/media/%2e%2e/secret.txt")[0] == 404
    assert fetch(served + "/../secret.txt")[0] == 404


def test_handler_factory_binds_the_app_folder(tmp_path: Path) -> None:
    factory = handler_factory(tmp_path / "app")
    assert factory.func is AppRequestHandler  # type: ignore[attr-defined]
    assert factory.keywords == {"directory": str(tmp_path / "app")}  # type: ignore[attr-defined]
    assert AppRequestHandler.extensions_map[".webmanifest"] == "application/manifest+json"


def test_serve_without_export_explains_what_to_run(
    project: Paths, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(ROOT_ENV, str(project.root))
    result = CliRunner().invoke(app, ["serve", "--port", "0"])
    assert result.exit_code == 1
    assert "tiktok-trip export first" in " ".join(result.output.split())
