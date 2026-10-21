"""Preview images per place in output/media: evidence frames from the posts, optional Google photos.

Writes output/media/<place>/frame-<video>-<NNN>.jpg, google-<n>.jpg (+ google-<n>.json with the
attribution) and output/media/index.json {place_id: [MediaItem]} for the map and Excel writers.
Reads data/ only; nothing under data/ is changed apart from the API cache and log.
"""

from __future__ import annotations

import io
import logging
import re
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import TypeAdapter

from tiktok_trip.clients.google_photos import GooglePhotosClient
from tiktok_trip.context import Context
from tiktok_trip.extraction.raw import VideoFiles, known_sources, video_id_from_url
from tiktok_trip.models import Candidate, EvidenceSource, MediaAttribution, MediaItem, Place
from tiktok_trip.quota import QuotaExceededError
from tiktok_trip.storage import load_models, read_json, write_json

log = logging.getLogger(__name__)

LONG_SIDE_PX = 640
JPEG_QUALITY = 80
FRAME_TOKEN = re.compile(r"\b(\d{1,4})\.jpe?g\b", re.IGNORECASE)
MENU_HINT = re.compile(
    r"\d{1,3}(?:[.,]\d{3})+|\b\d+\s?k\b|\bmenu\b|thực đơn|bảng giá", re.IGNORECASE
)
DOWNLOAD_TIMEOUT_S = 30

FrameKey = tuple[str, str | None]
Locate = Callable[[str, str], Path | None]


@dataclass(frozen=True)
class FrameRef:
    video_id: str
    video_url: str
    frame: str
    caption: str
    menu: bool
    path: Path

    @property
    def file_name(self) -> str:
        return f"frame-{self.video_id}-{Path(self.frame).stem}.jpg"


@dataclass
class MediaSummary:
    places: int = 0
    places_with_frames: int = 0
    frames: int = 0
    frames_written: int = 0
    google: str = "off"
    places_with_photos: int = 0
    photos_new: int = 0
    photos_cached: int = 0
    index: dict[str, list[MediaItem]] = field(default_factory=dict, repr=False)


def frame_name(timestamp: str | None) -> str | None:
    """The frame file a frame evidence names ("011.jpg", "slide 011.jpg ..."), zero-padded."""
    match = FRAME_TOKEN.search(timestamp or "")
    return f"{int(match.group(1)):03d}.jpg" if match else None


def is_menu(quote: str) -> bool:
    return MENU_HINT.search(quote) is not None


