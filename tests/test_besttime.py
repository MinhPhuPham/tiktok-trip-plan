# ruff: noqa: RUF001
from typing import cast

from tiktok_trip.besttime import (
    DEFAULT_RULES,
    PlaceFacts,
    SourceText,
    TextSource,
    category_rule,
    clamp_window,
    suggest,
    text_rule,
)
from tiktok_trip.config import CityProfile
from tiktok_trip.models import BestTime, Category, Hours, OpeningPeriod
from tiktok_trip.routing.windows import arrival_windows

HCMC_DRY_SEASON = CityProfile().best_months
DA_LAT = CityProfile(
    aliases=["Đà Lạt", "Da Lat", "Dalat", "Lâm Đồng", "Lam Dong"],
    best_months="Nov–Apr",
    best_months_note="dry season",
    viewpoints=["Langbiang"],
)


def hours(open_: str, close: str | None, days: range = range(7)) -> Hours:
    return Hours(periods=[OpeningPeriod(day=d, open=open_, close=close) for d in days])


def facts(
    name: str = "Quán X",
    category: Category = Category.FOOD,
    *texts: tuple[str, str],
    opening: Hours | None = None,
    must_try: tuple[str, ...] = (),
    profile: CityProfile | None = None,
) -> PlaceFacts:
    return PlaceFacts(
        name=name,
        category=category,
        must_try=must_try,
        hours=opening,
        texts=tuple(SourceText(cast(TextSource, src), text) for src, text in texts),
        profile=profile or CityProfile(),
    )


def test_comment_evening_beats_heuristic_and_keeps_quote() -> None:
    result = suggest(facts("Phở Bò", Category.FOOD, ("comments", "Đi tối mới ngon nha mọi người")))
    assert result is not None
    assert result.source == "comments"
    assert result.hours == "17:00–20:00"
    assert result.evidence is not None
    assert '"Đi tối mới ngon nha mọi người" (comments)' in result.evidence
    assert result.months == HCMC_DRY_SEASON
    assert "months from heuristic" in result.evidence


def test_false_friends_do_not_match() -> None:
    texts = [("comments", "Ánh sáng đẹp, giá tối thiểu 50k, mùa đông se lạnh")]
    assert text_rule(facts("X", Category.FOOD, *texts)) is None


def test_weekend_crowd_means_weekday() -> None:
    result = text_rule(facts("X", Category.FOOD, ("comments", "Cuối tuần phải xếp hàng dài")))
    assert result is not None
    assert result.days == "weekday"
    assert result.evidence is not None
    assert "avoid peak" in result.evidence


def test_weekend_without_crowd_means_weekend() -> None:
    result = text_rule(facts("X", Category.FOOD, ("caption", "Chỉ bán cuối tuần thôi")))
    assert result is not None
    assert (result.days, result.source) == ("weekend", "caption")


def test_sold_out_sets_deadline_two_hours_after_opening() -> None:
    result = suggest(
        facts(
            "Bánh Mì Hòa Mã",
            Category.FOOD,
            ("comments", "Đi sớm kẻo bán hết đó"),
            opening=hours("06:00", "11:00"),
        )
    )
    assert result is not None
    assert result.deadline == "08:00"
    assert result.hours == "06:00–08:00"


def test_sold_out_without_hours_breakfast_deadline() -> None:
    result = text_rule(facts("Xôi Gà", Category.FOOD, ("comments", "sold out by 9am, go early")))
    assert result is not None
    assert result.deadline == "10:00"


def test_votes_pick_most_mentioned_slot() -> None:
    result = text_rule(
        facts(
            "X",
            Category.FOOD,
            ("comments", "trưa ghé cũng được"),
            ("comments", "tối đông vui"),
            ("comments", "buổi tối lung linh"),
        )
    )
    assert result is not None
    assert result.hours == "17:00–20:00"


def test_months_from_comments() -> None:
    result = text_rule(facts("X", Category.ATTRACTION, ("comments", "Tháng 12 đi là đẹp nhất")))
    assert result is not None
    assert result.months == "Dec"


