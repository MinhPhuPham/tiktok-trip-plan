"""Step 1: download each TikTok link with yt-dlp into raw/<video_id>/.

Photo posts (slideshows) have no video: their slides go to raw/<id>/images/, from yt-dlp when it
lists them, else from the web page (Playwright). Their sound is downloaded only when it is the
creator's own recording; a sound from another account is background music.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

from pydantic import BaseModel
from yt_dlp import YoutubeDL

from tiktok_trip.clients import tiktok_comments, tiktok_images
from tiktok_trip.clients.tiktok_comments import PostScrape
from tiktok_trip.config import FetchConfig
from tiktok_trip.context import Context
from tiktok_trip.extraction.raw import (
    RawComment,
    VideoFiles,
    VideoSource,
    int_or_none,
    known_sources,
    parse_count,
    read_source,
    video_id_from_url,
    video_page_url,
)
from tiktok_trip.paths import Paths
from tiktok_trip.storage import load_models, read_json, save_model, save_models, write_json

log = logging.getLogger(__name__)
ytdlp_log = logging.getLogger("yt_dlp")

ATTEMPTS = 2
PHOTO_POST = re.compile(r"tiktok\.com/(?:@[\w.-]+/)?photo/\d+")
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv", ".m4v"}
IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "heic"}


class FetchError(RuntimeError):
    pass


class FetchFailure(BaseModel):
    url: str
    error: str


def run(ctx: Context) -> None:
    urls = read_links(ctx.paths.links_file)
    if not urls:
        log.warning("No links in %s", ctx.paths.links_file)
    known = known_sources(ctx.paths)
    failures: list[FetchFailure] = []
    fetched = skipped = 0
    for url in urls:
        try:
            video_id, downloaded = fetch_with_retry(url, ctx.paths, known)
        except Exception as exc:
            failures.append(FetchFailure(url=url, error=f"{type(exc).__name__}: {exc}"))
            log.error("Giving up on %s: %s", url, exc)
            continue
        known[url] = video_id
        ensure_page_data(VideoFiles.of(ctx.paths, video_id), ctx.config.fetch)
        fetched += downloaded
        skipped += not downloaded
    save_models(ctx.paths.fetch_failures, failures)
    log.info(
        "fetch: %d downloaded, %d already present, %d failed (see %s)",
        fetched,
        skipped,
        len(failures),
        ctx.paths.fetch_failures,
    )


def add_links(ctx: Context, urls: list[str]) -> None:
    path = ctx.paths.links_file
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    updated = merge_links(existing, urls)
    if updated != existing:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(updated, encoding="utf-8")
    added = len(parse_links(updated)) - len(parse_links(existing))
    log.info("Added %d new link(s) to %s", added, path)


def parse_links(text: str) -> list[str]:
    seen: dict[str, None] = {}
    for line in text.splitlines():
        url = line.strip()
        if url and not url.startswith("#"):
            seen.setdefault(url, None)
    return list(seen)


def read_links(path: Path) -> list[str]:
    return parse_links(path.read_text(encoding="utf-8")) if path.exists() else []


def merge_links(text: str, urls: Iterable[str]) -> str:
    """Append unseen URLs, keep existing lines and comments, end with exactly one newline."""
    present = set(parse_links(text))
    new: list[str] = []
    for raw in urls:
        url = raw.strip()
        if url and not url.startswith("#") and url not in present:
            present.add(url)
            new.append(url)
    lines = [line.rstrip() for line in text.splitlines()]
    while lines and not lines[-1]:
        lines.pop()
    lines.extend(new)
    return "\n".join(lines) + "\n" if lines else ""


def is_complete(files: VideoFiles) -> bool:
    """info.json plus video.mp4; a photo post (source.json has_video false) has no video."""
    if not files.info.exists():
        return False
    if files.video.exists():
        return True
    source = read_source(files)
    return source is not None and not source.has_video


def is_photo_post(url: str, info: Mapping[str, Any] | None = None) -> bool:
    """TikTok photo (slideshow) posts: a /photo/ link, or formats without any video stream.

    yt-dlp rejects /photo/ links ("Unsupported URL"), so it is always given `video_page_url`.
    """
    info = info or {}
    urls = [url, *(str(info.get(key) or "") for key in ("webpage_url", "original_url"))]
    if any(PHOTO_POST.search(u) for u in urls):
        return True
    formats = info.get("formats") or []
    return bool(formats) and all((f.get("vcodec") or "none") == "none" for f in formats)


def fetch_with_retry(url: str, paths: Paths, known: Mapping[str, str]) -> tuple[str, bool]:
    for attempt in range(1, ATTEMPTS + 1):
        try:
            return fetch_one(url, paths, known)
        except Exception as exc:
            if attempt == ATTEMPTS:
                raise
            log.warning("Fetch failed for %s (%s), retrying once", url, exc)
    raise AssertionError("unreachable")


def fetch_one(url: str, paths: Paths, known: Mapping[str, str]) -> tuple[str, bool]:
    """Returns (video_id, downloaded). Downloads only when info.json or video.mp4 is missing."""
    video_id = known.get(url) or video_id_from_url(url) or probe_video_id(url)
    files = VideoFiles.of(paths, video_id)
    downloaded = False
    has_video: bool | None = None
    if is_complete(files):
        log.debug("%s already fetched, skipped", video_id)
    else:
        log.info("Downloading %s -> %s", url, files.root)
        has_video = download(url, files)
        downloaded = True
    finalize(files, url, has_video=has_video)
    return video_id, downloaded


def probe_video_id(url: str) -> str:
    with YoutubeDL(probe_options()) as ydl:
        info = ydl.extract_info(video_page_url(url), download=False)
    video_id = (info or {}).get("id")
    if not video_id:
        raise FetchError(f"yt-dlp returned no video id for {url}")
    return str(video_id)


def probe_options() -> dict[str, Any]:
    return {"quiet": True, "no_warnings": True, "skip_download": True, "logger": ytdlp_log}


def download_options(files: VideoFiles, *, media: bool = True) -> dict[str, Any]:
    """`media=False` writes only info.json with comments (photo posts have no video to fetch).

    A photo post with no sound has no formats at all, which yt-dlp rejects unless told to ignore.
    """
    return {
        "skip_download": not media,
        "ignore_no_formats_error": not media,
        "outtmpl": {"default": str(files.root / "video.%(ext)s")},
        "format": "best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best",
        "merge_output_format": "mp4",
        "writeinfojson": True,
        "getcomments": True,
        "writecomments": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": ytdlp_log,
    }


def audio_options(files: VideoFiles) -> dict[str, Any]:
    return {
        "format": "bestaudio/best",
        "outtmpl": {"default": str(files.root / "audio.%(ext)s")},
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": ytdlp_log,
    }


def download(url: str, files: VideoFiles) -> bool:
    """Fetch info.json (with comments) and the video; False when the post has no video."""
    files.root.mkdir(parents=True, exist_ok=True)
    with YoutubeDL(download_options(files, media=not is_photo_post(url))) as ydl:
        info = ydl.extract_info(video_page_url(url), download=True)
        if not info:
            raise FetchError(f"yt-dlp returned nothing for {url}")
        sanitized = ydl.sanitize_info(info)
    has_video = _settle_video_file(files, required=not is_photo_post(url, sanitized))
    written = files.root / "video.info.json"
    if written.exists():
        written.replace(files.info)
    else:
        write_json(files.info, sanitized)
    if not has_video:
        log.info("%s is a photo post: no video, slides are fetched separately", files.video_id)
        fetch_photo_audio(url, files, sanitized)
    return has_video


def own_sound(info: Mapping[str, Any]) -> bool:
    """The post's sound is credited to its creator, so it may hold a voice-over."""
    artists = [info.get("artist"), *(info.get("artists") or [])]
    credited = {str(a).casefold() for a in artists if a}
    return bool(credited & {c.casefold() for c in creator_ids(info)})


