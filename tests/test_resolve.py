# ruff: noqa: RUF001
import csv
import dataclasses
import json
from collections.abc import Iterator

import httpx
import pytest
import respx

from tiktok_trip.clients.google_places import TEXT_SEARCH_URL
from tiktok_trip.clients.nominatim import BASE_URL as NOMINATIM_URL
from tiktok_trip.clients.photon import BASE_URL as PHOTON_URL
from tiktok_trip.config import CityProfile, QuotaConfig, ResolveConfig
from tiktok_trip.context import Context
from tiktok_trip.errors import UserFacingError
from tiktok_trip.matching import (
    HouseAddress,
    address_segments,
    branch_score,
    house_address,
    name_score,
)
from tiktok_trip.models import (
    BestTime,
    Candidate,
    Category,
    Evidence,
    EvidenceSource,
    ExcludedCandidate,
    Hours,
    Place,
    Recommendation,
    ReviewRow,
)
from tiktok_trip.quota import QuotaExceededError, QuotaGuard
from tiktok_trip.steps import resolve
from tiktok_trip.steps.resolve import Accept, Match, NoMatch, Review, assess
from tiktok_trip.storage import load_models, save_models

CENTER = (10.7769, 106.7009)
CITY_NODE = {
    "lat": str(CENTER[0]),
    "lon": str(CENTER[1]),
    "display_name": "Thành phố Hồ Chí Minh, Việt Nam",
    "osm_type": "node",
    "osm_id": 1,
    "class": "place",
    "type": "city",
}
CFG = ResolveConfig()


def candidate(
    name: str,
    *,
    address: str | None = None,
    video: str = "v1",
    confidence: float = 0.9,
    must_try: list[str] | None = None,
    notes: str | None = None,
    recommendation: Recommendation | None = None,
    quote: str | None = None,
) -> Candidate:
    evidence = [Evidence(source=EvidenceSource.CAPTION, quote=address)] if address else []
    return Candidate(
        recommendation=recommendation,
        recommendation_quote=quote,
        recommendation_source=EvidenceSource.CAPTION if quote else None,
        video_id=video,
        video_url=f"https://www.tiktok.com/@a/video/{video}",
        name=name,
        address_as_mentioned=address,
        evidence=evidence,
        confidence=confidence,
        must_try=must_try or [],
        notes=notes,
    )


def match(
    place_id: str,
    name: str,
    *,
    km: float = 2.0,
    score: float = 100.0,
    branch: float | None = None,
    lat: float = 10.77,
    lng: float = 106.70,
    status: str = "OPERATIONAL",
) -> Match:
    return Match(
        place_id=place_id,
        name=name,
        address="addr",
        lat=lat,
        lng=lng,
        distance_km=km,
        name_score=score,
        branch_score=branch,
        business_status=status,
    )


# --- pure matching -------------------------------------------------------------------------


def test_name_score_ignores_generic_words_and_diacritics() -> None:
    assert name_score("Quán Ốc Oanh", "Ốc Oanh") == 100
    assert name_score("banh mi huynh hoa", "Bánh Mì Huỳnh Hoa") >= 90
    assert name_score("Bánh mì Huỳnh Hoa", "Bánh Mì Huỳnh Hoa - Lê Thị Riêng") == 100
    assert name_score("Bún bò Huế O Xuân", "Circle K") < 40


HCMC = ("Ho Chi Minh City", *CityProfile().aliases)
DA_LAT = ("Đà Lạt", "Da Lat", "Dalat", "Lâm Đồng", "Lam Dong")


def test_address_tokens_drop_old_districts_but_keep_quan_shops() -> None:
    assert address_segments("26 Lê Thị Riêng, P. Bến Thành, Quận 1, TP.HCM", HCMC) == [
        ["26", "le", "thi", "rieng"],
        ["ben", "thanh"],
    ]
    assert address_segments("123 Lê Lợi quận Bình Thạnh") == [["123", "le", "loi"]]
    assert address_segments("Quán ốc gần chợ") == [["quan", "oc", "cho"]]


