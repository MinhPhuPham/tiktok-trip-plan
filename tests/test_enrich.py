# ruff: noqa: RUF001
import httpx
import pytest
import respx

from tiktok_trip.clients.google_places import BASE_URL
from tiktok_trip.context import Context
from tiktok_trip.extraction.raw import VideoFiles, read_caption
from tiktok_trip.models import BestTime, Candidate, Category, Place
from tiktok_trip.steps import enrich
from tiktok_trip.storage import load_models, save_models, write_json

VIDEO_URL = "https://www.tiktok.com/@foodie/video/7400000000000000001"
DETAILS = {
    "regularOpeningHours": {
        "periods": [
            {
                "open": {"day": d, "hour": 6, "minute": 0},
                "close": {"day": d, "hour": 11, "minute": 0},
            }
            for d in range(7)
        ],
        "weekdayDescriptions": ["Thứ Hai: 06:00–11:00"],
    },
    "priceRange": {
        "startPrice": {"currencyCode": "VND", "units": "40000"},
        "endPrice": {"currencyCode": "VND", "units": "80000"},
    },
    "rating": 4.6,
    "userRatingCount": 812,
}


def place(pid: str, name: str = "Phở Hòa", **kw: object) -> Place:
    return Place(
        id=pid,
        name=name,
        category=Category.FOOD,
        address="addr",
        lat=10.78,
        lng=106.69,
        confidence=0.9,
        videos=[VIDEO_URL],
        **kw,  # type: ignore[arg-type]
    )


@pytest.fixture
def raw_video(ctx: Context) -> None:
    directory = ctx.paths.raw_video("7400000000000000001")
    write_json(directory / "source.json", {"url": VIDEO_URL, "video_id": "7400000000000000001"})
    write_json(directory / "info.json", {"description": "Phở ngon Sài Gòn #pho"})
    write_json(
        directory / "comments.json",
        [{"text": "Cuối tuần xếp hàng dài lắm", "author": "a"}, {"text": "đi sớm kẻo hết"}],
    )


@respx.mock
def test_enrich_fills_details_and_best_time_once(
    ctx: Context, raw_video: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ctx.secrets, "google_maps_key", "test-key")
    route = respx.get(f"{BASE_URL}/places/ChIJpho").mock(
        return_value=httpx.Response(200, json=DETAILS)
    )
    save_models(ctx.paths.places_file, [place("gp:ChIJpho"), place("osm:node/9", "Chè")])
    enrich.run(ctx)

    google, osm = load_models(ctx.paths.places_file, Place)
    assert google.rating == 4.6
    assert google.rating_count == 812
    assert google.price_range is not None
    assert google.price_range.value == "40.000–80.000 VND"
    assert google.price_range.source == "google"
    assert google.hours is not None
    assert len(google.hours.periods) == 7
    assert google.best_time is not None
    assert google.best_time.source == "comments"
    assert google.best_time.days == "weekday"
    assert google.best_time.deadline == "08:00"
    assert google.best_time.hours == "06:00–08:00"
    assert osm.rating is None
    assert osm.best_time is not None

    enrich.run(ctx)
    assert route.call_count == 1
    assert load_models(ctx.paths.places_file, Place)[0] == google


def test_enrich_without_key_still_suggests_best_time(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ctx.secrets, "google_maps_key", None)
    save_models(ctx.paths.places_file, [place("gp:ChIJpho")])
    enrich.run(ctx)
    result = load_models(ctx.paths.places_file, Place)[0]
    assert result.rating is None
    assert result.best_time is not None
    assert result.best_time.source == "heuristic"


def test_enrich_keeps_existing_best_time(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ctx.secrets, "google_maps_key", None)
    existing = BestTime(hours="10:00–11:00", source="comments", evidence="manual")
    save_models(ctx.paths.places_file, [place("osm:node/1", best_time=existing)])
    enrich.run(ctx)
    assert load_models(ctx.paths.places_file, Place)[0].best_time == existing


def test_texts_reader_is_tolerant(ctx: Context) -> None:
    files = VideoFiles.of(ctx.paths, "abc")
    files.root.mkdir(parents=True)
    files.comments.write_text("{broken", encoding="utf-8")
    files.info.write_text("{broken", encoding="utf-8")
    write_json(files.transcript, {"segments": [{"start": 0, "end": 2, "text": "sáng nay"}]})
    texts = enrich.read_texts(files)
    assert [(t.source, t.text) for t in texts] == [("transcript", "sáng nay")]
    assert enrich.read_texts(VideoFiles.of(ctx.paths, "missing")) == []