def test_category_heuristics() -> None:
    def hours_for(name: str, category: Category, opening: Hours | None = None) -> str | None:
        result = category_rule(facts(name, category, opening=opening))
        assert result is not None
        assert result.source == "heuristic"
        assert result.months == HCMC_DRY_SEASON
        window: str | None = result.hours
        return window

    assert hours_for("Phở Hòa Pasteur", Category.FOOD) == "06:30–09:30"
    assert hours_for("Ốc Oanh", Category.FOOD) == "17:00–20:00"
    assert hours_for("Cộng Cà Phê", Category.CAFE) == "09:00–11:00"
    assert hours_for("Cafe Late", Category.CAFE, hours("13:00", "23:00")) == "15:00–17:00"
    assert hours_for("Saigon Skydeck", Category.ATTRACTION) == "17:00–18:30"
    assert hours_for("Dinh Độc Lập", Category.ATTRACTION) == "08:00–10:30"
    assert hours_for("Chợ Bến Thành", Category.OTHER) == "09:00–11:00"


def test_breakfast_dish_from_must_try_without_diacritics() -> None:
    result = category_rule(facts("Quan 79", Category.FOOD, must_try=("pho bo tai",)))
    assert result is not None
    assert result.hours == "06:30–09:30"


def test_heuristic_window_is_clamped_to_opening_hours_with_note() -> None:
    result = suggest(facts("Ốc Oanh", Category.FOOD, opening=hours("18:00", "02:00")))
    assert result is not None
    assert result.hours == "18:00–20:00"
    assert result.source == "heuristic"
    assert result.evidence is not None
    assert "adjusted to opening hours" in result.evidence


def test_clamp_window_falls_back_to_opening_when_no_overlap() -> None:
    assert clamp_window((17 * 60, 20 * 60), hours("06:00", "10:00"), None) == (360, 540)
    assert clamp_window((17 * 60, 20 * 60), hours("00:00", None), None) == (1020, 1200)
    assert clamp_window((17 * 60, 20 * 60), None, None) == (1020, 1200)


def test_clamp_uses_weekend_periods_when_days_is_weekend() -> None:
    opening = Hours(
        periods=[
            *[OpeningPeriod(day=d, open="07:00", close="11:00") for d in range(5)],
            *[OpeningPeriod(day=d, open="16:00", close="22:00") for d in (5, 6)],
        ]
    )
    assert clamp_window((17 * 60, 20 * 60), opening, "weekend") == (17 * 60, 20 * 60)
    assert clamp_window((17 * 60, 20 * 60), opening, "weekday") == (420, 600)


def test_custom_rule_takes_precedence() -> None:
    def llm_rule(_: PlaceFacts) -> BestTime | None:
        return BestTime(hours="10:00–12:00", source="comments", evidence='"x" (llm)')

    result = suggest(facts("Ốc Oanh", Category.FOOD), rules=(llm_rule, *DEFAULT_RULES))
    assert result is not None
    assert (result.hours, result.source) == ("10:00–12:00", "comments")
    assert result.months == HCMC_DRY_SEASON


def test_no_rules_no_result() -> None:
    assert suggest(facts(), rules=()) is None


def test_late_opener_deadline_never_wraps_past_midnight() -> None:
    sold_out = ("comments", "kẻo hết nha")
    late = suggest(
        facts("Bánh Tráng Nướng", Category.FOOD, sold_out, opening=hours("23:00", "03:00"))
    )
    assert late is not None
    assert late.deadline == "23:59"
    windows = arrival_windows(hours("23:00", "03:00"), late, 5, 30, (0, 24 * 60))
    assert windows, "the place must stay routable"

    closes_early = suggest(
        facts("Chè Khuya", Category.FOOD, sold_out, opening=hours("22:00", "23:00"))
    )
    assert closes_early is not None
    assert closes_early.deadline == "23:00"


def test_city_profile_drives_heuristic_months_and_evidence() -> None:
    hcmc = category_rule(facts("Dinh Độc Lập", Category.ATTRACTION))
    dalat = category_rule(facts("Thung Lũng Tình Yêu", Category.ATTRACTION, profile=DA_LAT))
    assert hcmc is not None and dalat is not None
    assert hcmc.months == "Dec–Apr"
    assert hcmc.evidence is not None and "Hồ Chí Minh dry season" in hcmc.evidence
    assert dalat.months == "Nov–Apr"
    assert dalat.evidence is not None and "Đà Lạt dry season" in dalat.evidence


