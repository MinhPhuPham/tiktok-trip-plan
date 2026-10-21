"""input/places.yaml: the user's own list becomes manual candidates merged by extract."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest

from tiktok_trip.context import Context
from tiktok_trip.extraction.manual import (
    BREAKFAST,
    CAFE,
    MANUAL_VIDEO_ID,
    MANUAL_VIDEO_URL,
    MUST_GO_QUOTE,
    ManualListError,
    candidates_from_sections,
    load_manual_candidates,
    parse_entry,
    section_for,
)
from tiktok_trip.extraction.prompt import SOURCES
from tiktok_trip.models import Candidate, Category, EvidenceSource
from tiktok_trip.priority import rate
from tiktok_trip.steps import extract
from tiktok_trip.steps.resolve import post_sizes, signal
from tiktok_trip.storage import load_models

PLACES_YAML = """\
# my list
- section: "Ăn sáng"      # breakfast
  places:
    - "Bún bò bốc khói | 29 Trần Phú"
    - "Bánh căn nhà chung | 1 đường nhà chung"
- section: "Ăn tối:"
  places:
    - "Quán nướng Mậu Dịch | 28B Trần Hưng Đạo, p10 | đặt bàn trước"
- section: "Cà phê"
  places:
    - "Gạch"
"""


def write_places(ctx: Context, text: str) -> Path:
    path = ctx.paths.manual_places_file
    path.write_text(text, encoding="utf-8")
    return path


def write_video_candidates(ctx: Context, video_id: str, names: list[str]) -> None:
    folder = ctx.paths.extract_dir / video_id
    folder.mkdir(parents=True, exist_ok=True)
    payload = [
        {
            "name": name,
            "video_url": f"https://www.tiktok.com/@a/video/{video_id}",
            "confidence": 0.8,
        }
        for name in names
    ]
    (folder / "candidates.json").write_text(json.dumps(payload), encoding="utf-8")


@pytest.mark.parametrize(
    ("title", "category", "hint"),
    [
        ("Ăn sáng", Category.FOOD, "meal: breakfast"),
        ("ăn trưa:", Category.FOOD, "meal: lunch"),
        ("Ăn tối", Category.FOOD, "meal: dinner"),
        ("Ăn vặt", Category.FOOD, "meal: snack"),
        ("Cà phê", Category.CAFE, "cafe"),
        ("Breakfast", Category.FOOD, "meal: breakfast"),
        ("Đi chơi", Category.ATTRACTION, None),
    ],
)
def test_section_maps_to_category_and_hint(
    title: str, category: Category, hint: str | None
) -> None:
    section = section_for(title)
    assert (section.category, section.hint) == (category, hint)


def test_unknown_section_is_other_with_a_warning(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING):
        section = section_for("Mua sắm")
    assert (section.category, section.hint) == (Category.OTHER, None)
    assert "unknown section" in caplog.text


def test_entry_with_address() -> None:
    candidate = parse_entry("Bún bò bốc khói | 29 Trần Phú", BREAKFAST)
    assert candidate is not None
    assert candidate.name == "Bún bò bốc khói"
    assert candidate.address_as_mentioned == "29 Trần Phú"
    assert candidate.category is Category.FOOD
    assert candidate.notes == "meal: breakfast"
    assert (candidate.video_id, candidate.video_url) == (MANUAL_VIDEO_ID, MANUAL_VIDEO_URL)
    assert [(e.source, e.quote) for e in candidate.evidence] == [
        (EvidenceSource.MANUAL, "Bún bò bốc khói | 29 Trần Phú")
    ]
    assert candidate.recommendation == "strong"
    assert candidate.recommendation_quote == MUST_GO_QUOTE
    assert candidate.recommendation_source is EvidenceSource.MANUAL


def test_entry_without_address_and_with_remark() -> None:
    bare = parse_entry("Gạch", CAFE)
    assert bare is not None
    assert (bare.name, bare.address_as_mentioned, bare.notes) == ("Gạch", None, "cafe")
    assert bare.evidence[0].quote == "Gạch"

    remark = parse_entry("Quán nướng Mậu Dịch | 28B Trần Hưng Đạo, p10 | đặt bàn trước", BREAKFAST)
    assert remark is not None
    assert remark.address_as_mentioned == "28B Trần Hưng Đạo, p10"
    assert remark.notes == "meal: breakfast; đặt bàn trước"

    assert parse_entry(" | 12 Phố", CAFE) is None


def test_manual_entry_rates_high_even_in_a_long_list() -> None:
    candidates = candidates_from_sections([{"section": "Cà phê", "places": ["Gạch", "A", "B"]}])
    sizes = post_sizes(candidates)
    assert sizes[MANUAL_VIDEO_ID] == 3
    assert rate(1, [signal(candidates[0], sizes)]).priority == "high"


def test_sections_skip_bad_items() -> None:
    data = [
        {"section": "Cà phê", "places": ["Gạch", 7, None]},
        "not a section",
        {"section": "Ăn sáng", "places": None},
    ]
    assert [c.name for c in candidates_from_sections(data)] == ["Gạch"]
    with pytest.raises(ManualListError):
        candidates_from_sections({"section": "x"})


def test_load_missing_file_is_empty(tmp_path: Path) -> None:
    assert load_manual_candidates(tmp_path / "places.yaml") == []


def test_repo_example_parses() -> None:
    example = Path(__file__).resolve().parents[1] / "input" / "places.yaml"
    if not example.exists():
        pytest.skip("input/places.yaml not present")
    candidates = load_manual_candidates(example)
    assert len(candidates) >= 20
    assert all(c.evidence and c.recommendation == "strong" for c in candidates)


def test_collect_merges_and_replaces_the_manual_set(ctx: Context) -> None:
    write_video_candidates(ctx, "v1", ["Phở Hòa"])
    write_places(ctx, PLACES_YAML)

    assert extract.collect(ctx) == 5
    stored = load_models(ctx.paths.candidates_file, Candidate)
    assert [c.name for c in stored if c.video_id == "v1"] == ["Phở Hòa"]
    manual = [c for c in stored if c.video_id == MANUAL_VIDEO_ID]
    assert [c.name for c in manual] == [
        "Bún bò bốc khói",
        "Bánh căn nhà chung",
        "Quán nướng Mậu Dịch",
        "Gạch",
    ]
    assert [c.category for c in manual] == [Category.FOOD] * 3 + [Category.CAFE]

    write_places(ctx, '- section: "Cà phê"\n  places: ["Làng Vũ Thị | 49B Tổ Sào Nam, p11"]\n')
    assert extract.collect(ctx) == 2
    stored = load_models(ctx.paths.candidates_file, Candidate)
    assert [c.name for c in stored if c.video_id == MANUAL_VIDEO_ID] == ["Làng Vũ Thị"]

    ctx.paths.manual_places_file.unlink()
    assert extract.collect(ctx) == 1
    assert [c.video_id for c in load_models(ctx.paths.candidates_file, Candidate)] == ["v1"]


def test_invalid_yaml_keeps_previous_manual_candidates(
    ctx: Context, caplog: pytest.LogCaptureFixture
) -> None:
    write_places(ctx, PLACES_YAML)
    assert extract.collect(ctx) == 4
    write_places(ctx, "- section: [unclosed\n")
    with caplog.at_level(logging.ERROR):
        assert extract.collect(ctx) == 4
    assert "keeping previous manual candidates" in caplog.text


def test_extraction_prompt_does_not_offer_the_manual_source() -> None:
    assert "manual" not in SOURCES
    assert "caption" in SOURCES
