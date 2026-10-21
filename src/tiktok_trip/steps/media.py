"""Step 2: key frames (ffmpeg + perceptual-hash dedupe) and a timestamped transcript per video.

A photo post's frames are its slides, re-encoded in post order without dedupe (every slide was
chosen by the creator and may carry its own text). Its transcript comes from the sound fetch
saved, if any; otherwise transcript.json records that there is no audio.
"""

from __future__ import annotations

import importlib.util
import logging
import shutil
import subprocess
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import TYPE_CHECKING, Any

import imagehash
from PIL import Image, ImageOps

from tiktok_trip.config import MediaConfig
from tiktok_trip.context import Context
from tiktok_trip.errors import UserFacingError
from tiktok_trip.extraction.raw import (
    Transcript,
    TranscriptSegment,
    VideoFiles,
    list_videos,
    read_source,
    spread_evenly,
)
from tiktok_trip.storage import read_json, save_model

if TYPE_CHECKING:
    import numpy as np
    import numpy.typing as npt

log = logging.getLogger(__name__)

DUPLICATE_DISTANCE = 6
WHISPER_SAMPLE_RATE = 16_000
MIN_SHARE_INSIDE_AUDIO = 0.5
SLIDE_MAX_SIDE = 1920
SLIDE_JPEG_QUALITY = 90
NO_AUDIO = "photo post without audio"


class FfmpegMissingError(UserFacingError):
    def __init__(self) -> None:
        super().__init__("ffmpeg is not on PATH. Install it with `brew install ffmpeg`.")


class FfmpegError(RuntimeError):
    pass


def run(ctx: Context) -> None:
    cfg = ctx.config.media
    whisper_installed = whisper_available()
    transcriber: Transcriber | None = None
    warned = False
    for files in list_videos(ctx.paths):
        audio = prepare_frames(files, cfg)
        if audio is None or not needs_transcript(files, whisper_installed=whisper_installed):
            continue
        if not whisper_installed:
            if not warned:
                log.warning(
                    "faster-whisper is not installed, so transcripts are left empty. "
                    "Install it with `uv sync` (group whisper) and re-run media."
                )
                warned = True
            save_model(files.transcript, Transcript(segments=[], available=False))
            continue
        transcriber = transcriber or Transcriber(
            cfg.whisper_model, cfg.language, compute_type=cfg.whisper_compute_type
        )
        try:
            transcript = transcriber.transcribe(audio)
        except FfmpegError as exc:
            log.error("%s: %s", files.video_id, exc)
            continue
        save_model(files.transcript, transcript)
        log.info("%s: transcript written", files.video_id)


def prepare_frames(files: VideoFiles, cfg: MediaConfig) -> Path | None:
    """Write frames/ when missing; returns the file to transcribe, or None when there is none.

    A photo post without a sound file gets its final no-audio transcript.json here.
    """
    if files.video.exists():
        if not files.frames.is_dir():
            try:
                count = extract_frames(files, cfg)
            except FfmpegError as exc:
                log.error("%s: %s", files.video_id, exc)
            else:
                log.info("%s: kept %d frame(s)", files.video_id, count)
        return files.video
    if not is_photo_post(files):
        return None
    if not files.frames.is_dir():
        slides_to_frames(files)
    audio = files.audio_file()
    if audio is None and not files.transcript.exists():
        log.info("%s: %s, no transcript", files.video_id, NO_AUDIO)
        save_model(files.transcript, Transcript(available=False, reason=NO_AUDIO))
    return audio


def whisper_available() -> bool:
    return importlib.util.find_spec("faster_whisper") is not None


def needs_transcript(files: VideoFiles, *, whisper_installed: bool) -> bool:
    """Missing, or left empty only because faster-whisper was not installed then."""
    if not files.transcript.exists():
        return True
    data = read_json(files.transcript)
    return whisper_installed and not data.get("available", True) and not data.get("reason")


def is_photo_post(files: VideoFiles) -> bool:
    source = read_source(files)
    return source is not None and not source.has_video


def slides_to_frames(files: VideoFiles) -> int:
    """Copy a photo post's slides to frames/ (JPEG, long side <= SLIDE_MAX_SIDE), in order.

    Writes via a temp dir; leaves frames/ absent while fetch has saved no slides yet.
    """
    slides = files.image_paths()
    if not slides:
        log.warning("%s: photo post without slide images yet; re-run fetch", files.video_id)
        return 0
    tmp = files.root / "frames.tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    written = 0
    for slide in slides:
        try:
            with Image.open(slide) as image:
                frame = ImageOps.exif_transpose(image).convert("RGB")
        except OSError as exc:
            log.error("%s: unreadable slide %s: %s", files.video_id, slide.name, exc)
            continue
        frame.thumbnail((SLIDE_MAX_SIDE, SLIDE_MAX_SIDE), Image.Resampling.LANCZOS)
        written += 1
        frame.save(tmp / f"{written:03d}.jpg", format="JPEG", quality=SLIDE_JPEG_QUALITY)
    tmp.replace(files.frames)
    log.info("%s: %d slide(s) of %d became frames", files.video_id, written, len(slides))
    return written


