"""`tiktok-trip serve`: output/app over HTTP (stdlib), media included."""

from __future__ import annotations

import socket
from collections.abc import Callable
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, ClassVar
from urllib.parse import urlsplit

NO_CACHE = frozenset(
    {"/", "/index.html", "/sw.js", "/manifest.webmanifest", "/trip.json", "/offline.json"}
)
EXTRA_TYPES: dict[str, str] = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".html": "text/html",
}


class AppRequestHandler(SimpleHTTPRequestHandler):
    """Static files from `directory` with the extra MIME types and cache headers."""

    extensions_map: ClassVar[dict[str, str]] = {  # type: ignore[misc]
        **SimpleHTTPRequestHandler.extensions_map,
        **EXTRA_TYPES,
    }

    def end_headers(self) -> None:
        route = urlsplit(self.path).path
        if route in NO_CACHE:
            self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        return


def handler_factory(app_dir: Path) -> Callable[..., AppRequestHandler]:
    """A request handler class serving output/app."""
    return partial(AppRequestHandler, directory=str(app_dir))


def make_server(app_dir: Path, host: str, port: int) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), handler_factory(app_dir))


def lan_address() -> str | None:
    """This machine's address on the local network (no packet is sent), or None."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(("10.255.255.255", 1))
            address = str(probe.getsockname()[0])
        except OSError:
            return None
    return None if address.startswith("127.") else address