def place_dir_name(place_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", place_id).strip("_") or "place"


def frame_owners(candidates: Iterable[Candidate]) -> dict[FrameKey, set[str]]:
    """(quote, timestamp) of every frame evidence -> the videos whose candidates cite it."""
    owners: dict[FrameKey, set[str]] = {}
    for candidate in candidates:
        for evidence in candidate.evidence:
            if evidence.source == EvidenceSource.FRAME:
                key = (evidence.quote, evidence.timestamp)
                owners.setdefault(key, set()).add(candidate.video_id)
    return owners


def place_videos(place: Place, sources: dict[str, str]) -> list[tuple[str, str]]:
    """(video id, url) for each post of the place, in the place's order."""
    videos: list[tuple[str, str]] = []
    for url in place.videos:
        video_id = sources.get(url) or video_id_from_url(url)
        if video_id and all(video_id != known for known, _ in videos):
            videos.append((video_id, url))
    return videos


def select_frames(
    place: Place,
    videos: Sequence[tuple[str, str]],
    owners: dict[FrameKey, set[str]],
    locate: Locate,
    limit: int,
) -> list[FrameRef]:
    """Frames cited by the place's frame evidence, menu-looking first, then in evidence order.

    A frame is taken from the video whose candidate cited it; with no such record it is taken only
    when the place has a single video, since every post numbers its frames 001, 002, ...
    """
    picked: list[FrameRef] = []
    seen: set[tuple[str, str]] = set()
    for evidence in place.evidence:
        frame = frame_name(evidence.timestamp) if evidence.source == EvidenceSource.FRAME else None
        if frame is None:
            continue
        cited_by = owners.get((evidence.quote, evidence.timestamp), set())
        sources = [v for v in videos if v[0] in cited_by]
        if not sources and len(videos) == 1:
            sources = list(videos)
        for video_id, url in sources:
            path = locate(video_id, frame)
            if path is None or (video_id, frame) in seen:
                continue
            seen.add((video_id, frame))
            picked.append(
                FrameRef(video_id, url, frame, evidence.quote, is_menu(evidence.quote), path)
            )
            break
    picked.sort(key=lambda ref: not ref.menu)
    return picked[:limit]


def locate_frame(ctx: Context) -> Locate:
    def locate(video_id: str, frame: str) -> Path | None:
        files = VideoFiles.of(ctx.paths, video_id)
        for path in (files.frames / frame, files.images / frame):
            if path.is_file():
                return path
        return None

    return locate


def save_preview(source: Path | bytes, dest: Path) -> None:
    """JPEG with the long side at most LONG_SIDE_PX, EXIF rotation applied."""
    raw = io.BytesIO(source) if isinstance(source, bytes) else source
    with Image.open(raw) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
    image.thumbnail((LONG_SIDE_PX, LONG_SIDE_PX), Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f".{dest.name}.tmp")
    image.save(tmp, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    tmp.replace(dest)


def is_fresh(dest: Path, source: Path) -> bool:
    return dest.exists() and dest.stat().st_mtime >= source.stat().st_mtime


def write_frames(
    ctx: Context, place: Place, refs: Sequence[FrameRef]
) -> tuple[list[MediaItem], int]:
    folder = ctx.paths.media_dir / place_dir_name(place.id)
    items: list[MediaItem] = []
    written = 0
    for ref in refs:
        dest = folder / ref.file_name
        if not is_fresh(dest, ref.path):
            try:
                save_preview(ref.path, dest)
            except (OSError, UnidentifiedImageError) as exc:
                log.warning("%s: cannot read %s: %s", place.id, ref.path, exc)
                continue
            written += 1
        items.append(
            MediaItem(
                src=relative_src(ctx, dest),
                kind="frame",
                caption=ref.caption,
                source_url=ref.video_url,
            )
        )
    return items, written


def relative_src(ctx: Context, path: Path) -> str:
    return path.relative_to(ctx.paths.output).as_posix()


def remove_stale_frames(media_dir: Path, keep: set[Path]) -> None:
    """Frames no longer selected go; Google photos stay (they cost calls). Empty folders go."""
    if not media_dir.is_dir():
        return
    for path in media_dir.glob("*/frame-*.jpg"):
        if path not in keep:
            path.unlink()
    for folder in media_dir.iterdir():
        if folder.is_dir() and not any(folder.iterdir()):
            folder.rmdir()


def photo_caption(attributions: Sequence[MediaAttribution]) -> str:
    names = ", ".join(a.name for a in attributions)
    return f"Google Maps photo by {names}" if names else "Google Maps photo"


def read_sidecar(path: Path) -> MediaItem | None:
    try:
        return MediaItem.model_validate(read_json(path))
    except (OSError, ValueError):
        return None


class GooglePhotoFetcher:
    """Downloads up to `limit` Google photos per `gp:` place, skipping files already on disk."""

    def __init__(
        self, ctx: Context, client: GooglePhotosClient, http: httpx.Client, limit: int
    ) -> None:
        self.ctx = ctx
        self.client = client
        self.http = http
        self.limit = limit
        self.new = 0
        self.cached = 0

    def fetch(self, place: Place) -> list[MediaItem]:
        if not place.id.startswith("gp:") or self.limit <= 0:
            return []
        folder = self.ctx.paths.media_dir / place_dir_name(place.id)
        cached = self._cached(folder)
        if len(cached) == self.limit:
            self.cached += len(cached)
            return cached
        for fresh in (False, True):
            try:
                return self._download(place, folder, use_cache=not fresh)
            except (httpx.HTTPError, OSError, UnidentifiedImageError) as exc:
                if fresh:
                    log.warning("%s: Google photo failed: %s", place.id, exc)
                else:
                    log.info("%s: Google photo failed (%s); asking Google again", place.id, exc)
        return self._cached(folder)

    def _cached(self, folder: Path) -> list[MediaItem]:
        items: list[MediaItem] = []
        for n in range(1, self.limit + 1):
            image, sidecar = folder / f"google-{n}.jpg", folder / f"google-{n}.json"
            if not image.exists() or (item := read_sidecar(sidecar)) is None:
                break
            items.append(item)
        return items

    def _download(self, place: Place, folder: Path, *, use_cache: bool) -> list[MediaItem]:
        items: list[MediaItem] = []
        photos = self.client.photos(place.id.removeprefix("gp:"), use_cache=use_cache)
        for n, photo in enumerate(photos[: self.limit], start=1):
            image, sidecar = folder / f"google-{n}.jpg", folder / f"google-{n}.json"
            if image.exists() and (item := read_sidecar(sidecar)) is not None:
                self.cached += 1
                items.append(item)
                continue
            uri = self.client.photo_uri(photo.name, use_cache=use_cache)
            if uri is None:
                continue
            response = self.http.get(uri)
            response.raise_for_status()
            save_preview(response.content, image)
            item = MediaItem(
                src=relative_src(self.ctx, image),
                kind="photo",
                caption=photo_caption(photo.attributions),
                source_url=photo.google_maps_uri or place.maps_url,
                attributions=photo.attributions,
            )
            write_json(sidecar, item.model_dump(mode="json"))
            self.new += 1
            items.append(item)
        return items


def google_photos(
    ctx: Context, places: Sequence[Place], summary: MediaSummary
) -> dict[str, list[MediaItem]]:
    export = ctx.config.export
    if not export.google_photos:
        return {}
    if not ctx.secrets.google_maps_key:
        summary.google = "no key"
        log.warning("export.google_photos is on but GOOGLE_MAPS_KEY is not set; no Google photos.")
        return {}
    summary.google = "on"
    found: dict[str, list[MediaItem]] = {}
    client = GooglePhotosClient(ctx)
    with httpx.Client(timeout=DOWNLOAD_TIMEOUT_S, follow_redirects=True) as http:
        fetcher = GooglePhotoFetcher(ctx, client, http, export.max_photos_per_place)
        try:
            for place in places:
                if items := fetcher.fetch(place):
                    found[place.id] = items
        except QuotaExceededError:
            summary.google = "quota stop"
            log.warning("Google photos stopped at the quota limit; the rest wait for the reset.")
        finally:
            client.close()
    summary.photos_new, summary.photos_cached = fetcher.new, fetcher.cached
    summary.places_with_photos = len(found)
    return found


def build_media(ctx: Context) -> MediaSummary:
    """Copy evidence frames (and Google photos when on) to output/media and write index.json."""
    paths = ctx.paths
    places = load_models(paths.places_file, Place)
    owners = frame_owners(load_models(paths.candidates_file, Candidate))
    sources = known_sources(paths)
    locate = locate_frame(ctx)
    limit = ctx.config.export.max_frames_per_place
    summary = MediaSummary(places=len(places))
    index: dict[str, list[MediaItem]] = {}
    keep: set[Path] = set()
    for place in places:
        refs = select_frames(place, place_videos(place, sources), owners, locate, limit)
        items, written = write_frames(ctx, place, refs)
        keep.update(paths.output / item.src for item in items)
        summary.frames += len(items)
        summary.frames_written += written
        if items:
            summary.places_with_frames += 1
            index[place.id] = items
    remove_stale_frames(paths.media_dir, keep)
    for place_id, photos in google_photos(ctx, places, summary).items():
        index.setdefault(place_id, []).extend(photos)
    write_json(
        paths.media_index,
        {
            place_id: [item.model_dump(mode="json") for item in items]
            for place_id, items in index.items()
        },
    )
    summary.index = index
    log.info(
        "Media: %d of %d places have frame images (%d frames, %d newly written); "
        "Google photos %s: %d new, %d cached",
        summary.places_with_frames,
        summary.places,
        summary.frames,
        summary.frames_written,
        summary.google,
        summary.photos_new,
        summary.photos_cached,
    )
    return summary


def media_index(ctx: Context) -> dict[str, list[MediaItem]]:
    """output/media/index.json as written by the last build_media; {} before the first one."""
    if not ctx.paths.media_index.exists():
        return {}
    adapter = TypeAdapter(dict[str, list[MediaItem]])
    return adapter.validate_python(read_json(ctx.paths.media_index))