def test_region_aliases_come_from_the_city_profile() -> None:
    address = "12 Phan Đình Phùng, Phường 1, Đà Lạt, Lâm Đồng, Việt Nam"
    assert address_segments(address, DA_LAT) == [["12", "phan", "dinh", "phung"], ["1"]]
    assert ["da", "lat"] in address_segments(address, HCMC)
    assert address_segments("5 Lê Lợi, Sài Gòn", DA_LAT) == [["5", "le", "loi"], ["sai", "gon"]]
    assert address_segments("5 Lê Lợi, Sài Gòn", HCMC) == [["5", "le", "loi"]]
    assert address_segments("Chợ Đà Lạt, TP Đà Lạt", DA_LAT) == [["cho"]]


def test_branch_score_prefers_matching_street() -> None:
    evidence = address_segments("12 Lê Lợi, Q1")
    right = branch_score(evidence, "Phở Hòa", "12 Lê Lợi, Phường Sài Gòn, Hồ Chí Minh", HCMC)
    wrong = branch_score(evidence, "Phở Hòa", "88 Lê Lai, Phường Bến Thành, Hồ Chí Minh", HCMC)
    assert right is not None and wrong is not None
    assert right > wrong
    assert branch_score([], "x", "y") is None


# --- assess ---------------------------------------------------------------------------------


def test_accepts_single_good_match() -> None:
    outcome = assess(candidate("Ốc Oanh"), [match("gp:1", "Ốc Oanh")], CFG)
    assert isinstance(outcome, Accept)
    assert outcome.match.place_id == "gp:1"


def test_outside_city_is_never_accepted() -> None:
    outcome = assess(candidate("Ốc Oanh"), [match("gp:1", "Ốc Oanh", km=120)], CFG)
    assert isinstance(outcome, NoMatch)
    assert [m.place_id for m in outcome.outside] == ["gp:1"]


def test_closed_goes_to_review() -> None:
    outcome = assess(
        candidate("Ốc Oanh"), [match("gp:1", "Ốc Oanh", status="CLOSED_PERMANENTLY")], CFG
    )
    assert isinstance(outcome, Review)
    assert outcome.reason == "closed"


def test_grey_name_score_goes_to_review() -> None:
    outcome = assess(candidate("Ốc Oanh"), [match("gp:1", "Ốc Đào", score=60)], CFG)
    assert isinstance(outcome, Review)
    assert outcome.reason == "low_name_score"
    assert outcome.options[0].place_id == "gp:1"


def test_low_candidate_confidence_keeps_best_option() -> None:
    outcome = assess(candidate("Ốc Oanh", confidence=0.5), [match("gp:1", "Ốc Oanh")], CFG)
    assert isinstance(outcome, Review)
    assert outcome.reason == "low_confidence"
    assert outcome.options[0].place_id == "gp:1"


def test_two_close_branches_are_ambiguous() -> None:
    outcome = assess(
        candidate("Phở Hòa", address="Lê Lợi"),
        [
            match("gp:1", "Phở Hòa", branch=50, lat=10.77),
            match("gp:2", "Phở Hòa", branch=45, lat=10.80),
        ],
        CFG,
    )
    assert isinstance(outcome, Review)
    assert outcome.reason == "ambiguous_branch"
    assert len(outcome.options) == 2


def test_clear_branch_evidence_wins() -> None:
    outcome = assess(
        candidate("Phở Hòa", address="Lê Lợi"),
        [
            match("gp:1", "Phở Hòa", branch=10, lat=10.77),
            match("gp:2", "Phở Hòa", branch=80, lat=10.80),
        ],
        CFG,
    )
    assert isinstance(outcome, Accept)
    assert outcome.match.place_id == "gp:2"


def test_duplicate_listing_at_same_spot_is_not_ambiguous() -> None:
    outcome = assess(
        candidate("Phở Hòa"),
        [match("gp:1", "Phở Hòa"), match("gp:2", "Phở Hòa", lng=106.7001)],
        CFG,
    )
    assert isinstance(outcome, Accept)


def test_address_with_no_overlap_is_not_auto_accepted() -> None:
    outcome = assess(
        candidate("Phở Hòa", address="99 Nguyễn Trãi"), [match("gp:1", "Phở Hòa", branch=0)], CFG
    )
    assert isinstance(outcome, Review)
    assert outcome.reason == "low_confidence"