def fetch_photo_audio(url: str, files: VideoFiles, info: Mapping[str, Any]) -> None:
    """Download a photo post's sound when it is the creator's own; never raises."""
    sound = info.get("track") or "unknown sound"
    if not own_sound(info):
        log.info(
            "%s: sound %r is by %s, not the creator: background music, no audio downloaded",
            files.video_id,
            sound,
            info.get("artist") or "another account",
        )
        return
    try:
        with YoutubeDL(audio_options(files)) as ydl:
            ydl.extract_info(video_page_url(url), download=True)
    except Exception as exc:
        log.warning("%s: audio download failed: %s", files.video_id, exc)
        return
    log.info("%s: saved the creator's own sound %r for transcription", files.video_id, sound)


def _settle_video_file(files: VideoFiles, *, required: bool = True) -> bool:
    if files.video.exists():
        return True
    others = [p for p in files.root.glob("video.*") if p.suffix.lower() in VIDEO_EXTENSIONS]
    if not others:
        if required:
            raise FetchError(f"yt-dlp finished but no video file is in {files.root}")
        return False
    log.warning(
        "%s: got %s, renaming to video.mp4 (ffmpeg reads by content)", files.root, others[0].name
    )
    others[0].replace(files.video)
    return True


def finalize(files: VideoFiles, url: str, *, has_video: bool | None = None) -> None:
    """Write source.json and comments.json from info.json when missing. No network.

    `has_video` comes from a fresh download; otherwise the video file on disk decides.
    """
    source = read_source(files)
    if source is None:
        found = files.video.exists() if has_video is None else has_video
        save_model(files.source, VideoSource(url=url, video_id=files.video_id, has_video=found))
    elif has_video is not None and has_video != source.has_video:
        save_model(files.source, source.model_copy(update={"has_video": has_video}))
    if not files.comments.exists() and files.info.exists():
        info = read_json(files.info)
        save_models(files.comments, normalize_comments(info.get("comments") or [], info))


