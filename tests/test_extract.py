from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from tiktok_trip.context import Context
from tiktok_trip.extraction.bundle import build_bundle, load_bundle
from tiktok_trip.extraction.parse import (
    ExtractionParseError,
    candidates_from_payload,
    merge_candidates,
    parse_json_payload,
    strip_code_fences,
    strip_decoration,
)
from tiktok_trip.extraction.prompt import EXAMPLE_OUTPUT, build_agent_prompt, build_prompt
from tiktok_trip.extraction.raw import (
    PostPage,
    RawComment,
    Transcript,
    TranscriptSegment,
    VideoFiles,
    read_source,
)
from tiktok_trip.models import Candidate, EvidenceSource
from tiktok_trip.steps import extract, fetch
from tiktok_trip.storage import load_models, save_model, save_models, write_json

FIXTURE = Path(__file__).parent / "fixtures" / "tiktok_info.json"
VIDEO_ID = "7400000000000000001"
URL = "https://www.tiktok.com/@reviewer/video/7400000000000000001"

MODEL_JSON = [
    {
        "name": "Ốc Oanh",
        "category": "food",
        "address_as_mentioned": "534 Vĩnh Khánh, Quận 4",
        "must_try": ["ốc hương rang muối"],
        "evidence": [{"source": "caption", "quote": "Ốc Oanh: 534 Vĩnh Khánh, Quận 4"}],
        "confidence": 0.92,
    },
    {
        "name": "Bánh mì Huỳnh Hoa",
        "category": "food",
        "address_as_mentioned": "26 Lê Thị Riêng Q1",
        "evidence": [],
        "confidence": 0.8,
    },
]


def _info() -> dict[str, Any]:
    info: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return info