def frame_filter(scene_threshold: float, every_n: int) -> str:
    return f"select='gt(scene,{scene_threshold})+not(mod(n,{every_n}))'"


def ffmpeg_command(video: Path, out_dir: Path, scene_threshold: float, every_n: int) -> list[str]:
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(video),
        "-vf",
        frame_filter(scene_threshold, every_n),
        "-fps_mode",
        "vfr",
        "-q:v",
        "2",
        str(out_dir / "%03d.jpg"),
    ]


def require_ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if path is None:
        raise FfmpegMissingError
    return path


def extract_frames(files: VideoFiles, cfg: MediaConfig) -> int:
    """Write deduplicated frames via a temp dir, so a crash never leaves a partial frames/."""
    require_ffmpeg()
    tmp = files.root / "frames.tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    command = ffmpeg_command(files.video, tmp, cfg.scene_threshold, cfg.safety_frame_every_n)
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        shutil.rmtree(tmp, ignore_errors=True)
        raise FfmpegError(f"ffmpeg failed on {files.video}: {result.stderr.strip()[-500:]}")
    frames = sorted(tmp.glob("*.jpg"))
    keep = set(dedupe_frames(frames, cfg.max_frames))
    for frame in frames:
        if frame not in keep:
            frame.unlink()
    tmp.replace(files.frames)
    return len(keep)


def dedupe_frames(
    frames: Sequence[Path], max_frames: int, max_distance: int = DUPLICATE_DISTANCE
) -> list[Path]:
    hashes = []
    for frame in frames:
        with Image.open(frame) as image:
            hashes.append(imagehash.phash(image))
    return [frames[i] for i in select_distinct(hashes, max_frames, max_distance)]


def select_distinct(hashes: Sequence[Any], max_frames: int, max_distance: int) -> list[int]:
    """Indices of frames that differ from every kept frame, then spread evenly over time."""
    kept: list[int] = []
    for index, current in enumerate(hashes):
        if all(current - hashes[k] > max_distance for k in kept):
            kept.append(index)
    return spread_evenly(kept, max_frames)


def audio_command(video: Path, sample_rate: int = WHISPER_SAMPLE_RATE) -> list[str]:
    """ffmpeg writes the audio track to stdout as raw signed 16-bit little-endian mono PCM."""
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-i",
        str(video),
        "-vn",
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-",
    ]


def pcm_s16le_to_float32(raw: bytes) -> npt.NDArray[np.float32]:
    import numpy as np

    usable = len(raw) - len(raw) % 2
    samples = np.frombuffer(raw[:usable], dtype="<i2")
    return samples.astype(np.float32) / np.float32(32768.0)


def decode_audio(video: Path) -> npt.NDArray[np.float32]:
    """16 kHz mono float32 audio in [-1, 1], decoded by the ffmpeg CLI instead of PyAV."""
    require_ffmpeg()
    result = subprocess.run(audio_command(video), capture_output=True, check=False)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        raise FfmpegError(f"ffmpeg could not decode audio of {video}: {stderr[-500:]}")
    return pcm_s16le_to_float32(result.stdout)


def fit_to_duration(
    segments: Iterable[TranscriptSegment], duration_s: float
) -> list[TranscriptSegment]:
    """Drop segments that start at the audio end or lie mostly past it; clamp the other ends.

    Whisper sometimes hallucinates an outro ("subscribe cho kênh ...") past the real audio.
    """
    kept: list[TranscriptSegment] = []
    for segment in segments:
        inside = duration_s - segment.start
        span = segment.end - segment.start
        if inside <= 0 or (segment.end > duration_s and inside < span * MIN_SHARE_INSIDE_AUDIO):
            log.warning(
                "Dropped transcript segment past the audio end (%.2fs >= %.2fs): %r",
                segment.start,
                duration_s,
                segment.text,
            )
            continue
        kept.append(
            segment.model_copy(update={"end": duration_s}) if segment.end > duration_s else segment
        )
    return kept


class Transcriber:
    def __init__(self, model_name: str, language: str, compute_type: str = "int8") -> None:
        from faster_whisper import WhisperModel

        log.info(
            "Loading faster-whisper model %s (%s; first run downloads it)", model_name, compute_type
        )
        self.model_name = model_name
        self.language = language
        self._model = WhisperModel(model_name, device="auto", compute_type=compute_type)

    def transcribe(self, video: Path) -> Transcript:
        audio = decode_audio(video)
        segments, _info = self._model.transcribe(audio, language=self.language, vad_filter=True)
        duration_s = len(audio) / WHISPER_SAMPLE_RATE
        return Transcript(
            segments=fit_to_duration(
                (
                    TranscriptSegment(start=s.start, end=s.end, text=s.text.strip())
                    for s in segments
                ),
                duration_s,
            ),
            available=True,
            model=self.model_name,
            language=self.language,
        )
