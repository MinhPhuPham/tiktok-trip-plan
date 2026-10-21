"""Step 3: turn each video's caption, comments, transcript and frames into place candidates.

Extraction runs in Claude Code: this step writes data/extract/<id>/prompt.md for every video
without candidates, Claude Code answers each one with data/extract/<id>/candidates.json, and the
next run collects those files into data/candidates.json.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from tiktok_trip.context import Context
from tiktok_trip.extraction.bundle import load_bundle, video_url_for
from tiktok_trip.extraction.manual import MANUAL_VIDEO_ID, ManualListError, load_manual_candidates
from tiktok_trip.extraction.parse import (
    ExtractionParseError,
    candidates_from_payload,
    merge_candidates,
    parse_json_payload,
)
from tiktok_trip.extraction.prompt import build_agent_prompt
from tiktok_trip.extraction.raw import VideoFiles, list_videos
from tiktok_trip.models import Candidate
from tiktok_trip.paths import Paths
from tiktok_trip.storage import load_models, read_json, save_models

log = logging.getLogger(__name__)


def run(ctx: Context) -> None:
    videos = [v for v in list_videos(ctx.paths) if v.info.exists()]
    pending = [v for v in videos if not candidates_path(ctx.paths, v.video_id).exists()]
    written = write_agent_prompts(ctx, pending)
    total = collect(ctx)
    log.info(
        "%d candidate(s) from %d video(s) in %s", total, len(videos), ctx.paths.candidates_file
    )
    if written:
        log.warning(
            "%d prompt file(s) are waiting for Claude Code: %s/<video_id>/prompt.md. "
            "Ask Claude Code to process them (each says where to write candidates.json), "
            "then run `uv run tiktok-trip extract` again.",
            len(written),
            ctx.paths.extract_dir,
        )
    else:
        log.info("No prompt files waiting: every video has candidates.json")


def extract_dir(paths: Paths, video_id: str) -> Path:
    return paths.extract_dir / video_id


def candidates_path(paths: Paths, video_id: str) -> Path:
    return extract_dir(paths, video_id) / "candidates.json"


def prompt_path(paths: Paths, video_id: str) -> Path:
    return extract_dir(paths, video_id) / "prompt.md"


def write_agent_prompts(ctx: Context, videos: list[VideoFiles]) -> list[Path]:
    written: list[Path] = []
    for files in videos:
        bundle = load_bundle(files, ctx.config.extract)
        target = prompt_path(ctx.paths, files.video_id)
        target.parent.mkdir(parents=True, exist_ok=True)
        output = candidates_path(ctx.paths, files.video_id)
        target.write_text(build_agent_prompt(bundle, ctx.config.city, output), encoding="utf-8")
        written.append(target)
    return written


def collect(ctx: Context) -> int:
    """Merge every extract/<id>/candidates.json and input/places.yaml into data/candidates.json.

    Candidates are replaced per video; the manual list is one more "video" (MANUAL_VIDEO_ID).
    """
    fresh: dict[str, list[Candidate]] = {}
    if ctx.paths.extract_dir.is_dir():
        for path in sorted(ctx.paths.extract_dir.glob("*/candidates.json")):
            video_id = path.parent.name
            try:
                payload = parse_json_payload(path.read_text(encoding="utf-8"))
                fresh[video_id] = _load_candidates(ctx.paths, video_id, payload)
            except ExtractionParseError as exc:
                log.error(
                    "%s: cannot read %s, keeping previous candidates: %s", video_id, path, exc
                )
    try:
        fresh[MANUAL_VIDEO_ID] = load_manual_candidates(ctx.paths.manual_places_file)
        log.info("%d place(s) from %s", len(fresh[MANUAL_VIDEO_ID]), ctx.paths.manual_places_file)
    except ManualListError as exc:
        log.error(
            "cannot read %s, keeping previous manual candidates: %s",
            ctx.paths.manual_places_file,
            exc,
        )
    existing = load_models(ctx.paths.candidates_file, Candidate)
    merged = merge_candidates(existing, fresh)
    save_models(ctx.paths.candidates_file, merged)
    return len(merged)


def _load_candidates(paths: Paths, video_id: str, payload: Any) -> list[Candidate]:
    files = VideoFiles.of(paths, video_id)
    url = video_url_for(files, read_json(files.info)) if files.info.exists() else ""
    return candidates_from_payload(payload, video_id, url)