@pytest.fixture
def raw_video(ctx: Context) -> VideoFiles:
    files = VideoFiles.of(ctx.paths, VIDEO_ID)
    files.root.mkdir(parents=True)
    files.info.write_text(FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
    fetch.finalize(files, URL)
    files.frames.mkdir()
    for index in range(1, 6):
        (files.frames / f"{index:03d}.jpg").write_bytes(b"\xff\xd8fake")
    write_json(
        files.transcript,
        {
            "segments": [{"start": 65.2, "end": 68, "text": " quán ốc Vĩnh Khánh "}],
            "available": True,
        },
    )
    return files


def test_build_bundle_from_fixture(tmp_path: Path) -> None:
    info = _info()
    comments = fetch.normalize_comments(info["comments"], info)
    frames = [tmp_path / f"{i:03d}.jpg" for i in range(1, 21)]
    transcript = Transcript(segments=[TranscriptSegment(start=65.2, end=68, text="quán ốc")])

    bundle = build_bundle(
        VIDEO_ID,
        URL,
        info,
        comments=comments,
        transcript=transcript,
        frames=frames,
        max_comments=3,
    )

    assert bundle.caption.startswith("Top 3 quán ăn đêm")
    assert bundle.title is None
    assert bundle.hashtags == ["saigonfood", "anđêm", "foodtiktok"]
    assert bundle.location == {
        "poi_name": "Ốc Oanh",
        "location": "city: Ho Chi Minh City; address: 534 Vĩnh Khánh",
    }
    assert [c.author for c in bundle.comments] == ["reviewer", "fan3", "fan2"]
    assert bundle.transcript_lines() == ["[01:05] quán ốc"]
    assert [p.name for p in bundle.frames] == [f"{i:03d}.jpg" for i in range(1, 21)]


def test_prompt_states_rules_and_carries_video_data(raw_video: VideoFiles, ctx: Context) -> None:
    bundle = load_bundle(raw_video, ctx.config.extract)
    prompt = build_prompt(bundle, "Ho Chi Minh City")

    assert "Return JSON only" in prompt
    assert "Every `address_as_mentioned` must be backed by at least" in prompt
    assert "omit `address_as_mentioned`" in prompt
    assert "exactly as written or heard" in prompt
    assert "Quận 1" in prompt and "chi nhánh" in prompt
    assert "trip planner in Ho Chi Minh City" in prompt
    assert "[CREATOR, reply] @reviewer (5 likes): 534 Vĩnh Khánh nha bạn" in prompt
    assert "[01:05] quán ốc Vĩnh Khánh" in prompt
    assert "poi_name: Ốc Oanh" in prompt
    assert prompt.index("<video_data>") > prompt.index("Rules:")


def test_prompt_states_the_recommendation_rule(raw_video: VideoFiles, ctx: Context) -> None:
    prompt = build_prompt(load_bundle(raw_video, ctx.config.extract), "Ho Chi Minh City")

    assert "`recommendation` (strong | normal | none)" in prompt
    for phrase in ("phải thử", "nhất định phải ghé", "ngon nhất", "top 1", "best"):
        assert phrase in prompt
    assert "names exactly one place is a dedicated review" in prompt
    assert "`recommendation_quote`" in prompt and "`recommendation_source`" in prompt
    assert '"recommendation": "strong"' in prompt
    example = candidates_from_payload(EXAMPLE_OUTPUT, VIDEO_ID, URL)[0]
    assert example.recommendation == "strong"
    assert example.recommendation_source is EvidenceSource.CAPTION


def test_parse_accepts_recommendation_fields_and_defaults() -> None:
    base = {"name": "Ốc Oanh", "confidence": 0.9}
    payload = [
        {
            **base,
            "recommendation": "Strong ",
            "recommendation_quote": "phải thử",
            "recommendation_source": "caption",
        },
        {
            **base,
            "name": "B",
            "recommendation": "normal",
            "recommendation_quote": "ngon",
            "recommendation_source": "creator reply",
        },
        {**base, "name": "C", "recommendation": "strong"},
        {**base, "name": "D", "recommendation": "none", "recommendation_quote": "x"},
        {**base, "name": "E", "recommendation": "must-go"},
        {**base, "name": "F"},
    ]
    strong, normal, unquoted, listed, unknown, legacy = candidates_from_payload(
        payload, VIDEO_ID, URL
    )
    assert (strong.recommendation, strong.recommendation_quote) == ("strong", "phải thử")
    assert strong.recommendation_source is EvidenceSource.CAPTION
    assert (normal.recommendation, normal.recommendation_source) == ("normal", None)
    assert (unquoted.recommendation, unquoted.recommendation_quote) == ("none", None)
    assert (listed.recommendation, listed.recommendation_quote) == ("none", None)
    assert unknown.recommendation is None
    assert legacy.recommendation is None
    assert legacy.recommendation_quote is None and legacy.recommendation_source is None


def test_parse_fenced_json() -> None:
    text = "```json\n" + json.dumps(MODEL_JSON, ensure_ascii=False) + "\n```"
    assert strip_code_fences(text).startswith("[")
    assert parse_json_payload(text) == MODEL_JSON
    assert parse_json_payload('Here you go:\n[{"name": "A"}]\nDone.') == [{"name": "A"}]
    with pytest.raises(ExtractionParseError):
        parse_json_payload("I could not find any place.")


def test_candidates_fill_ids_drop_unsupported_address_and_skip_invalid() -> None:
    payload = {"candidates": [*MODEL_JSON, {"name": "", "confidence": 2}, "junk"]}
    candidates = candidates_from_payload(payload, VIDEO_ID, URL)

    assert [c.name for c in candidates] == ["Ốc Oanh", "Bánh mì Huỳnh Hoa"]
    assert all(c.video_id == VIDEO_ID and c.video_url == URL for c in candidates)
    assert candidates[0].address_as_mentioned == "534 Vĩnh Khánh, Quận 4"
    assert candidates[1].address_as_mentioned is None


def test_merge_replaces_only_rerun_videos() -> None:
    def cand(video_id: str, name: str) -> Candidate:
        return Candidate(video_id=video_id, video_url="u", name=name, confidence=0.5)

    merged = merge_candidates(
        [cand("a", "old-a"), cand("b", "old-b")], {"a": [cand("a", "new-a1"), cand("a", "new-a2")]}
    )
    assert [c.name for c in merged] == ["old-b", "new-a1", "new-a2"]


def test_agent_mode_writes_prompt_then_collects(raw_video: VideoFiles, ctx: Context) -> None:
    extract.run(ctx)

    prompt_file = extract.prompt_path(ctx.paths, VIDEO_ID)
    output = extract.candidates_path(ctx.paths, VIDEO_ID)
    text = prompt_file.read_text(encoding="utf-8")
    assert str(output.resolve()) in text
    assert str((raw_video.frames / "001.jpg").resolve()) in text
    assert "Output schema" in text
    assert load_models(ctx.paths.candidates_file, Candidate) == []

    write_json(output, MODEL_JSON[:1])
    extract.run(ctx)

    candidates = load_models(ctx.paths.candidates_file, Candidate)
    assert [(c.video_id, c.video_url, c.name) for c in candidates] == [(VIDEO_ID, URL, "Ốc Oanh")]


def test_prompt_lists_every_frame_media_kept_in_time_order(
    raw_video: VideoFiles, ctx: Context
) -> None:
    for index in range(6, 16):
        (raw_video.frames / f"{index:03d}.jpg").write_bytes(b"\xff\xd8fake")
    bundle = load_bundle(raw_video, ctx.config.extract)
    assert [p.name for p in bundle.frames] == [f"{i:03d}.jpg" for i in range(1, 16)]
    extract.run(ctx)
    text = extract.prompt_path(ctx.paths, VIDEO_ID).read_text(encoding="utf-8")
    for index in range(1, 16):
        assert str((raw_video.frames / f"{index:03d}.jpg").resolve()) in text


def test_photo_post_prompt_lists_slides_as_frames(ctx: Context) -> None:
    photo_id = "7400000000000000003"
    photo_url = f"https://www.tiktok.com/@reviewer/photo/{photo_id}"
    files = VideoFiles.of(ctx.paths, photo_id)
    files.root.mkdir(parents=True)
    files.info.write_text(FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
    fetch.finalize(files, photo_url, has_video=False)
    save_model(files.source, read_source(files).model_copy(update={"image_count": 3}))
    save_model(files.post, PostPage(title="Đà Lạt cuối năm", poi={"name": "Chợ Đà Lạt"}))
    files.frames.mkdir()
    for index in range(1, 4):
        (files.frames / f"{index:03d}.jpg").write_bytes(b"\xff\xd8fake")
    save_model(files.transcript, Transcript(available=False, reason="photo post without audio"))

    extract.run(ctx)

    text = extract.prompt_path(ctx.paths, photo_id).read_text(encoding="utf-8")
    assert not files.video.exists()
    assert f"# Extract places from TikTok photo post {photo_id}" in text
    assert "photo post (slideshow) with 3 images and no video" in text
    assert "shop name, address, prices and opening hours" in text
    assert "## Images (the slides), in post order\n001.jpg, 002.jpg, 003.jpg" in text
    for index in range(1, 4):
        assert str((files.frames / f"{index:03d}.jpg").resolve()) in text
    assert "## Photo post title\nĐà Lạt cuối năm" in text
    assert "tiktok_poi: name: Chợ Đà Lạt" in text
    assert "(no transcript: photo post without audio)" in text
    assert "Top 3 quán ăn đêm" in text and "534 Vĩnh Khánh nha bạn" in text


def test_photo_post_before_media_still_gets_a_prompt(ctx: Context) -> None:
    files = VideoFiles.of(ctx.paths, VIDEO_ID)
    files.root.mkdir(parents=True)
    files.info.write_text(FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
    fetch.finalize(files, URL, has_video=False)
    extract.run(ctx)
    text = extract.prompt_path(ctx.paths, VIDEO_ID).read_text(encoding="utf-8")
    assert "Top 3 quán ăn đêm" in text
    assert "(no frames)" in text and "(no transcript available)" in text


def test_agent_mode_keeps_previous_candidates_when_file_is_broken(
    raw_video: VideoFiles, ctx: Context
) -> None:
    write_json(extract.candidates_path(ctx.paths, VIDEO_ID), MODEL_JSON[:1])
    extract.run(ctx)
    extract.candidates_path(ctx.paths, VIDEO_ID).write_text("[{", encoding="utf-8")
    extract.run(ctx)
    assert len(load_models(ctx.paths.candidates_file, Candidate)) == 1


def test_collect_accepts_fenced_json_written_by_claude_code(
    raw_video: VideoFiles, ctx: Context
) -> None:
    fenced = "```json\n" + json.dumps(MODEL_JSON, ensure_ascii=False) + "\n```\n"
    extract.candidates_path(ctx.paths, VIDEO_ID).parent.mkdir(parents=True, exist_ok=True)
    extract.candidates_path(ctx.paths, VIDEO_ID).write_text(fenced, encoding="utf-8")
    extract.run(ctx)

    names = [c.name for c in load_models(ctx.paths.candidates_file, Candidate)]
    assert names == ["Ốc Oanh", "Bánh mì Huỳnh Hoa"]
    assert not extract.prompt_path(ctx.paths, VIDEO_ID).exists()


def test_rerun_replaces_only_that_videos_candidates(raw_video: VideoFiles, ctx: Context) -> None:
    other = Candidate(video_id="other", video_url="u", name="Phở Hòa", confidence=0.9)
    save_models(ctx.paths.candidates_file, [other])
    write_json(extract.candidates_path(ctx.paths, VIDEO_ID), MODEL_JSON)
    extract.run(ctx)
    write_json(extract.candidates_path(ctx.paths, VIDEO_ID), MODEL_JSON[:1])
    extract.run(ctx)

    names = [c.name for c in load_models(ctx.paths.candidates_file, Candidate)]
    assert names == ["Phở Hòa", "Ốc Oanh"]


def test_agent_prompt_lists_frames_and_output(tmp_path: Path) -> None:
    bundle = build_bundle(
        VIDEO_ID,
        URL,
        {"description": "Phở"},
        comments=[RawComment(text="ngon")],
        transcript=None,
        frames=[tmp_path / "001.jpg"],
        max_comments=5,
    )
    text = build_agent_prompt(bundle, "Hà Nội", tmp_path / "candidates.json")
    assert str(tmp_path / "001.jpg") in text and str(tmp_path / "candidates.json") in text
    assert "(no transcript available)" in text


def test_strip_decoration_keeps_inner_text() -> None:
    assert strip_decoration("  ★ Ốc Oanh ✨ ") == "Ốc Oanh"
    assert strip_decoration("📍 26 Lê Thị Riêng, Q1 🇻🇳") == "26 Lê Thị Riêng, Q1"
    assert strip_decoration("☕️👩🏻‍🍳 Cafe ★ Túi Mơ To 🍓🍓") == "Cafe ★ Túi Mơ To"
    assert strip_decoration("1️⃣ Quán 1990. 🔟") == "Quán 1990."
    assert strip_decoration("Phở 24") == "Phở 24"
    assert strip_decoration("(Bún bò)") == "(Bún bò)"
    assert strip_decoration("✨📍") == ""


def test_candidates_drop_decoration_from_name_and_address() -> None:
    payload = [
        {
            "name": "✨ Ốc Oanh ★",
            "address_as_mentioned": "📍 534 Vĩnh Khánh, Quận 4 ",
            "evidence": [{"source": "caption", "quote": "📍 534 Vĩnh Khánh"}],
            "confidence": 0.9,
        },
        {"name": "📍", "confidence": 0.9},
        {"name": "Phở", "address_as_mentioned": " 📍 ", "confidence": 0.9},
    ]
    first, pho = candidates_from_payload(payload, VIDEO_ID, URL)
    assert (first.name, first.address_as_mentioned) == ("Ốc Oanh", "534 Vĩnh Khánh, Quận 4")
    assert first.key == f"{VIDEO_ID}:Ốc Oanh"
    assert first.evidence[0].quote == "📍 534 Vĩnh Khánh"
    assert pho.address_as_mentioned is None