def images_missing(files: VideoFiles, source: VideoSource) -> bool:
    """A photo post whose slide count is unknown, or with fewer slides on disk than it has."""
    if source.has_video:
        return False
    return source.image_count is None or len(files.image_paths()) < source.image_count


def image_urls_from_info(info: Mapping[str, Any]) -> list[list[str]]:
    """Slide URLs, if yt-dlp lists them as image entries or image formats.

    yt-dlp 2026.08 gives a TikTok photo post only an mp3 format and the cover as thumbnail, so this
    is usually empty and the slides come from the web page.
    """
    slides: list[list[str]] = []
    for entry in info.get("entries") or []:
        if isinstance(entry, Mapping) and (urls := _image_format_urls(entry)):
            slides.append(urls[:1])
    if not slides:
        slides = [[url] for url in _image_format_urls(info)]
    return slides


def _image_format_urls(info: Mapping[str, Any]) -> list[str]:
    candidates = [info, *(f for f in info.get("formats") or [] if isinstance(f, Mapping))]
    return [
        str(c["url"])
        for c in candidates
        if c.get("url")
        and str(c.get("ext") or "").lower() in IMAGE_EXTENSIONS
        and (c.get("acodec") or "none") == "none"
    ]


def ensure_page_data(files: VideoFiles, config: FetchConfig) -> None:
    """Fill in what yt-dlp left out: comments (when TikTok shows some) and photo-post slides.

    One browser visit serves both. Records comments_source, image_count and images_source in
    source.json. Scraper and download errors are logged, never raised.
    """
    source = read_source(files)
    if source is None or not files.info.exists():
        return
    info = read_json(files.info)
    comments = load_models(files.comments, RawComment)
    origin = source.comments_source or ("yt-dlp" if comments else "none")
    expected = parse_count(info.get("comment_count"))
    want_comments = not comments and expected > 0 and config.comments == "playwright"
    updates: dict[str, Any] = {}
    if images_missing(files, source) and (slides := image_urls_from_info(info)):
        updates |= save_slides(files, source.url, slides, "yt-dlp")
    want_images = images_missing(files, source.model_copy(update=updates))
    if want_comments or want_images:
        scrape = scrape_page(
            files, source.url, info, config, comments=want_comments, images=want_images
        )
        if want_comments:
            if scrape and scrape.comments:
                save_models(files.comments, scrape.comments)
                origin = "playwright"
                log.info(
                    "%s: saved %d comments from the web page", files.video_id, len(scrape.comments)
                )
            else:
                log.warning("%s: no comments scraped, comments.json stays empty", files.video_id)
        if want_images and scrape and scrape.images:
            updates |= save_slides(files, source.url, scrape.images, "playwright")
            if scrape.page is not None:
                save_model(files.post, scrape.page)
        elif want_images:
            log.warning("%s: no slide images found; fetch will try again", files.video_id)
    if origin != source.comments_source:
        updates["comments_source"] = origin
    if updates:
        save_model(files.source, source.model_copy(update=updates))


