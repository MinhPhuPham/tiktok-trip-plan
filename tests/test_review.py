import httpx
import pytest
import respx
import typer
from rich.console import Console

from tiktok_trip.clients.google_places import BASE_URL
from tiktok_trip.context import Context
from tiktok_trip.models import Candidate, Place, ReviewOption, ReviewRow
from tiktok_trip.steps import review
from tiktok_trip.storage import load_models, save_models

ROW = ReviewRow(
    candidate=Candidate(
        video_id="v3",
        video_url="https://www.tiktok.com/@a/video/v3",
        name="Phở Hòa",
        confidence=0.9,
    ),
    reason="ambiguous_branch",
    options=[
        ReviewOption(
            place_id="gp:PH1",
            name="Phở Hòa Pasteur",
            address="260C Pasteur, Phường Xuân Hòa",
            lat=10.7893,
            lng=106.6893,
            distance_km=1.9,
            name_score=100,
        ),
        ReviewOption(
            place_id="gp:PH2",
            name="Phở Hòa",
            address="12 Nguyễn Văn Trỗi, Phường Phú Nhuận",
            lat=10.799,
            lng=106.68,
            distance_km=3.3,
            name_score=100,
        ),
    ],
)
DONE = ROW.model_copy(
    update={"candidate": ROW.candidate.model_copy(update={"name": "Ốc Oanh"}), "decision": "skip"}
)


@pytest.fixture
def rows(ctx: Context) -> list[ReviewRow]:
    save_models(ctx.paths.candidates_file, [ROW.candidate, DONE.candidate])
    save_models(ctx.paths.review_file, [ROW, DONE])
    return [ROW, DONE]


def _place_ids(ctx: Context) -> list[str]:
    return [p.id for p in load_models(ctx.paths.places_file, Place)]


def _decision(ctx: Context, key: str) -> str | None:
    rows: list[ReviewRow] = load_models(ctx.paths.review_file, ReviewRow)
    decision: str | None = next(r.decision for r in rows if r.key == key)
    return decision


def test_show_lists_pending_rows_with_command(ctx: Context, rows: list[ReviewRow]) -> None:
    console = Console(record=True, width=240)
    review.show(ctx, console)
    output = console.export_text()
    assert "v3:Phở Hòa" in output
    assert "v3:Ốc Oanh" not in output
    assert "ambiguous_branch" in output
    assert "1. Phở Hòa Pasteur" in output
    assert "1.9 km" in output
    assert 'tiktok-trip review "v3:Phở Hòa" gp:PH1' in output


def test_show_without_rows(ctx: Context) -> None:
    console = Console(record=True)
    review.show(ctx, console)
    assert "No pending review rows" in console.export_text()


def test_decide_by_option_number_updates_review_and_places(
    ctx: Context, rows: list[ReviewRow]
) -> None:
    review.decide(ctx, ROW.key, "2")
    assert _decision(ctx, ROW.key) == "gp:PH2"
    places = load_models(ctx.paths.places_file, Place)
    assert [(p.id, p.confidence, p.videos) for p in places] == [
        ("gp:PH2", 1.0, [ROW.candidate.video_url])
    ]
    assert "gp:PH2" in ctx.paths.review_csv.read_text(encoding="utf-8-sig")


def test_redeciding_replaces_the_previous_place(ctx: Context, rows: list[ReviewRow]) -> None:
    review.decide(ctx, ROW.key, "1")
    assert _place_ids(ctx) == ["gp:PH1"]
    review.decide(ctx, ROW.key, "2")
    assert _place_ids(ctx) == ["gp:PH2"]


def test_deciding_skip_after_a_place_removes_it(ctx: Context, rows: list[ReviewRow]) -> None:
    review.decide(ctx, ROW.key, "gp:PH1")
    assert _place_ids(ctx) == ["gp:PH1"]
    review.decide(ctx, ROW.key, "skip")
    assert _place_ids(ctx) == []
    assert {r.key: r.decision for r in load_models(ctx.paths.review_file, ReviewRow)} == {
        ROW.key: "skip",
        DONE.key: "skip",
    }


def test_decide_skip_and_place_id(ctx: Context, rows: list[ReviewRow]) -> None:
    review.decide(ctx, ROW.key, "SKIP")
    assert _decision(ctx, ROW.key) == "skip"
    review.decide(ctx, ROW.key, "gp:PH1")
    assert _decision(ctx, ROW.key) == "gp:PH1"


@pytest.mark.parametrize("choice", ["0", "3", "hello", "osm:node/1", "gp:"])
def test_decide_rejects_invalid_choice(ctx: Context, rows: list[ReviewRow], choice: str) -> None:
    with pytest.raises(typer.BadParameter):
        review.decide(ctx, ROW.key, choice)
    assert _decision(ctx, ROW.key) is None


def test_decide_unknown_key_suggests_close_match(ctx: Context, rows: list[ReviewRow]) -> None:
    with pytest.raises(typer.BadParameter, match="Did you mean"):
        review.decide(ctx, "v3:Pho Hoa", "1")


@respx.mock
def test_decide_other_google_id_fetches_basic_details(
    ctx: Context, rows: list[ReviewRow], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ctx.secrets, "google_maps_key", "test-key")
    respx.get(f"{BASE_URL}/places/ChIJotherBranch123").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "ChIJotherBranch123",
                "displayName": {"text": "Phở Hòa Quận 3"},
                "formattedAddress": "5 Võ Văn Tần, Phường Xuân Hòa",
                "location": {"latitude": 10.776, "longitude": 106.69},
                "businessStatus": "OPERATIONAL",
                "types": ["restaurant"],
            },
        )
    )
    review.decide(ctx, ROW.key, "ChIJotherBranch123")
    assert _decision(ctx, ROW.key) == "gp:ChIJotherBranch123"
    assert [p.id for p in load_models(ctx.paths.places_file, Place)] == ["gp:ChIJotherBranch123"]


def test_decide_keeps_decision_when_details_unavailable(
    ctx: Context, rows: list[ReviewRow], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ctx.secrets, "google_maps_key", None)
    review.decide(ctx, ROW.key, "gp:ChIJunknown")
    assert _decision(ctx, ROW.key) == "gp:ChIJunknown"
    assert load_models(ctx.paths.places_file, Place) == []


def test_shell_quote_escapes() -> None:
    assert review.shell_quote('v1:Quán "Ba"') == '"v1:Quán \\"Ba\\""'