# --- printed house numbers -----------------------------------------------------------------


def test_house_address_parses_number_forms() -> None:
    assert house_address("17/6 Nguyễn Trãi, phường 9") == HouseAddress("17/6", ("nguyen", "trai"))
    assert house_address("3 Bis Trần Hưng Đạo p.10") == HouseAddress(
        "3bis", ("tran", "hung", "dao")
    )
    assert house_address("Lô H19 Khu Hòa Bình") == HouseAddress("h19", ("khu", "hoa", "binh"))
    assert house_address("Số 1 Thông Thiên Học, cư xá bưu điện") == HouseAddress(
        "1", ("thong", "thien", "hoc")
    )
    assert house_address("Chợ Đà Lạt, 265 Đ. Bùi Thị Xuân, Lâm Viên") == HouseAddress(
        "265", ("bui", "thi", "xuan")
    )
    assert house_address("012/01 Đất Làng") == house_address("12/1 Đất Làng")
    for no_number in ("Hẻm 17 Bà Triệu, p4", "Dốc số 9, Trại Mát", "thôn 5, tà nung", "Lê Lợi"):
        assert house_address(no_number) is None


def scored(cand: Candidate, place_id: str, name: str, address: str, lat: float) -> Match:
    return resolve.score(
        cand,
        place_id=place_id,
        name=name,
        address=address,
        lat=lat,
        lng=108.44,
        center=(11.94, 108.44),
        regions=DA_LAT,
    )


def test_exact_house_number_beats_a_brand_spelled_differently() -> None:
    kiwi = candidate("Bánh bông lan KIWI", address="21 Nguyễn Văn Trỗi")
    won = scored(
        kiwi,
        "gp:won",
        "Bông Lan Trứng Nướng - Tiệm Bánh 10 Won",
        "10 Nguyễn Văn Trỗi, Đà Lạt",
        11.95,
    )
    kimi = scored(kiwi, "gp:kimi", "Bông lan trứng nướng Kimi", "21 Nguyễn Văn Trỗi, Đà Lạt", 11.94)
    assert won.name_score >= CFG.min_name_score > kimi.name_score >= 50
    assert (won.house, kimi.house) == ("street", "exact")
    outcome = assess(kiwi, [won, kimi], CFG)
    assert isinstance(outcome, Accept)
    assert outcome.match.place_id == "gp:kimi"
    assert outcome.weak_name
    place = resolve.accepted_place(kiwi, outcome)
    assert place.confidence == 0.8
    assert place.notes[-1].startswith("accepted on exact address, weak name")
    assert place.candidate_keys == [kiwi.key]


def test_other_house_number_on_the_street_goes_to_review() -> None:
    kiwi = candidate("Bánh bông lan KIWI", address="21 Nguyễn Văn Trỗi")
    won = scored(kiwi, "gp:won", "Bánh bông lan KIWI", "10 Nguyễn Văn Trỗi, Đà Lạt", 11.95)
    outcome = assess(kiwi, [won], CFG)
    assert isinstance(outcome, Review)
    assert outcome.reason == "low_confidence"
    other = scored(kiwi, "gp:2", "Bánh bông lan Kiwi", "88 Nguyễn Văn Trỗi, Đà Lạt", 11.96)
    outcome = assess(kiwi, [won, other], CFG)
    assert isinstance(outcome, Review)
    assert outcome.reason == "ambiguous_branch"
    assert {m.place_id for m in outcome.options} == {"gp:won", "gp:2"}


def test_duplicate_listings_at_the_printed_address_are_not_a_tie() -> None:
    linh = candidate("Quán Cơm Linh", address="17B Trần Hưng Đạo")
    first = scored(linh, "gp:1", "Quán cơm Linh - Trần Hưng Đạo", "17b Trần Hưng Đạo", 11.94)
    second = scored(linh, "gp:2", "Quán cơm Linh", "17b Trần Hưng Đạo", 11.95)
    outcome = assess(linh, [first, second], CFG)
    assert isinstance(outcome, Accept)
    assert not outcome.weak_name