def scrape_page(
    files: VideoFiles,
    url: str,
    info: Mapping[str, Any],
    config: FetchConfig,
    *,
    comments: bool,
    images: bool,
) -> PostScrape | None:
    wanted = " and ".join(w for w, on in (("comments", comments), ("slides", images)) if on)
    if comments:
        log.info(
            "%s: yt-dlp saved no comments (TikTok shows %d), opening a browser",
            files.video_id,
            parse_count(info.get("comment_count")),
        )
    else:
        log.info("%s: opening a browser for the %s", files.video_id, wanted)
    try:
        return tiktok_comments.scrape_post(
            url,
            comments=comments,
            images=images,
            max_comments=config.max_comments,
            headless=config.headless,
            timeout_s=config.browser_timeout_s,
            creator_ids=creator_ids(info),
            video_id=files.video_id,
        )
    except Exception as exc:
        log.warning("%s: page scrape for %s failed: %s", files.video_id, wanted, exc)
        return None


def save_slides(
    files: VideoFiles, url: str, slides: list[list[str]], origin: str
) -> dict[str, Any]:
    """Download missing slides as images/001.jpg, ...; returns the source.json fields to set."""
    targets = [files.image_path(i) for i in range(1, len(slides) + 1)]
    present = tiktok_images.download_images(slides, targets, referer=url)
    log.info(
        "%s: %d of %d slide image(s) in %s (URLs from %s)",
        files.video_id,
        present,
        len(slides),
        files.images,
        origin,
    )
    return {"image_count": len(slides), "images_source": origin}


def creator_ids(info: Mapping[str, Any]) -> set[str]:
    return {
        str(info[key])
        for key in ("uploader", "uploader_id", "channel_id", "channel")
        if info.get(key)
    }


def normalize_comments(
    raw_comments: Iterable[Mapping[str, Any]], info: Mapping[str, Any]
) -> list[RawComment]:
    """Map yt-dlp's comment dicts (whatever extractor shape) to RawComment."""
    creators = creator_ids(info)
    comments: list[RawComment] = []
    for raw in raw_comments:
        if not isinstance(raw, Mapping):
            continue
        text = str(raw.get("text") or raw.get("comment") or raw.get("html") or "").strip()
        if not text:
            continue
        author = str(raw.get("author") or raw.get("author_id") or "")
        author_ids = {str(raw[k]) for k in ("author", "author_id") if raw.get(k)}
        parent = raw.get("parent")
        comments.append(
            RawComment(
                author=author,
                text=text,
                is_creator=bool(raw.get("author_is_uploader")) or bool(author_ids & creators),
                like_count=parse_count(raw.get("like_count")),
                parent=None if parent in (None, "", "root") else str(parent),
                timestamp=int_or_none(raw.get("timestamp")),
            )
        )
    return comments
