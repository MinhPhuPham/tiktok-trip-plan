"""Layout and models of the per-video files that fetch and media write under raw/<video_id>/."""

from __future__ import annotations

import logging
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, TypeAdapter

from tiktok_trip.paths import Paths
from tiktok_trip.storage import read_json

log = logging.getLogger(__name__)

TIKTOK_VIDEO_ID = re.compile(r"tiktok\.com/(?:@[\w.-]+/)?(?:video|photo)/(\d+)")
PHOTO_PATH = re.compile(r"(tiktok\.com/(?:@[\w.-]+/)?)photo/(\d+)")
AUDIO_EXTENSIONS = (".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wav")


@dataclass(frozen=True)
class VideoFiles:
    root: Path

    @classmethod
    def of(cls, paths: Paths, video_id: str) -> VideoFiles:
        return cls(paths.raw_video(video_id))

    @property
    def video_id(self) -> str:
        return self.root.name

    @property
    def video(self) -> Path:
        return self.root / "video.mp4"

    @property
    def info(self) -> Path:
        return self.root / "info.json"

    @property
    def comments(self) -> Path:
        return self.root / "comments.json"

    @property
    def source(self) -> Path:
        return self.root / "source.json"

    @property
    def frames(self) -> Path:
        return self.root / "frames"

    @property
    def transcript(self) -> Path:
        return self.root / "transcript.json"

    @property
    def caption_cache(self) -> Path:
        return self.root / "caption.txt"

    @property
    def images(self) -> Path:
        """The slides of a photo post, 001.jpg, 002.jpg, ... in post order."""
        return self.root / "images"

    @property
    def post(self) -> Path:
        """Photo-post fields only the web page has (slide title, POI tag)."""
        return self.root / "post.json"

    def image_path(self, index: int) -> Path:
        return self.images / f"{index:03d}.jpg"

    def frame_paths(self) -> list[Path]:
        if not self.frames.is_dir():
            return []
        return sorted(self.frames.glob("*.jpg"))

    def image_paths(self) -> list[Path]:
        if not self.images.is_dir():
            return []
        return sorted(self.images.glob("*.jpg"))

    def audio_file(self) -> Path | None:
        """The audio track yt-dlp saved for a photo post (audio.mp3, audio.m4a, ...), if any."""
        for suffix in AUDIO_EXTENSIONS:
            path = self.root / f"audio{suffix}"
            if path.exists():
                return path
        return None


COUNT_SUFFIX = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}


class VideoSource(BaseModel):
    url: str
    video_id: str
    comments_source: Literal["yt-dlp", "playwright", "none"] | None = None
    has_video: bool = True
    """False for TikTok photo posts: images/ instead of video.mp4."""
    image_count: int | None = None
    """Photo posts: how many slides the post has (images/ may hold fewer after a failure)."""
    images_source: Literal["yt-dlp", "playwright"] | None = None


class RawComment(BaseModel):
    author: str = ""
    text: str
    is_creator: bool = False
    like_count: int = 0
    parent: str | None = None
    timestamp: int | None = None


class TranscriptSegment(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str


class Transcript(BaseModel):
    segments: list[TranscriptSegment] = Field(default_factory=list)
    available: bool = True
    model: str | None = None
    language: str | None = None
    reason: str | None = None
    """Why there is no transcript when that is final (e.g. a photo post without audio)."""


class PostPage(BaseModel):
    """Photo-post fields read from the TikTok web page that yt-dlp does not return."""

    title: str | None = None
    poi: dict[str, str] = Field(default_factory=dict)


def list_videos(paths: Paths) -> list[VideoFiles]:
    if not paths.raw.is_dir():
        return []
    return [VideoFiles(d) for d in sorted(paths.raw.iterdir()) if d.is_dir()]


def spread_evenly[T](items: Sequence[T], limit: int) -> list[T]:
    """Pick at most `limit` items spaced evenly across the sequence, keeping first and last."""
    if limit <= 0:
        return []
    if len(items) <= limit:
        return list(items)
    if limit == 1:
        return [items[0]]
    step = (len(items) - 1) / (limit - 1)
    return [items[round(i * step)] for i in range(limit)]


def parse_count(value: Any) -> int:
    """Like counts arrive as ints, None, or strings like "1.2K"."""
    if isinstance(value, bool) or value is None:
        return 0
    if isinstance(value, int | float):
        return max(int(value), 0)
    text = str(value).strip().lower().replace(",", "")
    multiplier = COUNT_SUFFIX.get(text[-1:], 1)
    if multiplier != 1:
        text = text[:-1]
    try:
        return max(int(float(text) * multiplier), 0)
    except ValueError:
        return 0


def int_or_none(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def video_id_from_url(url: str) -> str | None:
    match = TIKTOK_VIDEO_ID.search(url)
    return match.group(1) if match else None


def video_page_url(url: str) -> str:
    """The /video/<id> form of a /photo/<id> link, which yt-dlp accepts and TikTok renders with
    the post data in the page (the /photo/ page loads it later from an API)."""
    return PHOTO_PATH.sub(r"\1video/\2", url)


def read_source(files: VideoFiles) -> VideoSource | None:
    try:
        return VideoSource.model_validate(read_json(files.source))
    except (OSError, ValueError) as exc:
        if files.source.exists():
            log.warning("%s: unreadable %s: %s", files.video_id, files.source.name, exc)
        return None


def known_sources(paths: Paths) -> dict[str, str]:
    """url -> video id for every video already fetched, so known links need no network at all."""
    return {
        source.url: source.video_id
        for files in list_videos(paths)
        if (source := read_source(files)) is not None
    }


def caption_of(info: Mapping[str, Any]) -> str:
    return str(info.get("description") or info.get("title") or "").strip()


def read_caption(files: VideoFiles) -> str:
    """Caption, cached in caption.txt: info.json can be several MB because it holds comments."""
    cache, info_path = files.caption_cache, files.info
    if not info_path.exists():
        return ""
    if cache.exists() and cache.stat().st_mtime >= info_path.stat().st_mtime:
        return cache.read_text(encoding="utf-8")
    try:
        info = read_json(info_path)
    except (OSError, ValueError) as exc:
        log.warning("%s: unreadable %s: %s", files.video_id, info_path.name, exc)
        return ""
    caption = caption_of(info) if isinstance(info, Mapping) else ""
    cache.write_text(caption, encoding="utf-8")
    return caption


def load_comments(files: VideoFiles) -> list[RawComment]:
    """Saved comments, or [] when the file is missing or unreadable."""
    if not files.comments.exists():
        return []
    try:
        return TypeAdapter(list[RawComment]).validate_python(read_json(files.comments))
    except (OSError, ValueError) as exc:
        log.warning("%s: unreadable %s: %s", files.video_id, files.comments.name, exc)
        return []


def load_post_page(files: VideoFiles) -> PostPage | None:
    if not files.post.exists():
        return None
    try:
        return PostPage.model_validate(read_json(files.post))
    except (OSError, ValueError) as exc:
        log.warning("%s: unreadable %s: %s", files.video_id, files.post.name, exc)
        return None


def load_transcript(files: VideoFiles) -> Transcript | None:
    """The transcript, or None when the file is missing or unreadable."""
    if not files.transcript.exists():
        return None
    try:
        return Transcript.model_validate(read_json(files.transcript))
    except (OSError, ValueError) as exc:
        log.warning("%s: unreadable %s: %s", files.video_id, files.transcript.name, exc)
        return None