def test_two_weak_names_at_the_printed_address_are_a_tie() -> None:
    kiwi = candidate("Bánh bông lan KIWI", address="21 Nguyễn Văn Trỗi")
    kimi = scored(kiwi, "gp:1", "Bông lan trứng nướng Kimi", "21 Nguyễn Văn Trỗi", 11.94)
    kiki = scored(kiwi, "gp:2", "Bông lan trứng nướng Kiki", "21 Nguyễn Văn Trỗi", 11.95)
    outcome = assess(kiwi, [kimi, kiki], CFG)
    assert isinstance(outcome, Review)
    assert outcome.reason == "ambiguous_branch"


def test_exact_address_with_unrelated_name_is_not_accepted() -> None:
    kiwi = candidate("Bánh bông lan KIWI", address="21 Nguyễn Văn Trỗi")
    hotel = scored(kiwi, "gp:h", "Khách sạn Hoàng Gia", "21 Nguyễn Văn Trỗi, Đà Lạt", 11.94)
    assert hotel.house == "exact" and hotel.name_score >= 50
    assert not isinstance(assess(kiwi, [hotel], CFG), Accept)


def test_street_only_address_keeps_the_branch_rules() -> None:
    pho = candidate("Phở Hòa", address="Pasteur")
    first = scored(pho, "gp:1", "Phở Hòa Pasteur", "260C Pasteur, Đà Lạt", 11.94)
    assert first.house is None
    outcome = assess(pho, [first], CFG)
    assert isinstance(outcome, Accept)
    assert not outcome.weak_name


def test_merge_places_dedupes_lists_and_keeps_max_confidence() -> None:
    a = resolve.place_from_match(
        candidate("Ốc Oanh", must_try=["ốc hương"]), match("gp:1", "Ốc Oanh"), 0.6
    )
    b = resolve.place_from_match(
        candidate("Ốc Oanh", video="v2", must_try=["ốc hương", "sò điệp"], notes="đông"),
        match("gp:1", "Ốc Oanh"),
        0.9,
    )
    merged = resolve.merge_places(a, b)
    assert merged.videos == [a.videos[0], b.videos[0]]
    assert merged.must_try == ["ốc hương", "sò điệp"]
    assert merged.notes == ["đông"]
    assert merged.confidence == 0.9


def _merged(*candidates: Candidate) -> Place:
    places = [resolve.place_from_match(c, match("gp:1", "Ốc Oanh"), 0.9) for c in candidates]
    merged = places[0]
    for place in places[1:]:
        merged = resolve.merge_places(merged, place)
    return merged


def _prioritized(*candidates: Candidate, others: int = 0) -> Place:
    """Resolve-style merge; `others` extra places share the first candidate's post."""
    filler = [candidate(f"Quán {n}", video=candidates[0].video_id) for n in range(others)]
    sizes = resolve.post_sizes([*candidates, *filler])
    return resolve.prioritize(_merged(*candidates), candidates, sizes)


def test_post_sizes_count_distinct_places_per_video() -> None:
    sizes = resolve.post_sizes(
        [candidate("A"), candidate("A"), candidate("B"), candidate("C", video="v2")]
    )
    assert sizes == {"v1": 2, "v2": 1}


def test_merge_from_two_videos_is_high() -> None:
    place = _prioritized(
        candidate("Ốc Oanh", recommendation="none"),
        candidate("Ốc Oanh", video="v2", recommendation="none"),
        others=4,
    )
    assert (place.mention_count, place.priority) == (2, "high")
    assert place.priority_reason == "recommended in 2 posts"


def test_single_strong_mention_is_high() -> None:
    place = _prioritized(
        candidate("Ốc Oanh", recommendation="strong", quote="phải thử ốc hương"), others=9
    )
    assert place.priority == "high"
    assert place.priority_reason == "strong: 'phải thử ốc hương' (caption)"


def test_single_normal_mention_is_medium() -> None:
    place = _prioritized(candidate("Ốc Oanh", recommendation="normal", quote="ngon"), others=4)
    assert place.priority == "medium"


def test_dedicated_post_without_praise_is_medium() -> None:
    place = _prioritized(candidate("Ốc Oanh", recommendation="none"))
    assert place.priority == "medium"
    assert place.priority_reason == "dedicated post (the only place in it)"


