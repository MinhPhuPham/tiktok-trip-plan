"""Everything the model needs to know about one video, gathered from its raw files."""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from tiktok_trip.config import ExtractConfig
from tiktok_trip.extraction.raw import (
    RawComment,
    Transcript,
    TranscriptSegment,
    VideoFiles,
    caption_of,
    load_comments,
    load_post_page,
    load_transcript,
    read_source,
)
from tiktok_trip.storage import read_json

HASHTAG = re.compile(r"#([^\s#]+)")
LOCATION_KEYS = {
    "location",
    "location_name",
    "address",
    "city",
    "region",
    "place",
    "anchors",
}


class ExtractionBundle(BaseModel):
    video_id: str
    video_url: str
    caption: str = ""
    title: str | None = None
    uploader: str | None = None
    hashtags: list[str] = Field(default_factory=list)
    location: dict[str, str] = Field(default_factory=dict)
    comments: list[RawComment] = Field(default_factory=list)
    transcript: list[TranscriptSegment] = Field(default_factory=list)
    transcript_available: bool = False
    transcript_reason: str | None = None
    frames: list[Path] = Field(default_factory=list)
    photo_post: bool = False
    """A TikTok photo post (slideshow): `frames` are its slides, there is no video."""
    image_count: int | None = None
    post_title: str | None = None

    def transcript_lines(self) -> list[str]:
        return [f"[{format_mmss(s.start)}] {s.text.strip()}" for s in self.transcript if s.text]


def format_mmss(seconds: float) -> str:
    total = int(seconds)
    return f"{total // 60:02d}:{total % 60:02d}"


def extract_hashtags(caption: str, tags: Iterable[str] = ()) -> list[str]:
    seen: dict[str, str] = {}
    for tag in [*HASHTAG.findall(caption), *tags]:
        cleaned = tag.strip().lstrip("#")
        if cleaned and cleaned.lower() not in seen:
            seen[cleaned.lower()] = cleaned
    return list(seen.values())


def extract_location_fields(info: dict[str, Any]) -> dict[str, str]:
    """Collect any POI/location-like fields yt-dlp left in info.json."""
    found: dict[str, str] = {}
    for key, value in info.items():
        lowered = key.lower()
        if lowered not in LOCATION_KEYS and "poi" not in lowered:
            continue
        text = _flatten(value)
        if text:
            found[key] = text
    return found


def _flatten(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, int | float) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, dict):
        parts = (f"{k}: {flat}" for k, v in value.items() if (flat := _flatten(v)))
        return "; ".join(parts)
    if isinstance(value, list):
        return "; ".join(flat for v in value if (flat := _flatten(v)))
    return ""


def rank_comments(comments: Iterable[RawComment], limit: int) -> list[RawComment]:
    """Creator comments and replies first, then the most liked."""
    usable = [c for c in comments if c.text.strip()]
    usable.sort(key=lambda c: (not c.is_creator, -c.like_count))
    return usable[: max(limit, 0)]


def build_bundle(
    video_id: str,
    video_url: str,
    info: dict[str, Any],
    *,
    comments: Iterable[RawComment],
    transcript: Transcript | None,
    frames: list[Path],
    max_comments: int,
) -> ExtractionBundle:
    caption = caption_of(info)
    title = str(info.get("title") or "").strip() or None
    if title and caption.startswith(title.rstrip(". …")):
        title = None
    tags = [t for t in info.get("tags") or [] if isinstance(t, str)]
    return ExtractionBundle(
        video_id=video_id,
        video_url=video_url,
        caption=caption,
        title=title,
        uploader=info.get("uploader") or info.get("channel"),
        hashtags=extract_hashtags(caption, tags),
        location=extract_location_fields(info),
        comments=rank_comments(comments, max_comments),
        transcript=transcript.segments if transcript else [],
        transcript_available=bool(transcript and transcript.available),
        transcript_reason=transcript.reason if transcript else None,
        frames=sorted(frames),
    )


def video_url_for(files: VideoFiles, info: dict[str, Any]) -> str:
    if (source := read_source(files)) is not None:
        return source.url
    return str(info.get("webpage_url") or info.get("original_url") or "")


def load_bundle(files: VideoFiles, config: ExtractConfig) -> ExtractionBundle:
    """Works without video.mp4: a photo post's frames are its slides (absent until media ran)."""
    info: dict[str, Any] = read_json(files.info)
    bundle = build_bundle(
        files.video_id,
        video_url_for(files, info),
        info,
        comments=load_comments(files),
        transcript=load_transcript(files),
        frames=files.frame_paths(),
        max_comments=config.max_comments,
    )
    source = read_source(files)
    if source is None or source.has_video:
        return bundle
    page = load_post_page(files)
    location = dict(bundle.location)
    if page and page.poi:
        location["tiktok_poi"] = _flatten(page.poi)
    return bundle.model_copy(
        update={
            "photo_post": True,
            "image_count": source.image_count or len(files.image_paths()) or None,
            "post_title": page.title if page else None,
            "location": location,
        }
    )