def test_caption_is_cached_next_to_info_json(ctx: Context, raw_video: None) -> None:
    files = VideoFiles.of(ctx.paths, "7400000000000000001")
    assert read_caption(files) == "Phở ngon Sài Gòn #pho"
    assert files.caption_cache.read_text(encoding="utf-8") == "Phở ngon Sài Gòn #pho"
    files.caption_cache.write_text("cached", encoding="utf-8")
    assert read_caption(files) == "cached"


def test_video_files_by_source_url_or_id_in_url(ctx: Context, raw_video: None) -> None:
    index = enrich.video_index(ctx.paths)
    found = enrich.video_files(VIDEO_URL + "?lang=vi", index, ctx.paths)
    assert found is not None and found.video_id == "7400000000000000001"
    directory = ctx.paths.raw_video("7400000000000000002")
    directory.mkdir(parents=True)
    url = "https://www.tiktok.com/@a/video/7400000000000000002?is_from_webapp=1"
    by_id = enrich.video_files(url, {}, ctx.paths)
    assert by_id is not None and by_id.root == directory
    assert enrich.video_files("https://vt.tiktok.com/ZSabc/", {}, ctx.paths) is None


def test_heuristic_best_time_is_replaced_when_evidence_arrives(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ctx.secrets, "google_maps_key", None)
    files = VideoFiles.of(ctx.paths, "7400000000000000001")
    write_json(files.source, {"url": VIDEO_URL, "video_id": "7400000000000000001"})
    save_models(ctx.paths.places_file, [place("osm:node/1", "Bún Chả")])
    enrich.run(ctx)
    first = load_models(ctx.paths.places_file, Place)[0].best_time
    assert first is not None and first.source == "heuristic" and first.inputs_hash

    write_json(files.comments, [{"text": "Nên đi buổi sáng sớm cho mát"}])
    enrich.run(ctx)
    second = load_models(ctx.paths.places_file, Place)[0].best_time
    assert second is not None
    assert second.source == "comments"
    assert second.hours == "05:30–08:00"
    assert second.inputs_hash != first.inputs_hash


def test_computed_best_time_follows_changed_inputs_but_manual_one_stays() -> None:
    texts = [enrich.SourceText("comments", "tối mới ngon")]
    computed = enrich.with_best_time(place("osm:node/1", "Bún Chả"), texts)
    assert computed.best_time is not None and computed.best_time.source == "comments"
    assert enrich.with_best_time(computed, texts) == computed
    morning = [enrich.SourceText("comments", "sáng mới ngon")]
    changed = enrich.with_best_time(computed, morning).best_time
    assert changed is not None and changed.hours == "07:00–10:00"
    manual = place("osm:node/1", best_time=BestTime(hours="10:00–11:00", source="comments"))
    kept = enrich.with_best_time(manual, morning)
    assert kept.best_time == manual.best_time
    assert kept.tags == ["breakfast"]


def test_apply_details_never_overwrites() -> None:
    from tiktok_trip.clients.google_places import parse_details
    from tiktok_trip.models import PriceRange

    original = place("gp:x", rating=4.0, price_range=PriceRange(value="50k", source="comments"))
    updated = enrich.apply_details(original, parse_details(DETAILS))
    assert updated.rating == 4.0
    assert updated.price_range == original.price_range
    assert updated.rating_count == 812
    assert updated.hours is not None


def test_price_from_notes_uses_menu_prices_without_side_items() -> None:
    notes = [
        "Mở 6:30-15:00; tô em bé 35.000, bún bò tái 45.000, nạm chả 55.000, "
        "trà đá 5.000, sữa chua 10.000 (menu 011.jpg); cao 1.500 m"
    ]
    found = enrich.price_from_notes(notes)
    assert found is not None
    assert found.value == "35.000–55.000 VND"
    assert found.source == "notes"
    assert enrich.price_from_notes(["chỉ 40k một tô"]) is None
    assert enrich.price_from_notes(["trà 5.000, bánh 10k"]) is not None


def test_notes_price_replaces_google_but_not_comment_price() -> None:
    from tiktok_trip.models import PriceRange

    notes = ["tô nhỏ 35.000, tô lớn 55.000"]
    google = place("gp:x", price_range=PriceRange(value="1–100.000 VND", source="google"))
    google = google.model_copy(update={"notes": notes})
    assert enrich.with_notes_price(google).price_range == PriceRange(
        value="35.000–55.000 VND", source="notes"
    )
    human = google.model_copy(update={"price_range": PriceRange(value="50k", source="comments")})
    assert enrich.with_notes_price(human) == human