def test_plain_entry_in_a_list_post_is_low() -> None:
    place = _prioritized(candidate("Ốc Oanh", recommendation="none"), others=28)
    assert place.priority == "low"
    assert place.priority_reason == "listed in a 29-place post"


def test_legacy_candidates_leave_priority_empty() -> None:
    place = _prioritized(candidate("Ốc Oanh"), others=3)
    assert place.priority is None
    assert place.priority_reason is None


# --- run (IO) -------------------------------------------------------------------------------


def _place(
    gid: str, name: str, address: str, lat: float, lng: float, **kw: str
) -> dict[str, object]:
    return {
        "id": gid,
        "displayName": {"text": name, "languageCode": "vi"},
        "formattedAddress": address,
        "location": {"latitude": lat, "longitude": lng},
        "businessStatus": kw.get("status", "OPERATIONAL"),
        "types": ["restaurant", "food"],
    }


GOOGLE = {
    "Bánh mì Huỳnh Hoa": [
        _place(
            "HH1",
            "Bánh Mì Huỳnh Hoa",
            "26 Đ. Lê Thị Riêng, Phường Bến Thành, Hồ Chí Minh, Việt Nam",
            10.7714,
            106.6924,
        )
    ],
    "Phở Hòa": [
        _place(
            "PH1",
            "Phở Hòa Pasteur",
            "260C Pasteur, Phường Xuân Hòa, Hồ Chí Minh",
            10.7893,
            106.6893,
        ),
        _place(
            "PH2", "Phở Hòa", "12 Nguyễn Văn Trỗi, Phường Phú Nhuận, Hồ Chí Minh", 10.7990, 106.6800
        ),
    ],
    "Ốc Đóng Cửa": [
        _place(
            "OC1",
            "Ốc Đóng Cửa",
            "1 Vĩnh Khánh, Hồ Chí Minh",
            10.758,
            106.705,
            status="CLOSED_PERMANENTLY",
        )
    ],
}


def _google(request: httpx.Request) -> httpx.Response:
    query = json.loads(request.content)["textQuery"]
    for prefix, places in GOOGLE.items():
        if query.startswith(prefix):
            return httpx.Response(200, json={"places": places})
    return httpx.Response(200, json={})


def _nominatim(request: httpx.Request) -> httpx.Response:
    if request.url.params["q"] == "Ho Chi Minh City":
        return httpx.Response(200, json=[CITY_NODE])
    return httpx.Response(200, json=[])


