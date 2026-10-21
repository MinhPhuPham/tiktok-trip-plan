"""Download photo-post slides from TikTok's image CDN into raw/<id>/images/.

These are plain GETs of signed, short-lived file URLs, like yt-dlp's video downloads: nothing to
cache and nothing billed, so they bypass CachedClient and the api log.
"""

from __future__ import annotations

import io
import logging
from collections.abc import Sequence
from pathlib import Path

import httpx
from PIL import Image, UnidentifiedImageError

log = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)
TIMEOUT_S = 30.0
JPEG_MAGIC = b"\xff\xd8\xff"
JPEG_QUALITY = 95


class NotAnImageError(ValueError):
    pass


def as_jpeg(content: bytes) -> bytes:
    """JPEG bytes unchanged; any other format Pillow reads (webp, png) re-encoded as JPEG."""
    if content.startswith(JPEG_MAGIC):
        return content
    try:
        with Image.open(io.BytesIO(content)) as image:
            buffer = io.BytesIO()
            image.convert("RGB").save(buffer, format="JPEG", quality=JPEG_QUALITY)
    except (UnidentifiedImageError, OSError) as exc:
        raise NotAnImageError(f"not an image ({len(content)} bytes)") from exc
    return buffer.getvalue()


def download_images(
    slides: Sequence[Sequence[str]],
    destinations: Sequence[Path],
    *,
    referer: str,
    client: httpx.Client | None = None,
) -> int:
    """Save slide i to destinations[i], trying each of its URLs in turn; existing files are kept.

    Returns how many destinations exist afterwards. A slide whose URLs all fail is logged.
    """
    headers = {"User-Agent": USER_AGENT, "Referer": referer, "Accept": "image/*,*/*;q=0.8"}
    owned = client is None
    http = client or httpx.Client(timeout=TIMEOUT_S, follow_redirects=True)
    present = 0
    try:
        for index, (urls, target) in enumerate(zip(slides, destinations, strict=True), start=1):
            if target.exists() or _download_one(http, urls, target, headers):
                present += 1
            else:
                log.warning("Slide %d: every URL failed, %s not saved", index, target.name)
    finally:
        if owned:
            http.close()
    return present


def _download_one(
    http: httpx.Client, urls: Sequence[str], target: Path, headers: dict[str, str]
) -> bool:
    for url in urls:
        try:
            response = http.get(url, headers=headers)
            response.raise_for_status()
            content = as_jpeg(response.content)
        except (httpx.HTTPError, NotAnImageError) as exc:
            log.debug("Slide download failed from %s: %s", url.split("?")[0], exc)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(".part")
        partial.write_bytes(content)
        partial.replace(target)
        log.debug("Saved %s (%d bytes)", target, len(content))
        return True
    return False