def test_notes_price_is_labelled_notes_and_legacy_caption_is_refreshed() -> None:
    from tiktok_trip.models import PriceRange

    notes = ["tô nhỏ 35.000, tô lớn 55.000"]
    legacy = place("gp:x", price_range=PriceRange(value="1–2 VND", source="caption"))
    legacy = legacy.model_copy(update={"notes": notes})
    fresh = enrich.with_notes_price(legacy)
    assert fresh.price_range == PriceRange(value="35.000–55.000 VND", source="notes")
    assert enrich.with_notes_price(fresh) == fresh
    orphan = legacy.model_copy(update={"notes": []})
    assert enrich.with_notes_price(orphan).price_range == PriceRange(
        value="1–2 VND", source="notes"
    )


def test_placeholder_google_price_is_refetched_and_replaced() -> None:
    from tiktok_trip.clients.google_places import parse_details
    from tiktok_trip.models import PriceRange

    stale = place(
        "gp:x", rating=4.0, price_range=PriceRange(value="1–100.000 VND", source="google")
    )
    stale = stale.model_copy(update={"hours": parse_details(DETAILS).hours})
    assert enrich.needs_details(stale)
    payload = {
        **DETAILS,
        "priceRange": {
            "startPrice": {"currencyCode": "VND", "units": "1"},
            "endPrice": {"currencyCode": "VND", "units": "100000"},
        },
    }
    fresh = enrich.apply_details(stale, parse_details(payload))
    assert fresh.price_range == PriceRange(value="đến 100.000 VND", source="google")
    assert not enrich.needs_details(fresh)


def _post_candidate(name: str, must_try: list[str] | None = None) -> Candidate:
    return Candidate(
        video_id="7400000000000000001",
        video_url=VIDEO_URL,
        name=name,
        must_try=must_try or [],
        confidence=0.9,
    )


@pytest.fixture
def two_place_post(ctx: Context) -> list[Candidate]:
    directory = ctx.paths.raw_video("7400000000000000001")
    write_json(directory / "source.json", {"url": VIDEO_URL, "video_id": "7400000000000000001"})
    write_json(directory / "info.json", {"description": "Top quán Đà Lạt"})
    write_json(
        directory / "comments.json",
        [
            {"text": "Mậu Dịch đông lắm, nên đi tối"},
            {"text": "Ấm Sữa Gạo buổi sáng uống ngon"},
            {"text": "cuối tuần đi được không"},
        ],
    )
    write_json(
        directory / "transcript.json",
        {"segments": [{"start": 0, "end": 2, "text": "ly sữa gạo nóng hổi"}]},
    )
    return [
        _post_candidate("Quán nướng Mậu Dịch", ["đồ nướng"]),
        _post_candidate("Ấm Sữa Gạo", ["sữa gạo"]),
    ]


def test_post_with_several_places_keeps_only_texts_naming_the_place(
    ctx: Context, two_place_post: list[Candidate]
) -> None:
    reader = enrich.TextReader(ctx.paths, two_place_post, ("Đà Lạt",))
    am = place("gp:am", "Ấm Sữa Gạo Đà Lạt", candidate_keys=[two_place_post[1].key])
    texts = reader.for_place(am)
    assert [(t.source, t.text, t.scoped) for t in texts] == [
        ("caption", "Top quán Đà Lạt", False),
        ("comments", "Ấm Sữa Gạo buổi sáng uống ngon", True),
        ("transcript", "ly sữa gạo nóng hổi", True),
    ]
    best = enrich.with_best_time(am, texts).best_time
    assert best is not None and best.hours == "07:00–10:00"
    assert "(comments about this place)" in (best.evidence or "")
    mau_dich = place("gp:md", "Cửa hàng nướng Mậu Dịch")
    assert [t.text for t in reader.for_place(mau_dich) if t.source == "comments"] == [
        "Mậu Dịch đông lắm, nên đi tối"
    ]


def test_single_place_post_keeps_every_comment(ctx: Context, raw_video: None) -> None:
    reader = enrich.TextReader(ctx.paths, [_post_candidate("Phở Hòa")])
    comments = [t for t in reader.for_place(place("gp:pho")) if t.source == "comments"]
    assert [t.text for t in comments] == ["Cuối tuần xếp hàng dài lắm", "đi sớm kẻo hết"]
    assert not any(t.scoped for t in comments)


def test_place_terms_skip_words_shared_with_other_places() -> None:
    terms = enrich.place_terms(
        ["Quán nướng Mậu Dịch", "đồ nướng"], ["Tiệm nướng Ông Hương", "đồ nướng"], ("Đà Lạt",)
    )
    assert terms.words == {"dich"}
    assert terms.phrases == {"nuong mau", "mau dich"}
    assert not terms.named_in("đồ nướng ngon")
    assert terms.named_in("MẬU DỊCH đông xỉu")