@pytest.fixture
def api(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> Iterator[respx.MockRouter]:
    monkeypatch.setattr(ctx.secrets, "google_maps_key", "test-key")
    monkeypatch.setattr(ctx.config, "city", "Ho Chi Minh City")
    monkeypatch.setattr("tiktok_trip.http.RateLimiter.wait", lambda self: None)
    with respx.mock(assert_all_called=False) as router:
        router.post(TEXT_SEARCH_URL).mock(side_effect=_google)
        router.get(f"{NOMINATIM_URL}/search").mock(side_effect=_nominatim)
        router.get(PHOTON_URL).mock(return_value=httpx.Response(200, json={"features": []}))
        yield router


CANDIDATES = [
    candidate("Bánh mì Huỳnh Hoa", address="26 Lê Thị Riêng, Quận 1", video="v1", notes="đông"),
    candidate("Bánh mì Huỳnh Hoa", video="v2", must_try=["bánh mì đặc biệt"]),
    candidate("Phở Hòa", video="v3"),
    candidate("Ốc Đóng Cửa", video="v4"),
    candidate("Quán Không Tồn Tại", video="v5"),
]


def test_run_accepts_dedupes_and_reviews(ctx: Context, api: respx.MockRouter) -> None:
    save_models(ctx.paths.candidates_file, CANDIDATES)
    resolve.run(ctx)

    places = load_models(ctx.paths.places_file, Place)
    assert [p.id for p in places] == ["gp:HH1"]
    huynh_hoa = places[0]
    assert huynh_hoa.videos == [CANDIDATES[0].video_url, CANDIDATES[1].video_url]
    assert huynh_hoa.address_as_mentioned == "26 Lê Thị Riêng, Quận 1"
    assert huynh_hoa.address.startswith("26 Đ. Lê Thị Riêng")
    assert huynh_hoa.must_try == ["bánh mì đặc biệt"]
    assert huynh_hoa.notes == ["đông"]
    assert huynh_hoa.category.value == "food"
    assert huynh_hoa.priority == "high"
    assert huynh_hoa.priority_reason == "recommended in 2 posts"

    rows = {r.candidate.name: r for r in load_models(ctx.paths.review_file, ReviewRow)}
    assert rows["Phở Hòa"].reason == "ambiguous_branch"
    assert {o.place_id for o in rows["Phở Hòa"].options} == {"gp:PH1", "gp:PH2"}
    assert all(o.distance_km is not None and o.name_score for o in rows["Phở Hòa"].options)
    assert rows["Ốc Đóng Cửa"].reason == "closed"
    assert rows["Quán Không Tồn Tại"].reason == "not_found"

    with ctx.paths.review_csv.open(encoding="utf-8-sig") as handle:
        table = list(csv.DictReader(handle))
    assert list(table[0]) == list(resolve.REVIEW_CSV_HEADER)
    pho = next(r for r in table if r["name"] == "Phở Hòa")
    assert pho["option_1"].endswith("| gp:PH1") or pho["option_1"].endswith("| gp:PH2")
    assert pho["decision"] == ""


def test_nominatim_fallback_goes_to_review_not_places(ctx: Context, api: respx.MockRouter) -> None:
    poi = {
        "lat": "10.7800",
        "lon": "106.6990",
        "display_name": "Chè Bà Ba, Nguyễn Huệ, Phường Sài Gòn, Thành phố Hồ Chí Minh",
        "osm_type": "node",
        "osm_id": 42,
        "class": "amenity",
        "type": "restaurant",
    }

    def nominatim(request: httpx.Request) -> httpx.Response:
        if request.url.params["q"] == "Ho Chi Minh City":
            return httpx.Response(200, json=[CITY_NODE])
        return httpx.Response(200, json=[poi])

    api.get(f"{NOMINATIM_URL}/search").mock(side_effect=nominatim)
    save_models(ctx.paths.candidates_file, [candidate("Chè Bà Ba")])
    resolve.run(ctx)
    assert load_models(ctx.paths.places_file, Place) == []
    [row] = load_models(ctx.paths.review_file, ReviewRow)
    assert row.reason == "low_confidence"
    assert [(o.place_id, o.name) for o in row.options] == [("osm:node/42", "Chè Bà Ba")]

    save_models(ctx.paths.review_file, [row.model_copy(update={"decision": "osm:node/42"})])
    resolve.run(ctx)
    places = load_models(ctx.paths.places_file, Place)
    assert [(p.id, p.confidence) for p in places] == [("osm:node/42", 1.0)]


def test_rerun_honours_decisions_and_preserves_enrichment(
    ctx: Context, api: respx.MockRouter
) -> None:
    save_models(ctx.paths.candidates_file, CANDIDATES)
    resolve.run(ctx)
    google_calls = api.routes[0].call_count

    places = load_models(ctx.paths.places_file, Place)
    enriched = places[0].model_copy(
        update={
            "rating": 4.4,
            "hours": Hours(),
            "status": "visited",
            "best_time": BestTime(hours="17:00–20:00", source="heuristic"),
        }
    )
    save_models(ctx.paths.places_file, [enriched])

    rows = load_models(ctx.paths.review_file, ReviewRow)
    decisions = {"Phở Hòa": "gp:PH2", "Ốc Đóng Cửa": "skip"}
    decided = [r.model_copy(update={"decision": decisions.get(r.candidate.name)}) for r in rows]
    save_models(ctx.paths.review_file, decided)

    resolve.run(ctx)
    assert api.routes[0].call_count == google_calls

    by_id = {p.id: p for p in load_models(ctx.paths.places_file, Place)}
    assert set(by_id) == {"gp:HH1", "gp:PH2"}
    assert by_id["gp:HH1"].rating == 4.4
    assert by_id["gp:HH1"].status == "visited"
    assert by_id["gp:HH1"].best_time is not None
    assert by_id["gp:PH2"].confidence == 1.0
    assert by_id["gp:PH2"].name == "Phở Hòa"

    rows_after = {r.candidate.name: r for r in load_models(ctx.paths.review_file, ReviewRow)}
    assert rows_after["Phở Hòa"].decision == "gp:PH2"
    assert rows_after["Ốc Đóng Cửa"].decision == "skip"
    assert rows_after["Quán Không Tồn Tại"].decision is None


def test_best_time_dropped_when_new_video_mentions_place(
    ctx: Context, api: respx.MockRouter
) -> None:
    save_models(ctx.paths.candidates_file, CANDIDATES[:1])
    resolve.run(ctx)
    place = load_models(ctx.paths.places_file, Place)[0]
    timed = place.model_copy(
        update={"best_time": BestTime(hours="06:00–08:00", source="heuristic")}
    )
    save_models(ctx.paths.places_file, [timed])

    save_models(ctx.paths.candidates_file, CANDIDATES[:2])
    resolve.run(ctx)
    place = load_models(ctx.paths.places_file, Place)[0]
    assert place.mention_count == 2
    assert place.best_time is None


def test_run_without_candidates_keeps_places(ctx: Context) -> None:
    existing = resolve.place_from_match(candidate("Ốc Oanh"), match("gp:1", "Ốc Oanh"), 0.9)
    save_models(ctx.paths.places_file, [existing])
    resolve.run(ctx)
    assert load_models(ctx.paths.places_file, Place) == [existing]


def test_api_error_stops_resolve_after_scoring_the_rest(
    ctx: Context, api: respx.MockRouter
) -> None:
    error = {"error": {"code": 400, "message": "API key not valid.", "status": "INVALID_ARGUMENT"}}
    queries: list[str] = []

    def google(request: httpx.Request) -> httpx.Response:
        query = json.loads(request.content)["textQuery"]
        queries.append(query)
        if query.startswith("Quán Lỗi"):
            return httpx.Response(400, json=error)
        return _google(request)

    api.post(TEXT_SEARCH_URL).mock(side_effect=google)
    existing = resolve.place_from_match(candidate("Ốc Oanh"), match("gp:1", "Ốc Oanh"), 0.9)
    save_models(ctx.paths.places_file, [existing])
    failing = candidate("Quán Lỗi", video="v9")
    save_models(ctx.paths.candidates_file, [failing, *CANDIDATES])

    with pytest.raises(UserFacingError) as caught:
        resolve.run(ctx)

    message = str(caught.value)
    assert "1 of 6 candidate(s)" in message
    assert failing.key in message
    assert "API key not valid." in message
    assert "400" in message
    assert {q.split(" ")[0] for q in queries} >= {"Quán", "Bánh", "Phở", "Ốc"}
    assert any(q.startswith("Bánh mì Huỳnh Hoa") for q in queries)
    assert load_models(ctx.paths.places_file, Place) == [existing]
    assert not ctx.paths.review_file.exists()
    with ctx.paths.api_log.open(encoding="utf-8") as handle:
        notes = [row["note"] for row in csv.DictReader(handle)]
    assert any("error 400" in note for note in notes)


def test_quota_stop_leaves_places_untouched_and_sends_nothing(
    ctx: Context, api: respx.MockRouter
) -> None:
    capped = QuotaGuard(QuotaConfig(monthly={"text_search_pro": 0}), ctx.api_log)
    limited = dataclasses.replace(ctx, quota=capped)
    existing = resolve.place_from_match(candidate("Ốc Oanh"), match("gp:1", "Ốc Oanh"), 0.9)
    save_models(ctx.paths.places_file, [existing])
    save_models(ctx.paths.candidates_file, CANDIDATES)

    with pytest.raises(QuotaExceededError, match="text_search_pro"):
        resolve.run(limited)

    assert not [c for c in api.calls if c.request.url.host == "places.googleapis.com"]
    assert load_models(ctx.paths.places_file, Place) == [existing]
    assert not ctx.paths.review_file.exists()


def test_search_query_appends_city_only_when_address_lacks_it() -> None:
    dalat = candidate("Bún Bò Cô Bê", address="Hẻm 2 Khởi Nghĩa Bắc Sơn, Đà Lạt")
    assert resolve.search_query(dalat, "Đà Lạt") == "Bún Bò Cô Bê Hẻm 2 Khởi Nghĩa Bắc Sơn, Đà Lạt"
    folded = candidate("Bún Bò Cô Bê", address="Hẻm 2 Khởi Nghĩa Bắc Sơn, da lat")
    assert resolve.search_query(folded, "Đà Lạt").endswith("da lat")
    other = candidate("Phở", address="12 Phan Đình Phùng, Bảo Lộc")
    assert resolve.search_query(other, "Đà Lạt") == "Phở 12 Phan Đình Phùng, Bảo Lộc Đà Lạt"
    assert resolve.search_query(candidate("Phở Hòa"), "Đà Lạt") == "Phở Hòa Đà Lạt"


def test_exclusion_applies_folded_whole_words_to_other_candidates_only() -> None:
    keywords = ResolveConfig().exclude_keywords

    def other(name: str, notes: str | None = None) -> Candidate:
        return candidate(name, notes=notes).model_copy(update={"category": Category.OTHER})

    assert resolve.exclusion_reason(other("Moonhill HOMESTAY"), keywords) == (
        "keyword 'homestay' in name"
    )
    assert resolve.exclusion_reason(other("Ks Thiên Trang", "KHACH SAN gần chợ"), keywords) == (
        "keyword 'khách sạn' in notes"
    )
    assert resolve.exclusion_reason(other("T-Motor"), keywords) == "keyword 'motor' in name"
    assert resolve.exclusion_reason(other("Thuê Xe Thu Hiền"), keywords) is not None
    assert resolve.exclusion_reason(other("Business Café"), keywords) is None
    assert resolve.exclusion_reason(other("Tsuki Spa", "spa"), keywords) is None
    food = candidate("Hotel Cafe Bánh Căn").model_copy(update={"category": Category.FOOD})
    assert resolve.exclusion_reason(food, keywords) is None
    assert resolve.exclusion_reason(other("Moonhill homestay"), []) is None


def test_run_skips_excluded_candidates_before_any_api_call(
    ctx: Context, api: respx.MockRouter
) -> None:
    lodging = candidate("Lagom Homestay", video="v7", notes="Chỗ ở")
    rental = candidate("Tiệm Chaiko", video="v8", notes="Dịch vụ (THUÊ ĐỒ)")
    save_models(ctx.paths.candidates_file, [lodging, rental, CANDIDATES[0]])

    resolve.run(ctx)

    queries = [
        json.loads(c.request.content)["textQuery"]
        for c in api.calls
        if c.request.url.host == "places.googleapis.com"
    ]
    assert queries and all(q.startswith("Bánh mì Huỳnh Hoa") for q in queries)
    assert [p.id for p in load_models(ctx.paths.places_file, Place)] == ["gp:HH1"]
    assert load_models(ctx.paths.review_file, ReviewRow) == []
    assert load_models(ctx.paths.excluded_file, ExcludedCandidate) == [
        ExcludedCandidate(
            key=lodging.key, name="Lagom Homestay", reason="keyword 'homestay' in name"
        ),
        ExcludedCandidate(key=rental.key, name="Tiệm Chaiko", reason="keyword 'thuê đồ' in notes"),
    ]


def test_run_applies_preferences(
    ctx: Context, api: respx.MockRouter, caplog: pytest.LogCaptureFixture
) -> None:
    save_models(ctx.paths.candidates_file, CANDIDATES[:2])
    ctx.paths.preferences_file.write_text(
        "must_go: [Bánh mì Huỳnh Hoa, Không Có Quán Này]\nremoved: []\n", encoding="utf-8"
    )
    with caplog.at_level("WARNING"):
        resolve.run(ctx)
    (place,) = load_models(ctx.paths.places_file, Place)
    assert (place.priority, place.preference, place.status) == ("must", "must_go", "todo")
    assert "'Không Có Quán Này' matches no place" in caplog.text

    ctx.paths.preferences_file.write_text("removed: [gp:HH1]\n", encoding="utf-8")
    resolve.run(ctx)
    (place,) = load_models(ctx.paths.places_file, Place)
    assert (place.priority, place.preference, place.status) == ("high", "removed", "skip")

    ctx.paths.preferences_file.unlink()
    resolve.run(ctx)
    (place,) = load_models(ctx.paths.places_file, Place)
    assert (place.preference, place.status) == (None, "todo")
