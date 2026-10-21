"""input/preferences.yaml: must-go places rank "must", removed places are skipped everywhere."""

from __future__ import annotations

import logging

import pytest

from tiktok_trip.context import Context
from tiktok_trip.errors import UserFacingError
from tiktok_trip.export import load_export_data
from tiktok_trip.export.dataset import by_priority, starred_name, unique_videos
from tiktok_trip.export.i18n import EN, VI
from tiktok_trip.models import Category, Place
from tiktok_trip.preferences import (
    MUST_REASON,
    Preferences,
    apply_preferences,
    load_preferences,
    matches,
)
from tiktok_trip.priority import rank
from tiktok_trip.steps.resolve import carry_enrichment, with_preferences
from tiktok_trip.storage import save_models


def place(pid: str, name: str, **update: object) -> Place:
    base = Place(
        id=pid,
        name=name,
        category=Category.FOOD,
        address="x",
        lat=11.94,
        lng=108.44,
        confidence=0.9,
        priority="medium",
        priority_reason="recommended",
        videos=[f"https://www.tiktok.com/@a/video/{pid}"],
    )
    return base.model_copy(update=update)


PUPPY = place("gp:PUPPY", "Puppy Farm Đà Lạt", category=Category.ATTRACTION)
MAU_DICH = place("gp:MD", "Quán Nướng Mậu Dịch")
SU_KEM = place("gp:SK", "Su Kem Bà Nga")
GACH = place("gp:GACH", "Gạch Coffee")


def test_load_missing_and_null_lists(ctx: Context) -> None:
    assert load_preferences(ctx.paths.preferences_file) == Preferences()
    ctx.paths.preferences_file.write_text("must_go:\n  - Gạch\nremoved:\n", encoding="utf-8")
    assert load_preferences(ctx.paths.preferences_file) == Preferences(must_go=["Gạch"])
    ctx.paths.preferences_file.write_text("must_go: 5\n", encoding="utf-8")
    with pytest.raises(UserFacingError):
        load_preferences(ctx.paths.preferences_file)


@pytest.mark.parametrize(
    ("entry", "target", "aliases", "expected"),
    [
        ("gp:MD", MAU_DICH, (), True),
        ("Tiệm nướng Mậu Dịch", MAU_DICH, (), True),
        ("tiem nuong mau dich", MAU_DICH, (), True),
        ("Puppy Farm (Nông Trại Cún)", PUPPY, (), True),
        ("Nông Trại Cún", PUPPY, ("Puppy Farm (Nông Trại Cún)",), True),
        ("Bánh su kem giòn Bà Nga", SU_KEM, ("Bánh su kem giòn Bà Nga",), True),
        ("Bánh su kem giòn Bà Nga", SU_KEM, (), True),
        ("Lẩu bò", SU_KEM, ("Bánh su kem giòn Bà Nga",), False),
        ("Ấm Sữa Gạo", GACH, (), False),
        ("Puppy", PUPPY, (), True),
        ("gp:OTHER", MAU_DICH, (), False),
    ],
)
def test_matches_by_id_name_score_substring_and_alias(
    entry: str, target: Place, aliases: tuple[str, ...], expected: bool
) -> None:
    assert matches(entry, target, aliases) is expected


def test_apply_marks_must_and_removed_and_reports_unmatched() -> None:
    prefs = Preferences(
        must_go=["Puppy Farm (Nông Trại Cún)", "Ấm Sữa Gạo", "Gạch"],
        removed=["gp:MD", "Gạch"],
    )
    applied = apply_preferences([PUPPY, MAU_DICH, SU_KEM, GACH], prefs, {})
    puppy, mau_dich, su_kem, gach = applied.places
    assert (puppy.priority, puppy.priority_reason, puppy.preference) == (
        "must",
        MUST_REASON,
        "must_go",
    )
    assert puppy.status == "todo"
    assert (mau_dich.status, mau_dich.preference, mau_dich.priority) == (
        "skip",
        "removed",
        "medium",
    )
    assert (su_kem.priority, su_kem.preference, su_kem.status) == ("medium", None, "todo")
    assert (gach.status, gach.preference) == ("skip", "removed")
    assert applied.conflicts == ["gp:GACH"]
    assert applied.unmatched == [("must_go", "Ấm Sữa Gạo")]


def test_unknown_name_is_warned(caplog: pytest.LogCaptureFixture) -> None:
    prefs = Preferences(must_go=["Ấm Sữa Gạo"], removed=["Nowhere"])
    with caplog.at_level(logging.WARNING):
        result = with_preferences([SU_KEM], prefs, {})
    assert result == [SU_KEM]
    assert "must_go 'Ấm Sữa Gạo' matches no place" in caplog.text
    assert "removed 'Nowhere' matches no place" in caplog.text


def test_unremoving_a_place_restores_its_status() -> None:
    removed = with_preferences([MAU_DICH], Preferences(removed=["gp:MD"]), {})[0]
    assert removed.status == "skip"
    fresh = MAU_DICH.model_copy(update={"spatial": None})
    carried = carry_enrichment(removed, fresh)
    assert carried.status == "todo"
    assert with_preferences([carried], Preferences(), {})[0].status == "todo"

    visited = MAU_DICH.model_copy(update={"status": "visited"})
    assert carry_enrichment(visited, fresh).status == "visited"


def test_must_ranks_first_with_four_stars() -> None:
    must = PUPPY.model_copy(update={"priority": "must"})
    high = SU_KEM.model_copy(update={"priority": "high"})
    assert rank("must") < rank("high")
    assert by_priority([high, must]) == [must, high]
    assert starred_name(must) == "★★★★ Puppy Farm Đà Lạt"
    assert (EN.priority("must"), VI.priority("must")) == ("Must go", "Phải đi")
    assert EN.priority_legend(include_must=True).startswith("★★★★ must go · ★★★ high")
    assert VI.priority_legend(include_must=True).startswith("★★★★ phải đi · ★★★ cao")
    assert EN.map_ui["must_go"] == "Must go"
    assert VI.map_ui["must_go"] == "Phải đi"


def test_export_dataset_leaves_removed_places_out(ctx: Context) -> None:
    removed = MAU_DICH.model_copy(update={"status": "skip", "preference": "removed"})
    manual = SU_KEM.model_copy(update={"videos": ["input/places.yaml", *SU_KEM.videos]})
    save_models(ctx.paths.places_file, [PUPPY, removed, manual])
    data = load_export_data(ctx)
    assert [p.id for p in data.places] == ["gp:PUPPY", "gp:SK"]
    assert unique_videos(data.places) == [*PUPPY.videos, *SU_KEM.videos]
