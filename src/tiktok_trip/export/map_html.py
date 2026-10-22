"""map.html and output/app/, written from the React build in `export/web_dist/` (docs/WEB.md)."""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
from html import escape
from pathlib import Path
from urllib.parse import urlencode

from tiktok_trip.context import Context
from tiktok_trip.errors import UserFacingError
from tiktok_trip.export.dataset import ExportData
from tiktok_trip.export.map_data import (
    GOOGLE_MAPS_JS,
    MapData,
    MapExtras,
    build_map_data,
)
from tiktok_trip.export.og_image import render_og_image
from tiktok_trip.export.site import (
    OG_IMAGE,
    ROBOTS_TXT,
    SITE_NAME,
    TripFacts,
    head_tags,
    manifest_name,
    page_url,
)
from tiktok_trip.export.splash import write_splash_screens

logger = logging.getLogger(__name__)

TITLE_MARKER = "__TRIP_TITLE__"
DATA_MARKER = "__TRIP_DATA__"
SEO_MARKER = "<!--__SEO_HEAD__-->"
NAME_MARKER = '"__TRIP_NAME__"'
SHORT_NAME_MARKER = '"__TRIP_SHORT_NAME__"'
DESCRIPTION_MARKER = '"__TRIP_DESCRIPTION__"'
GOOGLE_CALLBACK = "tripGoogleReady"
BUILD_HINT = "npm --prefix web ci && npm --prefix web run build"
DEPLOY_LINKS: frozenset[str] = frozenset({".vercel", ".netlify"})
"""Host CLIs store their project link inside the deployed folder; keep it across exports."""
VERSION_LENGTH = 16
IMAGE_VERSION_LENGTH = 8
APP_ICON = "icon-512.png"


def web_dist() -> Path:
    """The folder `npm --prefix web run build` writes into (a seam for tests)."""
    return Path(__file__).parent / "web_dist"


def google_map_key(ctx: Context) -> str | None:
    """The browser key when `export.google_map` is on; never the server key."""
    if not ctx.config.export.google_map:
        return None
    key = ctx.secrets.google_maps_browser_key
    if not key:
        logger.warning(
            "export.google_map is on but GOOGLE_MAPS_BROWSER_KEY is empty: no Google basemap "
            "(the server key GOOGLE_MAPS_KEY is never embedded)."
        )
        return None
    return key


def google_loader_url(key: str) -> str:
    query = urlencode({"key": key, "v": "weekly", "loading": "async", "callback": GOOGLE_CALLBACK})
    return f"{GOOGLE_MAPS_JS}?{query}"


def script_json(map_data: MapData) -> str:
    """JSON safe inside <script type="application/json">: no '</' can close the element."""
    text = map_data.model_dump_json(by_alias=True)
    return text.replace("</", "<\\/").replace("<!--", "<\\!--")


def warn_key(path: Path, google_key: str | None) -> None:
    if google_key:
        logger.warning(
            "%s embeds your Google Maps browser key (export.google_map: true); make sure it is "
            "referrer-restricted before deploying.",
            path,
        )


def dist_text(relative: str, markers: tuple[str, ...]) -> str:
    """A web_dist file that must exist and hold each marker exactly once."""
    path = web_dist() / relative
    if not path.is_file():
        raise UserFacingError(f"{path} is missing. Build the web app first: {BUILD_HINT}")
    text = path.read_text(encoding="utf-8")
    for marker in markers:
        if text.count(marker) != 1:
            raise UserFacingError(
                f"{path} needs exactly one {marker} (found {text.count(marker)}). "
                f"Rebuild the web app: {BUILD_HINT}"
            )
    return text


def trip_facts(map_data: MapData) -> TripFacts:
    return TripFacts(city=map_data.city, days=len(map_data.days), places=len(map_data.places))


def fill_head(page: str, head: str) -> str:
    return page.replace(TITLE_MARKER, escape(SITE_NAME)).replace(SEO_MARKER, head)


def render_map(map_data: MapData) -> str:
    """web_dist/single/index.html with the trip data, title and description filled in."""
    page = dist_text("single/index.html", (DATA_MARKER, TITLE_MARKER, SEO_MARKER))
    head = head_tags(trip_facts(map_data))
    return fill_head(page, head).replace(DATA_MARKER, script_json(map_data))