def test_city_profile_viewpoints_and_dry_season_text() -> None:
    peak = category_rule(facts("Đỉnh Langbiang", Category.ATTRACTION, profile=DA_LAT))
    assert peak is not None and peak.hours == "17:00–18:30"
    elsewhere = category_rule(facts("Đỉnh Langbiang", Category.ATTRACTION))
    assert elsewhere is not None and elsewhere.hours == "08:00–10:30"
    landmark = category_rule(facts("Landmark 81", Category.ATTRACTION))
    assert landmark is not None and landmark.hours == "17:00–18:30"

    said = ("comments", "Đi mùa khô là đẹp nhất")
    dalat = text_rule(facts("X", Category.ATTRACTION, said, profile=DA_LAT))
    assert dalat is not None and dalat.months == "Nov–Apr"
    hcmc = text_rule(facts("X", Category.ATTRACTION, said))
    assert hcmc is not None and hcmc.months == "Dec–Apr"


BUN_BO_HOURS = hours("06:30", "15:00")
BUN_BO_CAPTION = "Người SG dắt đi ăn bún bò view rừng thông mở tới 15h chiều #dalat #bunbocobe"


def test_closing_time_phrase_is_not_a_best_time() -> None:
    caption_only = facts("Bún Bò Cô Bê", Category.FOOD, ("caption", BUN_BO_CAPTION))
    assert text_rule(caption_only) is None
    result = suggest(
        PlaceFacts(
            name="Bún Bò Cô Bê",
            category=Category.FOOD,
            hours=BUN_BO_HOURS,
            texts=(SourceText("caption", BUN_BO_CAPTION),),
        )
    )
    assert result is not None
    assert result.source == "heuristic"
    assert result.hours == "06:30–09:30"


def test_other_opening_hours_phrases_are_masked() -> None:
    for text in (
        "mở cửa từ 6h30 sáng đến 3h chiều",
        "đóng cửa lúc 10h tối",
        "bán tới 2h trưa thôi",
        "open until 3pm",
        "closes at 9 pm",
    ):
        assert text_rule(facts("Quán X", Category.FOOD, ("caption", text))) is None, text


def test_creator_visit_time_beats_caption_and_other_commenters() -> None:
    result = suggest(
        PlaceFacts(
            name="Bún Bò Cô Bê",
            category=Category.FOOD,
            hours=BUN_BO_HOURS,
            texts=(
                SourceText("caption", BUN_BO_CAPTION, creator=True),
                SourceText("comments", "mình đi lúc 2h chiều vẫn còn"),
                SourceText("comments", "Tui ăn lúc 8h sáng á", creator=True),
            ),
        )
    )
    assert result is not None
    assert result.source == "comments"
    assert result.hours == "07:00–09:00"
    assert result.evidence is not None
    assert result.evidence.startswith('"Tui ăn lúc 8h sáng á" (comments)')


def test_visit_time_beats_day_part_words_and_is_clamped_to_hours() -> None:
    result = suggest(
        PlaceFacts(
            name="Quán Y",
            category=Category.FOOD,
            hours=hours("17:00", "22:00"),
            texts=(
                SourceText("comments", "chiều đi cho mát"),
                SourceText("comments", "đi lúc 5h chiều là vừa"),
            ),
        )
    )
    assert result is not None
    assert result.hours == "17:00–18:00"
    assert '"đi lúc 5h chiều là vừa" (comments)' in (result.evidence or "")


def test_chieu_toi_is_late_afternoon_not_afternoon_or_evening() -> None:
    for phrase in ("Ghé chiều tối ngồi chill", "xế chiều ra đây là đẹp nhất"):
        result = text_rule(facts("X", Category.CAFE, ("comments", phrase)))
        assert result is not None
        assert result.hours == "16:30–19:30"
        assert result.why == "comments: late afternoon into evening"
        assert result.why_vi == "bình luận: chiều tối"


def test_sang_som_is_early_morning() -> None:
    result = text_rule(facts("X", Category.ATTRACTION, ("caption", "Đi sáng sớm săn mây")))
    assert result is not None
    assert result.hours == "05:30–08:00"
    assert result.why == "caption: early morning"


def test_compound_phrase_does_not_hide_a_separate_day_part() -> None:
    result = text_rule(
        facts(
            "X",
            Category.FOOD,
            ("comments", "chiều tối đông lắm"),
            ("comments", "buổi tối ăn ngon"),
            ("comments", "tối nay đi tiếp"),
        )
    )
    assert result is not None
    assert result.hours == "17:00–20:00"
