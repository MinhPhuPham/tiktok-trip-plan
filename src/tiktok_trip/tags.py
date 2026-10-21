"""Place tags: what a place is good for (which meal, which kind of café or sight).

Tags are lower-case ids from a fixed vocabulary (`TAGS`); exporters translate them through
`Labels.tags`. They come from table-driven rules over the name, must-try dishes and notes
(Vietnamese with diacritics, or plain ASCII folded), a `meal:` hint in the notes, the opening
hours and an evidence-based best time. Each tag also has heuristic best-time windows
(`TAG_WINDOWS`) that besttime.py uses when no post says when to go.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from tiktok_trip.clock import DAY_MINUTES, EN_DASH, to_minutes, wall_clock
from tiktok_trip.matching import fold
from tiktok_trip.models import BestTime, Category, Hours, Place

Window = tuple[int, int]

TAGS: tuple[str, ...] = (
    "breakfast",
    "lunch",
    "dinner",
    "snack",
    "late_night",
    "view",
    "dessert",
    "garden",
    "work_friendly",
    "sunset",
    "sunrise",
    "cloud_hunting",
    "photo_spot",
    "family",
    "nature",
    "history",
    "shopping",
    "service",
)
MEAL_TAGS = frozenset({"breakfast", "lunch", "dinner", "snack", "late_night"})

HINT, STRONG, KEYWORD = 3, 2, 1
"""Rule strength: an explicit `meal:` hint, then hours / evidence / meal phrases, then keywords."""

BEST_TIME_ORDER: tuple[str, ...] = (
    "cloud_hunting",
    "sunrise",
    "sunset",
    "breakfast",
    "dinner",
    "lunch",
    "late_night",
    "snack",
    "view",
    "dessert",
    "work_friendly",
    "photo_spot",
    "garden",
    "nature",
    "history",
    "family",
    "shopping",
    "service",
)
"""Which tag picks the best time when strengths tie."""


def _hm(text: str) -> int:
    return to_minutes(text)


TAG_WINDOWS: dict[str, tuple[Window, ...]] = {
    "breakfast": ((_hm("06:30"), _hm("09:00")),),
    "lunch": ((_hm("11:30"), _hm("13:00")),),
    "dinner": ((_hm("17:30"), _hm("20:00")),),
    "snack": ((_hm("15:00"), _hm("17:00")), (_hm("18:00"), _hm("21:00"))),
    "late_night": ((_hm("21:00"), _hm("23:30")),),
    "view": ((_hm("15:00"), _hm("17:30")),),
    "dessert": ((_hm("15:00"), _hm("17:00")), (_hm("18:00"), _hm("21:00"))),
    "garden": ((_hm("08:00"), _hm("11:00")),),
    "work_friendly": ((_hm("09:00"), _hm("11:30")),),
    "sunset": ((_hm("16:30"), _hm("18:00")),),
    "sunrise": ((_hm("04:30"), _hm("07:00")),),
    "cloud_hunting": ((_hm("04:30"), _hm("07:00")),),
    "photo_spot": ((_hm("08:00"), _hm("10:00")), (_hm("15:30"), _hm("17:30"))),
    "family": ((_hm("08:00"), _hm("11:00")),),
    "nature": ((_hm("08:00"), _hm("11:00")),),
    "history": ((_hm("08:30"), _hm("11:00")),),
    "shopping": ((_hm("18:00"), _hm("21:00")),),
    "service": ((_hm("14:00"), _hm("17:00")),),
}
"""Heuristic best-time windows per tag; the first one that fits the opening hours wins."""

TAG_WHY: dict[str, tuple[str, str]] = {
    "breakfast": ("breakfast place, early morning", "quán ăn sáng, đi sớm"),
    "lunch": ("lunch place, midday", "quán ăn trưa"),
    "dinner": ("dinner place, evening", "quán ăn tối"),
    "snack": ("snacks, afternoon or evening", "ăn vặt, chiều hoặc tối"),
    "late_night": ("late-night food", "ăn khuya"),
    "view": ("view, afternoon light", "view đẹp, nắng chiều"),
    "dessert": ("desserts, afternoon treat", "đồ ngọt, buổi chiều"),
    "garden": ("garden, cool morning", "sân vườn, sáng mát"),
    "work_friendly": ("work-friendly, quiet morning", "ngồi làm việc, sáng yên tĩnh"),
    "sunset": ("sunset view", "ngắm hoàng hôn"),
    "sunrise": ("sunrise, go at dawn", "ngắm bình minh, đi từ sớm"),
    "cloud_hunting": ("cloud hunting at dawn", "săn mây lúc bình minh"),
    "photo_spot": ("photo spot, soft light", "check-in, nắng dịu"),
    "family": ("family outing, cool morning", "đi chơi gia đình, sáng mát"),
    "nature": ("nature, cool morning", "thiên nhiên, sáng mát"),
    "history": ("historic site, before the midday heat", "di tích, trước trưa nắng"),
    "shopping": ("shopping, evening", "mua sắm, buổi tối"),
    "service": ("service, afternoon", "dịch vụ, buổi chiều"),
}
"""Short reason (EN, VI) a heuristic best time gives for its tag."""
CAFE_VIEW_WHY = ("view café, afternoon light", "cà phê view, nắng chiều")

FOOD = frozenset({Category.FOOD})
CAFE = frozenset({Category.CAFE})
EATS = frozenset({Category.FOOD, Category.CAFE})
SIGHTS = frozenset({Category.CAFE, Category.ATTRACTION})
SCENIC = frozenset({Category.FOOD, Category.CAFE, Category.ATTRACTION})
ATTRACTION = frozenset({Category.ATTRACTION})
OUTINGS = frozenset({Category.ATTRACTION, Category.OTHER})
OTHER = frozenset({Category.OTHER})


@dataclass(frozen=True)
class KeywordRule:
    """Any of `words` ("|"-separated regex alternatives, whole words) in a place of `categories`."""

    tags: tuple[str, ...]
    categories: frozenset[Category]
    words: str
    strength: int = KEYWORD


KEYWORD_RULES: tuple[KeywordRule, ...] = (
    KeywordRule(("breakfast",), FOOD, "ăn sáng|bữa sáng|điểm tâm|breakfast", STRONG),
    KeywordRule(("lunch",), FOOD, "ăn trưa|bữa trưa|buổi trưa|lunch", STRONG),
    KeywordRule(("dinner",), FOOD, "ăn tối|bữa tối|buổi tối|dinner|supper", STRONG),
    KeywordRule(
        ("late_night",),
        EATS,
        "ăn khuya|ăn đêm|khuya|late[ -]night|midnight|thâu đêm|xuyên đêm",
        STRONG,
    ),
    KeywordRule(("late_night",), FOOD, "night|mở đêm|24/7", STRONG),
    KeywordRule(
        ("breakfast",),
        FOOD,
        (
            "bún|phở|bánh mì|xôi|cháo|bánh căn|bánh cuốn|bánh canh|bánh ướt|bánh bèo|hủ tiếu|"
            "hủ tíu|mì quảng|bò kho"
        ),
    ),
    KeywordRule(("lunch",), FOOD, "cơm|cơm tấm|cơm niêu|bún chả"),
    KeywordRule(
        ("dinner",),
        FOOD,
        (
            "lẩu|(?<!tráng )(?<!bắp )(?<!lang )nướng|bbq|buffet|nhà hàng|restaurant|hotpot|grill|"
            "ốc|nhậu|bia|beer|steak"
        ),
    ),
    KeywordRule(
        ("snack",),
        FOOD,
        (
            "bánh tráng|ăn vặt|snacks?|street food|bắp nướng|khoai lang nướng|xiên|chợ đêm|"
            "night market"
        ),
    ),
    KeywordRule(
        ("snack", "dessert"),
        FOOD,
        (
            "kem|sữa chua|chè|bánh su|bánh flan|flan|tàu hũ|tào phớ|bánh ngọt|desserts?|"
            "tráng miệng|ice cream|gelato|yogurt|bakery|tiệm bánh"
        ),
    ),
    KeywordRule(
        ("dessert",),
        CAFE,
        (
            "kem(?! (?:muối|trứng|béo|sữa))|sữa chua|chè|bánh su|bánh flan|flan|bánh ngọt|cakes?|"
            "desserts?|tráng miệng|tiramisu|croissants?|ice cream|gelato|bakery|tiệm bánh"
        ),
    ),
    KeywordRule(
        ("view",),
        SCENIC,
        (
            "view|ngắm|ngắm cảnh|rooftop|tầng thượng|sky ?bar|skydeck|đồi|đồi thông|rừng thông|"
            "thung lũng|toàn cảnh|panorama|đài quan sát|observation"
        ),
    ),
    KeywordRule(("sunset",), SCENIC, "hoàng hôn|sunset|chiều tà"),
    KeywordRule(("sunrise",), SIGHTS, "bình minh|sunrise|mặt trời mọc"),
    KeywordRule(
        ("cloud_hunting", "sunrise"),
        SIGHTS,
        "săn mây|biển mây|cloud hunting|cloud hunt|sea of clouds",
    ),
    KeywordRule(
        ("photo_spot",),
        SIGHTS,
        (
            "check[ -]?in|sống ảo|chụp ảnh|chụp hình|góc chụp|photo spot|photogenic|instagram|"
            "địa điểm check[ -]?in"
        ),
    ),
    KeywordRule(
        ("garden",),
        SCENIC,
        (
            "vườn|garden|farm|nông trại|vườn hoa|cánh đồng hoa|đồi hoa|săn hồng|cây hồng|dâu tây|"
            "strawberry|nhà kính|greenhouse"
        ),
    ),
    KeywordRule(
        ("work_friendly",),
        CAFE,
        "workspace|work space|làm việc|laptop|co-?working|học bài|ổ cắm|wifi|work[ -]friendly",
    ),
    KeywordRule(
        ("family",),
        OUTINGS,
        (
            "công viên|park|khu du lịch|khu vui chơi|vườn thú|sở thú|zoo|thủy cung|aquarium|"
            "trẻ em|gia đình|family|kids|máng trượt|trượt|alpine coaster"
        ),
    ),
    KeywordRule(
        ("nature",),
        ATTRACTION,
        (
            "thác|hồ(?! chí minh)|lake|rừng|forest|núi|mountain|suối|đồi|thung lũng|đèo|đỉnh|"
            "waterfall|hiking|trekking|langbiang|cắm trại|camping"
        ),
    ),
    KeywordRule(
        ("history",),
        ATTRACTION,
        (
            "dinh|chùa|nhà thờ|bảo tàng|museum|di tích|nhà ga|thiền viện|tu viện|lăng|đền|"
            "cathedral|church|pagoda|temple|palace|monastery|nhà cổ|phố cổ|làng cổ|biệt thự cổ|"
            "cổ kính|lịch sử|history|heritage"
        ),
    ),
    KeywordRule(
        ("shopping",),
        OUTINGS,
        (
            "chợ|chợ đêm|market|night market|mall|shopping|mua sắm|đặc sản|souvenirs?|quà|"
            "trung tâm thương mại|outlet"
        ),
    ),
    KeywordRule(
        ("service",),
        OTHER,
        (
            "spa|massage|gội đầu|head spa|xông hơi|nail|salon|thuê xe|rental|homestay|khách sạn|"
            "hotel|chỗ ở|resort|villa|lodging|dịch vụ|tour|studio"
        ),
    ),
)

MEAL_HINT = re.compile(r"\bmeal\s*:\s*([a-z_ ,/+&-]+)", re.IGNORECASE)
HINT_ALIASES: dict[str, tuple[str, ...]] = {
    "brunch": ("breakfast", "lunch"),
    "late night": ("late_night",),
    "late-night": ("late_night",),
    "night": ("late_night",),
    "snacks": ("snack",),
    "desserts": ("dessert",),
}

BREAKFAST_LATEST_OPEN = _hm("07:00")
BREAKFAST_LATEST_CLOSE = _hm("12:00")
DINNER_EARLIEST_OPEN = _hm("16:00")
LATE_NIGHT_OPEN = _hm("21:00")
LATE_NIGHT_CLOSE = _hm("23:30")
MIN_OVERLAP_MIN = 30
EVIDENCE_TAGS: tuple[tuple[Window, frozenset[Category], str], ...] = (
    ((0, _hm("07:00")), SIGHTS, "sunrise"),
    ((0, _hm("10:00")), FOOD, "breakfast"),
    ((_hm("10:30"), _hm("14:00")), FOOD, "lunch"),
    ((_hm("14:00"), _hm("17:00")), FOOD, "snack"),
    ((_hm("17:00"), _hm("21:00")), FOOD, "dinner"),
    ((_hm("21:00"), DAY_MINUTES * 2), FOOD, "late_night"),
)
"""Evidence best-time start in [lo, hi) for a category → tag."""
SUNSET_START = (_hm("16:30"), _hm("18:00"))
SUNSET_LATEST_END = _hm("19:00")
WINDOW_TEXT = re.compile(rf"(\d{{2}}:\d{{2}})\s*[{EN_DASH}-]\s*(\d{{2}}:\d{{2}})")


@dataclass(frozen=True)
class TagHit:
    tag: str
    reason: str
    strength: int


@dataclass(frozen=True)
class TagFacts:
    name: str
    category: Category
    must_try: tuple[str, ...] = ()
    notes: tuple[str, ...] = ()
    hours: Hours | None = None
    best_window: Window | None = None
    """Window of an evidence-based (or manual) best time; never a heuristic one."""
    viewpoints: tuple[str, ...] = field(default_factory=tuple)

    @classmethod
    def of(
        cls, place: Place, evidence: BestTime | None = None, viewpoints: Sequence[str] = ()
    ) -> TagFacts:
        best = evidence if evidence is not None and evidence.source != "heuristic" else None
        return cls(
            name=place.name,
            category=place.category,
            must_try=tuple(place.must_try),
            notes=tuple(place.notes),
            hours=place.hours,
            best_window=parse_window(best.hours) if best and best.hours else None,
            viewpoints=tuple(viewpoints),
        )


def parse_window(text: str) -> Window | None:
    match = WINDOW_TEXT.fullmatch(text.strip())
    if not match:
        return None
    start, end = to_minutes(match[1]), to_minutes(match[2])
    return (start, end if end > start else end + DAY_MINUTES)


def _pattern(words: Iterable[str]) -> re.Pattern[str]:
    alternatives = "|".join(sorted(words, key=len, reverse=True))
    return re.compile(rf"(?<!\w)(?:{alternatives})(?!\w)")


def _alternatives(words: str) -> list[str]:
    """Split "a|b(?! c|d)" on top-level bars only."""
    parts, depth, current = [], 0, ""
    for char in words:
        depth += char == "("
        depth -= char == ")"
        if char == "|" and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += char
    return [*parts, current]


@dataclass(frozen=True)
class _Compiled:
    rule: KeywordRule
    accented: re.Pattern[str]
    folded: re.Pattern[str]


_COMPILED = tuple(
    _Compiled(rule, _pattern(words), _pattern(fold(word) for word in words))
    for rule in KEYWORD_RULES
    for words in [_alternatives(rule.words)]
)


def _fields(facts: TagFacts) -> list[tuple[str, str]]:
    """(label, lower-case NFC text) of every field keywords are read from."""
    named = [("name", facts.name), *(("must try", t) for t in facts.must_try)]
    named += [("notes", t) for t in facts.notes]
    return [(label, unicodedata.normalize("NFC", text.lower())) for label, text in named if text]


def _search(compiled: _Compiled, text: str) -> str | None:
    """The matched word; ASCII-only text (no diacritics) is matched against folded keywords."""
    found = (compiled.folded if text.isascii() else compiled.accented).search(text)
    return found[0] if found else None


def keyword_hits(facts: TagFacts) -> list[TagHit]:
    hits: list[TagHit] = []
    fields = _fields(facts)
    for compiled in _COMPILED:
        if facts.category not in compiled.rule.categories:
            continue
        for label, text in fields:
            if word := _search(compiled, text):
                reason = f'"{word}" in {label}'
                hits.extend(
                    TagHit(tag, reason, compiled.rule.strength) for tag in compiled.rule.tags
                )
                break
    if facts.category is Category.ATTRACTION and facts.viewpoints:
        viewpoint = _pattern(re.escape(v.lower()) for v in facts.viewpoints)
        if found := viewpoint.search(unicodedata.normalize("NFC", facts.name.lower())):
            hits.append(TagHit("view", f'viewpoint "{found[0]}"', KEYWORD))
    return hits


def hint_hits(notes: Sequence[str]) -> list[TagHit]:
    """`meal: breakfast` (or `meal: lunch, dinner`) written in the notes by the manual list."""
    hits: list[TagHit] = []
    for note in notes:
        for found in MEAL_HINT.finditer(note):
            for raw in re.split(r"[,/+&]|\band\b", found[1].lower()):
                value = raw.strip()
                tags = hint_tags(value) or hint_tags(value.split(" ", 1)[0])
                hits.extend(TagHit(tag, f"meal: {value}", HINT) for tag in tags)
    return hits


def hint_tags(value: str) -> tuple[str, ...]:
    if value in HINT_ALIASES:
        return HINT_ALIASES[value]
    tag = value.replace(" ", "_").replace("-", "_")
    return (tag,) if tag in TAGS else ()


def opening_spans(hours: Hours | None) -> list[Window] | None:
    """(open, close) minutes per period, a close past midnight above 24:00.

    None when the hours are unknown or a period never closes (any time fits).
    """
    if hours is None or not hours.periods or any(p.close is None for p in hours.periods):
        return None
    spans: list[Window] = []
    for period in hours.periods:
        start, end = to_minutes(period.open), to_minutes(period.close or period.open)
        spans.append((start, end if end > start else end + DAY_MINUTES))
    return spans


def hours_hits(facts: TagFacts) -> list[TagHit]:
    """Meal tags from the most common opening period (food; late night for cafés too)."""
    spans = opening_spans(facts.hours)
    if not spans or facts.category not in EATS:
        return []
    start, end = Counter(spans).most_common(1)[0][0]
    hits: list[TagHit] = []
    opens, closes = f"opens {wall_clock(start)}", f"closes {wall_clock(end)}"
    if facts.category is Category.FOOD:
        if start <= BREAKFAST_LATEST_OPEN and end <= BREAKFAST_LATEST_CLOSE:
            hits.append(TagHit("breakfast", f"{opens}, {closes}", STRONG))
        if start >= DINNER_EARLIEST_OPEN:
            hits.append(TagHit("dinner", opens, STRONG))
    if start >= LATE_NIGHT_OPEN or end >= LATE_NIGHT_CLOSE:
        hits.append(TagHit("late_night", closes if end >= LATE_NIGHT_CLOSE else opens, STRONG))
    return hits


def evidence_hits(facts: TagFacts) -> list[TagHit]:
    """Tags read from a best time that a post or a person gave (never from a heuristic one)."""
    if facts.best_window is None:
        return []
    start, end = facts.best_window
    reason = f"best time {wall_clock(start)}"
    hits = [
        TagHit(tag, reason, STRONG)
        for (lo, hi), categories, tag in EVIDENCE_TAGS
        if facts.category in categories and lo <= start < hi
    ]
    if (
        facts.category in SIGHTS
        and SUNSET_START[0] <= start < SUNSET_START[1]
        and end <= SUNSET_LATEST_END
    ):
        hits.append(TagHit("sunset", reason, STRONG))
    return hits


def overlaps_hours(window: Window, hours: Hours | None) -> bool:
    """True when the window meets an opening period for MIN_OVERLAP_MIN minutes (or no hours)."""
    spans = opening_spans(hours)
    if spans is None:
        return True
    for start, end in spans:
        for shift in (0, DAY_MINUTES):
            if min(window[1] + shift, end) - max(window[0] + shift, start) >= MIN_OVERLAP_MIN:
                return True
    return False


def _fallback_meals(facts: TagFacts) -> list[TagHit]:
    """Food with no meal signal: lunch and/or dinner when the opening hours cover them."""
    if facts.category is not Category.FOOD or opening_spans(facts.hours) is None:
        return []
    return [
        TagHit(tag, "open at that time", KEYWORD)
        for tag in ("lunch", "dinner")
        if all(overlaps_hours(window, facts.hours) for window in TAG_WINDOWS[tag])
    ]


def tag_hits(facts: TagFacts) -> list[TagHit]:
    """One hit per tag (the strongest), best-time candidates first: strength, then BEST_TIME_ORDER.

    Meal tags whose windows never meet the opening hours are dropped (a phở place that opens at
    17:00 is not breakfast).
    """
    found = [
        *hint_hits(facts.notes),
        *hours_hits(facts),
        *evidence_hits(facts),
        *keyword_hits(facts),
    ]
    found = [
        hit
        for hit in found
        if hit.tag not in MEAL_TAGS
        or hit.strength >= HINT
        or any(overlaps_hours(window, facts.hours) for window in TAG_WINDOWS[hit.tag])
    ]
    if not any(hit.tag in MEAL_TAGS for hit in found):
        found += _fallback_meals(facts)
    best: dict[str, TagHit] = {}
    for hit in found:
        if hit.tag not in best or hit.strength > best[hit.tag].strength:
            best[hit.tag] = hit
    return sorted(best.values(), key=lambda h: (-h.strength, BEST_TIME_ORDER.index(h.tag)))


def sort_tags(tags: Iterable[str]) -> list[str]:
    """Known tags in vocabulary order, without duplicates."""
    wanted = set(tags)
    return [tag for tag in TAGS if tag in wanted]


def derive_tags(facts: TagFacts) -> list[str]:
    return sort_tags(hit.tag for hit in tag_hits(facts))


def tag_why(tag: str, category: Category) -> tuple[str, str]:
    """(EN, VI) reason a heuristic best time gives for its tag."""
    if tag == "view" and category is Category.CAFE:
        return CAFE_VIEW_WHY
    return TAG_WHY[tag]