def image_url(site_url: str, image: bytes) -> str:
    """og:image with a content version, so preview caches refetch it when the card changes."""
    version = hashlib.sha256(image).hexdigest()[:IMAGE_VERSION_LENGTH]
    relative = f"{OG_IMAGE}?v={version}"
    if site_url:
        return page_url(site_url) + relative
    logger.warning(
        "export.site_url is empty: the app's link previews get no og:url or canonical link and "
        "a relative og:image, which Facebook, Zalo and X ignore. Set it to the deployed address."
    )
    return relative


def render_app_index(facts: TripFacts, site_url: str, image: bytes, splash: str = "") -> str:
    """web_dist/app/index.html with the title, the SEO block and the iPhone launch screens; the
    trip data stays a fetch."""
    page = dist_text("app/index.html", (TITLE_MARKER, SEO_MARKER))
    head = head_tags(facts, site_url, image_url(site_url, image))
    return fill_head(page, f"{head}\n{splash}" if splash else head)


def write_map(
    data: ExportData,
    path: Path,
    google_key: str | None = None,
    extras: MapExtras | None = None,
) -> Path:
    """Write map.html; with `google_key` the file embeds the key for the Google basemap."""
    map_data = build_map_data(data, google_loader_url(google_key) if google_key else None, extras)
    page = render_map(map_data)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(page, encoding="utf-8")
    logger.info("Wrote %s", path)
    warn_key(path, google_key)
    return path


def manifest_json(facts: TripFacts) -> str:
    text = dist_text(
        "app/manifest.webmanifest", (NAME_MARKER, SHORT_NAME_MARKER, DESCRIPTION_MARKER)
    )
    values = {
        NAME_MARKER: manifest_name(facts.city),
        SHORT_NAME_MARKER: SITE_NAME,
        DESCRIPTION_MARKER: facts.description,
    }
    for marker, value in values.items():
        text = text.replace(marker, json.dumps(value, ensure_ascii=False))
    return text


def media_urls(map_data: MapData) -> list[str]:
    """Every media URL the app requests, sorted and unique."""
    return sorted({item.src for items in map_data.media.values() for item in items})


def offline_json(trip: bytes, media: list[str]) -> str:
    digest = hashlib.sha256(trip)
    digest.update(b"\0" + "\n".join(media).encode("utf-8"))
    version = digest.hexdigest()[:VERSION_LENGTH]
    return json.dumps({"version": version, "urls": ["trip.json", *media]}, ensure_ascii=False)


def clear_app_dir(app_dir: Path) -> None:
    """Empty output/app except the deploy links, so a re-export publishes to the same project."""
    if not app_dir.exists():
        return
    for child in app_dir.iterdir():
        if child.name in DEPLOY_LINKS:
            continue
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()


def write_app(
    data: ExportData,
    app_dir: Path,
    media_dir: Path,
    *,
    google_key: str | None = None,
    extras: MapExtras | None = None,
    site_url: str = "",
) -> Path:
    """Write output/app/: web_dist/app with its head filled + trip.json, manifest, media/,
    offline.json, the preview image, the iPhone launch screens and robots.txt."""
    map_data = build_map_data(data, google_loader_url(google_key) if google_key else None, extras)
    dist = web_dist() / "app"
    facts = trip_facts(map_data)
    manifest = manifest_json(facts)
    image = render_og_image(SITE_NAME, facts.city, facts.stats, dist / APP_ICON)
    clear_app_dir(app_dir)
    shutil.copytree(dist, app_dir, dirs_exist_ok=True)
    splash = write_splash_screens(app_dir, dist / APP_ICON)
    index = render_app_index(facts, site_url, image, splash)
    (app_dir / "index.html").write_text(index, encoding="utf-8")
    trip = map_data.model_dump_json(by_alias=True).encode("utf-8")
    (app_dir / "trip.json").write_bytes(trip)
    (app_dir / "manifest.webmanifest").write_text(manifest, encoding="utf-8")
    (app_dir / OG_IMAGE).write_bytes(image)
    (app_dir / "robots.txt").write_text(ROBOTS_TXT, encoding="utf-8")
    if media_dir.is_dir():
        shutil.copytree(media_dir, app_dir / "media")
    (app_dir / "offline.json").write_text(
        offline_json(trip, media_urls(map_data)), encoding="utf-8"
    )
    logger.info("Wrote %s (serve it with: uv run tiktok-trip serve)", app_dir)
    warn_key(app_dir / "trip.json", google_key)
    return app_dir
