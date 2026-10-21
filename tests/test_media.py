from __future__ import annotations

import random
import subprocess
import sys
import types
from pathlib import Path
from typing import Any

import pytest
from PIL import Image, ImageDraw

from tiktok_trip.context import Context
from tiktok_trip.extraction.raw import (
    Transcript,
    TranscriptSegment,
    VideoFiles,
    VideoSource,
    spread_evenly,
)
from tiktok_trip.steps import media
from tiktok_trip.storage import read_json, save_model


def _pattern(kind: str, size: int = 96) -> Image.Image:
    image = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(image)
    if kind == "hgrad":
        for x in range(size):
            draw.line([(x, 0), (x, size)], fill=x * 255 // size)
    elif kind == "checker":
        step = size // 6
        for i in range(6):
            for j in range(6):
                if (i + j) % 2:
                    draw.rectangle([i * step, j * step, (i + 1) * step, (j + 1) * step], fill=255)
    elif kind.startswith("noise"):
        rng = random.Random(kind)
        image.putdata([rng.randrange(256) for _ in range(size * size)])
    return image.convert("RGB")


def _write(images: list[Image.Image], directory: Path) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    paths = []
    for index, image in enumerate(images, start=1):
        path = directory / f"{index:03d}.jpg"
        image.save(path, quality=95)
        paths.append(path)
    return paths


def test_frame_filter_and_command_follow_plan() -> None:
    assert media.frame_filter(0.3, 90) == "select='gt(scene,0.3)+not(mod(n,90))'"
    command = media.ffmpeg_command(Path("v.mp4"), Path("out"), 0.3, 90)
    assert command[0] == "ffmpeg"
    assert command[command.index("-fps_mode") + 1] == "vfr"
    assert command[-1] == str(Path("out") / "%03d.jpg")


def test_missing_ffmpeg_says_how_to_install(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("tiktok_trip.steps.media.shutil.which", lambda _: None)
    with pytest.raises(media.FfmpegMissingError, match="brew install ffmpeg"):
        media.require_ffmpeg()


def test_dedupe_drops_near_identical_frames(tmp_path: Path) -> None:
    base = _pattern("hgrad")
    brighter = base.point(lambda v: min(v + 6, 255))
    frames = _write(
        [base, brighter, base, _pattern("checker"), _pattern("noise"), _pattern("checker")],
        tmp_path,
    )
    kept = media.dedupe_frames(frames, max_frames=10)
    assert [p.name for p in kept] == ["001.jpg", "004.jpg", "005.jpg"]


def test_dedupe_caps_and_spreads_over_time(tmp_path: Path) -> None:
    frames = _write(
        [_pattern(k) for k in ("hgrad", "checker", "noise-a", "noise-b")],
        tmp_path,
    )
    kept = media.dedupe_frames(frames, max_frames=2)
    assert [p.name for p in kept] == ["001.jpg", "004.jpg"]


def test_spread_evenly() -> None:
    assert spread_evenly(list(range(10)), 4) == [0, 3, 6, 9]
    assert spread_evenly([1, 2], 5) == [1, 2]
    assert spread_evenly([1, 2, 3], 1) == [1]
    assert spread_evenly([1, 2, 3], 0) == []


@pytest.fixture
def video(ctx: Context) -> VideoFiles:
    files = VideoFiles.of(ctx.paths, "7400000000000000001")
    files.root.mkdir(parents=True)
    files.video.write_bytes(b"fake")
    return files


@pytest.fixture
def fake_ffmpeg(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    calls: list[list[str]] = []

    def fake_run(command: list[str], **_: Any) -> subprocess.CompletedProcess[str]:
        calls.append(command)
        _write(
            [_pattern(k) for k in ("hgrad", "hgrad", "checker")],
            Path(command[-1]).parent,
        )
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(
        "tiktok_trip.steps.media.shutil.which", lambda _: "/opt/homebrew/bin/ffmpeg"
    )
    monkeypatch.setattr("tiktok_trip.steps.media.subprocess.run", fake_run)
    return calls


def test_run_without_whisper_writes_empty_transcript_and_skips_next_time(
    ctx: Context,
    video: VideoFiles,
    fake_ffmpeg: list[list[str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(media, "whisper_available", lambda: False)
    media.run(ctx)

    assert [p.name for p in video.frame_paths()] == ["001.jpg", "003.jpg"]
    assert not (video.root / "frames.tmp").exists()
    assert read_json(video.transcript) == {
        "segments": [],
        "available": False,
        "model": None,
        "language": None,
        "reason": None,
    }

    media.run(ctx)
    assert len(fake_ffmpeg) == 1


def test_run_with_whisper_transcribes(
    ctx: Context,
    video: VideoFiles,
    fake_ffmpeg: list[list[str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    video.transcript.write_text('{"segments": [], "available": false}', encoding="utf-8")

    class FakeTranscriber:
        def __init__(self, model_name: str, language: str, compute_type: str) -> None:
            assert (model_name, language, compute_type) == ("large-v3", "vi", "int8")

        def transcribe(self, path: Path) -> Transcript:
            return Transcript(
                segments=[TranscriptSegment(start=1.5, end=3.0, text="Ốc Oanh")],
                model="large-v3",
                language="vi",
            )

    monkeypatch.setattr(media, "whisper_available", lambda: True)
    monkeypatch.setattr(media, "Transcriber", FakeTranscriber)
    media.run(ctx)

    data = read_json(video.transcript)
    assert data["available"] is True
    assert data["segments"] == [{"start": 1.5, "end": 3.0, "text": "Ốc Oanh"}]


def test_ffmpeg_failure_is_logged_not_fatal(
    ctx: Context, video: VideoFiles, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("tiktok_trip.steps.media.shutil.which", lambda _: "/usr/bin/ffmpeg")
    monkeypatch.setattr(
        "tiktok_trip.steps.media.subprocess.run",
        lambda command, **_: subprocess.CompletedProcess(command, 1, "", "moov atom not found"),
    )
    monkeypatch.setattr(media, "whisper_available", lambda: False)
    media.run(ctx)
    assert not video.frames.exists()
    assert not (video.root / "frames.tmp").exists()


def test_audio_command_streams_16k_mono_pcm_to_stdout() -> None:
    command = media.audio_command(Path("v.mp4"))
    assert command[0] == "ffmpeg"
    assert command[command.index("-i") + 1] == "v.mp4"
    assert command[command.index("-f") + 1] == "s16le"
    assert command[command.index("-ac") + 1] == "1"
    assert command[command.index("-ar") + 1] == "16000"
    assert "-vn" in command
    assert command[-1] == "-"


def test_pcm_bytes_become_float32_in_unit_range() -> None:
    np = pytest.importorskip("numpy")
    raw = np.array([0, 16384, -16384, 32767, -32768], dtype="<i2").tobytes() + b"\x01"
    audio = media.pcm_s16le_to_float32(raw)
    assert audio.dtype == np.float32
    assert audio.tolist() == [0.0, 0.5, -0.5, 32767 / 32768, -1.0]


@pytest.fixture
def fake_audio_ffmpeg(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    np = pytest.importorskip("numpy")
    calls: list[list[str]] = []

    def fake_run(command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        calls.append(command)
        assert "text" not in kwargs
        pcm = np.array([0, 8192, -32768], dtype="<i2").tobytes()
        return subprocess.CompletedProcess(command, 0, pcm, b"")

    monkeypatch.setattr(
        "tiktok_trip.steps.media.shutil.which", lambda _: "/opt/homebrew/bin/ffmpeg"
    )
    monkeypatch.setattr("tiktok_trip.steps.media.subprocess.run", fake_run)
    return calls


def test_decode_audio_reads_ffmpeg_stdout(fake_audio_ffmpeg: list[list[str]]) -> None:
    audio = media.decode_audio(Path("v.mp4"))
    assert fake_audio_ffmpeg == [media.audio_command(Path("v.mp4"))]
    assert audio.tolist() == [0.0, 0.25, -1.0]


def test_decode_audio_failure_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("tiktok_trip.steps.media.shutil.which", lambda _: "/usr/bin/ffmpeg")
    monkeypatch.setattr(
        "tiktok_trip.steps.media.subprocess.run",
        lambda command, **_: subprocess.CompletedProcess(command, 1, b"", b"no audio stream"),
    )
    with pytest.raises(media.FfmpegError, match="no audio stream"):
        media.decode_audio(Path("v.mp4"))


def test_transcriber_passes_decoded_array_not_path(monkeypatch: pytest.MonkeyPatch) -> None:
    np = pytest.importorskip("numpy")
    received: list[Any] = []
    monkeypatch.setattr(
        media, "decode_audio", lambda _: np.zeros(2 * media.WHISPER_SAMPLE_RATE, dtype=np.float32)
    )

    class Segment:
        start, end, text = 0.0, 1.2, " Bún bò "

    class FakeModel:
        def transcribe(self, audio: Any, **kwargs: Any) -> tuple[list[Segment], None]:
            received.append((audio, kwargs))
            return [Segment()], None

    transcriber = object.__new__(media.Transcriber)
    transcriber.model_name, transcriber.language = "large-v3", "vi"
    transcriber._model = FakeModel()
    transcript = transcriber.transcribe(Path("v.mp4"))

    audio, kwargs = received[0]
    assert isinstance(audio, np.ndarray) and audio.dtype == np.float32
    assert kwargs == {"language": "vi", "vad_filter": True}
    assert transcript.available is True
    assert transcript.segments == [TranscriptSegment(start=0.0, end=1.2, text="Bún bò")]


def test_fit_to_duration_drops_and_clamps_segments_past_the_audio() -> None:
    segments = [
        TranscriptSegment(start=0.0, end=4.0, text="Bún bò"),
        TranscriptSegment(start=50.0, end=56.0, text="ngon lắm"),
        TranscriptSegment(start=55.4, end=60.0, text="exactly at the end"),
        TranscriptSegment(start=55.18, end=85.16, text="mostly past the end"),
    ]
    assert media.fit_to_duration(segments, 55.4) == [
        TranscriptSegment(start=0.0, end=4.0, text="Bún bò"),
        TranscriptSegment(start=50.0, end=55.4, text="ngon lắm"),
    ]


def test_transcriber_drops_hallucinated_segment_after_audio_end(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    np = pytest.importorskip("numpy")
    duration = 55.4
    samples = round(duration * media.WHISPER_SAMPLE_RATE)
    monkeypatch.setattr(media, "decode_audio", lambda _: np.zeros(samples, dtype=np.float32))

    class Segment:
        def __init__(self, start: float, end: float, text: str) -> None:
            self.start, self.end, self.text = start, end, text

    class FakeModel:
        def transcribe(self, audio: Any, **kwargs: Any) -> tuple[list[Segment], None]:
            return [
                Segment(0.0, 3.0, " Bánh căn "),
                Segment(52.0, 56.0, " cuối video "),
                Segment(55.18, 85.16, " Hãy subscribe cho kênh La La School "),
            ], None

    transcriber = object.__new__(media.Transcriber)
    transcriber.model_name, transcriber.language = "large-v3", "vi"
    transcriber._model = FakeModel()
    transcript = transcriber.transcribe(Path("v.mp4"))
    assert [s.text for s in transcript.segments] == ["Bánh căn", "cuối video"]
    assert transcript.segments[-1].end == pytest.approx(duration)


def test_audio_decode_failure_is_logged_and_transcript_left_for_retry(
    ctx: Context,
    video: VideoFiles,
    fake_ffmpeg: list[list[str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FailingTranscriber:
        def __init__(self, model_name: str, language: str, compute_type: str) -> None:
            pass

        def transcribe(self, path: Path) -> Transcript:
            raise media.FfmpegError("no audio stream")

    monkeypatch.setattr(media, "whisper_available", lambda: True)
    monkeypatch.setattr(media, "Transcriber", FailingTranscriber)
    media.run(ctx)
    assert video.frames.is_dir()
    assert not video.transcript.exists()


def _forbid_video_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    def unexpected(*_: Any, **__: Any) -> None:
        raise AssertionError("a photo post without audio needs neither ffmpeg nor Whisper")

    monkeypatch.setattr(media, "whisper_available", lambda: True)
    monkeypatch.setattr(media, "Transcriber", unexpected)
    monkeypatch.setattr("tiktok_trip.steps.media.subprocess.run", unexpected)


@pytest.fixture
def photo_post(ctx: Context) -> VideoFiles:
    files = VideoFiles.of(ctx.paths, "7400000000000000003")
    files.root.mkdir(parents=True)
    files.info.write_text('{"description": "Bánh căn"}', encoding="utf-8")
    url = "https://www.tiktok.com/@reviewer/photo/7400000000000000003"
    save_model(
        files.source,
        VideoSource(url=url, video_id=files.video_id, has_video=False, image_count=3),
    )
    return files


def test_photo_post_slides_become_frames_and_no_audio_transcript(
    ctx: Context, photo_post: VideoFiles, monkeypatch: pytest.MonkeyPatch
) -> None:
    base = _pattern("hgrad", size=64)
    near_copy = base.point(lambda v: min(v + 6, 255))
    tall = Image.new("RGB", (1414, 2000), "white")
    _write([base.resize((800, 1000)), near_copy.resize((800, 1000)), tall], photo_post.images)
    _forbid_video_tools(monkeypatch)

    media.run(ctx)

    assert [p.name for p in photo_post.frame_paths()] == ["001.jpg", "002.jpg", "003.jpg"]
    with Image.open(photo_post.frames / "003.jpg") as frame:
        assert frame.size == (1357, 1920) and frame.format == "JPEG"
    with Image.open(photo_post.frames / "001.jpg") as frame:
        assert frame.size == (800, 1000)
    assert read_json(photo_post.transcript) == {
        "segments": [],
        "available": False,
        "model": None,
        "language": None,
        "reason": "photo post without audio",
    }
    before = photo_post.transcript.stat().st_mtime_ns
    (photo_post.frames / "002.jpg").unlink()

    media.run(ctx)
    assert photo_post.transcript.stat().st_mtime_ns == before
    assert len(photo_post.frame_paths()) == 2


def test_photo_post_with_sound_is_transcribed(
    ctx: Context, photo_post: VideoFiles, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write([_pattern("checker")], photo_post.images)
    (photo_post.root / "audio.mp3").write_bytes(b"mp3")
    heard: list[Path] = []

    class FakeTranscriber:
        def __init__(self, model_name: str, language: str, compute_type: str) -> None:
            pass

        def transcribe(self, path: Path) -> Transcript:
            heard.append(path)
            return Transcript(segments=[TranscriptSegment(start=0, end=2, text="Quán ở dốc")])

    monkeypatch.setattr(media, "whisper_available", lambda: True)
    monkeypatch.setattr(media, "Transcriber", FakeTranscriber)
    media.run(ctx)

    assert heard == [photo_post.root / "audio.mp3"]
    assert read_json(photo_post.transcript)["segments"][0]["text"] == "Quán ở dốc"
    assert len(photo_post.frame_paths()) == 1


def test_photo_post_before_slides_arrive_gets_no_frames_dir(
    ctx: Context, photo_post: VideoFiles, monkeypatch: pytest.MonkeyPatch
) -> None:
    _forbid_video_tools(monkeypatch)
    media.run(ctx)
    assert not photo_post.frames.exists() and not (photo_post.root / "frames.tmp").exists()
    assert read_json(photo_post.transcript)["reason"] == "photo post without audio"

    _write([_pattern("checker"), _pattern("noise")], photo_post.images)
    media.run(ctx)
    assert len(photo_post.frame_paths()) == 2


def test_post_without_source_or_video_is_left_alone(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    files = VideoFiles.of(ctx.paths, "7400000000000000004")
    files.root.mkdir(parents=True)
    files.info.write_text('{"description": "Bánh căn"}', encoding="utf-8")
    _forbid_video_tools(monkeypatch)
    media.run(ctx)
    assert not files.frames.exists() and not files.transcript.exists()


def test_transcriber_loads_whisper_with_the_configured_compute_type(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded: list[tuple[str, dict[str, Any]]] = []

    class FakeWhisperModel:
        def __init__(self, model_name: str, **kwargs: Any) -> None:
            loaded.append((model_name, kwargs))

    fake_module = types.ModuleType("faster_whisper")
    fake_module.WhisperModel = FakeWhisperModel  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "faster_whisper", fake_module)

    media.Transcriber("large-v3", "vi")
    media.Transcriber("small", "vi", compute_type="float32")
    assert loaded == [
        ("large-v3", {"device": "auto", "compute_type": "int8"}),
        ("small", {"device": "auto", "compute_type": "float32"}),
    ]
