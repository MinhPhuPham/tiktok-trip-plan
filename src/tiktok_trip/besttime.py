"""Deterministic best-time suggestions from comments/captions, place tags, hours and category.

Rules are plain callables (`BestTimeRule`) tried in order; the first one that returns a
result is the primary source and later ones only fill fields it left empty. An LLM-backed
rule can be prepended to `DEFAULT_RULES` without changing the enrich step. Every result
carries a short reason in `why` (EN) and `why_vi` (VI).
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal, Protocol

from tiktok_trip.clock import DAY_MINUTES, EN_DASH, clamp_to_day, to_hhmm, to_minutes, wall_clock
from tiktok_trip.config import CityProfile
from tiktok_trip.matching import fold
from tiktok_trip.models import BestTime, Category, Hours, Place
from tiktok_trip.tags import TAG_WINDOWS, TagHit, overlaps_hours, tag_why

TextSource = Literal["comments", "caption", "transcript"]
Window = tuple[int, int]

WINDOWS: dict[str, Window] = {
    "early_morning": (5 * 60 + 30, 8 * 60),
    "breakfast": (6 * 60 + 30, 9 * 60 + 30),
    "morning": (7 * 60, 10 * 60),
    "attraction_morning": (8 * 60, 10 * 60 + 30),
    "cafe_morning": (9 * 60, 11 * 60),
    "noon": (11 * 60, 13 * 60),
    "afternoon": (14 * 60, 17 * 60),
    "late_afternoon": (16 * 60 + 30, 19 * 60 + 30),
    "cafe_afternoon": (15 * 60, 17 * 60),
    "sunset": (17 * 60, 18 * 60 + 30),
    "evening": (17 * 60, 20 * 60),
    "night": (20 * 60, 23 * 60),
    "daytime": (9 * 60, 11 * 60),
}
SOLD_OUT_HOURS_AFTER_OPEN = 2
BREAKFAST_DEADLINE = "10:00"
MIN_OVERLAP_MIN = 30
FALLBACK_WINDOW_MIN = 180
WEEKEND_DAYS = frozenset({5, 6})
WEEKDAYS = frozenset({0, 1, 2, 3, 4})
QUOTE_CHARS = 120

COMPOUND_SLOT_PATTERNS: dict[str, re.Pattern[str]] = {
    "early_morning": re.compile(r"\bsáng sớm\b|\bearly morning\b"),
    "late_afternoon": re.compile(r"\bchiều tối\b|\bxế chiều\b|\bchiều muộn\b|\blate afternoon\b"),
}
"""Day-part phrases built from two simple ones; matched first and blanked before SLOT_PATTERNS."""
SLOT_PATTERNS: dict[str, re.Pattern[str]] = {
    "morning": re.compile(
        r"(?<!ánh )(?<!chiếu )\bsáng\b(?!\s+(?:tạo|kiến|lập|sủa|bóng|rực|trưng|choang|đèn))"
        r"|\bmorning\b|\bbreakfast\b"
    ),
    "noon": re.compile(r"\btrưa\b|\blunch\b|\bnoon\b"),
    "afternoon": re.compile(
        r"\bchiều\b(?!\s+(?:cao|dài|rộng|sâu|chuộng|lòng|khách|tà))|\bafternoon\b"
    ),
    "sunset": re.compile(r"hoàng hôn|chiều tà|\bsunset\b"),
    "evening": re.compile(
        r"\btối\b(?!\s+(?:thiểu|đa|ưu|tân|cổ|mật|om|thui|tăm|mò|giản))|\bevening\b|\bdinner\b"
    ),
    "night": re.compile(r"\bđêm\b|\bkhuya\b|\blate night\b|\bnight\b"),
}
WEEKEND = re.compile(r"cuối tuần|\bweekends?\b|thứ (?:7|bảy)|chủ nhật|\bt7\b")
WEEKDAY = re.compile(r"ngày thường|trong tuần|\bweekdays?\b")
CROWD = re.compile(
    r"xếp hàng|(?<!mùa )(?<!phía )(?<!hướng )\bđông\b(?!\s+(?:nam|bắc|á|dương|y))"
    r"|chen chúc|chờ lâu|đợi lâu|\bqueues?\b|\bcrowded\b|\bline up\b|\bbusy\b"
)
SOLD_OUT = re.compile(
    r"hết sớm|bán hết|hết hàng|hết món|hết veo|hết nhanh|kẻo hết|\bsold out\b|\bsells out\b"
)
MONTH_NUMBER = re.compile(r"tháng\s*(1[0-2]|[1-9])\b")
MONTH_NAMES = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
MONTH_WORD = re.compile(
    r"\b(january|february|march|april|june|july|august|september|october|november|december)\b"
)
DRY_SEASON = re.compile(r"mùa khô|\bdry season\b")

RULES_VERSION = 5
"""Bump when the rules change so stored computed suggestions are recomputed."""

DAYPART = r"(?:buổi\s+)?(?:sáng|trưa|chiều|tối|đêm|khuya)"
CLOCK = (
    r"(?P<hour>2[0-3]|[01]?\d)(?:\s*(?:h|g|giờ|:)\s*(?P<minute>[0-5]\d)?|\s*(?=am|pm))"
    rf"\s*(?P<ampm>am|pm)?(?:\s*(?P<part>{DAYPART}))?"
)
_CLOCK_BARE = re.sub(r"\(\?P<\w+>", "(?:", CLOCK)
HOURS_PHRASE = re.compile(
    r"(?:\bmở\s+(?:cửa|tới|đến|từ|lúc)|\bđóng\s+cửa|\bbán\s+(?:tới|đến|từ)"
    r"|\bopen(?:s|ing)?\b(?:\s+(?:hours|until|till|from|at|daily))?|\bclos(?:es|ing)\b)"
    rf"(?:\s*(?:từ|lúc|tới|đến|until|till|at|from|to|-|{EN_DASH})?\s*"
    rf"(?:{_CLOCK_BARE}|{DAYPART}))*"
)
"""Opening/closing statements: hours evidence, never a recommended visit time."""
VISIT_TIME = re.compile(
    r"\b(?:ăn|đi|tới|đến|ghé|qua|ngồi|uống|lên|ra|vào|went|go|came|arrived?|visit(?:ed)?)"
    r"\s+(?:(?:vào|hồi|khoảng|tầm)\s+)?(?:lúc|at|around)\s+(?:(?:khoảng|tầm)\s+)?" + CLOCK
)
VISIT_MARGIN_MIN = 60

BREAKFAST_DISHES = ("phở", "bún", "bánh mì", "xôi", "cháo")
VIEWPOINT_WORDS = (
    "rooftop",
    "sky",
    "view",
    "ngắm",
    "tầng thượng",
    "đài quan sát",
    "observation",
    "hoàng hôn",
    "sunset",
)
"""City-independent; famous viewpoints of a city come from CityProfile.viewpoints."""

SOURCE_WHY: dict[TextSource, tuple[str, str]] = {
    "comments": ("comments", "bình luận"),
    "caption": ("caption", "mô tả"),
    "transcript": ("video", "video"),
}
SLOT_WHY: dict[str, tuple[str, str]] = {
    "early_morning": ("early morning", "sáng sớm"),
    "morning": ("morning", "buổi sáng"),
    "noon": ("noon", "buổi trưa"),
    "afternoon": ("afternoon", "buổi chiều"),
    "late_afternoon": ("late afternoon into evening", "chiều tối"),
    "sunset": ("sunset", "hoàng hôn"),
    "evening": ("evening", "buổi tối"),
    "night": ("night", "ban đêm"),
}
DAY_WHY: dict[str, tuple[str, str]] = {
    "weekday": ("weekdays", "ngày thường"),
    "weekend": ("weekends", "cuối tuần"),
}
CROWD_WHY = ("crowded at peak times", "đông giờ cao điểm")
SOLD_OUT_WHY = ("sells out early", "hết sớm")


@dataclass(frozen=True)
class SourceText:
    source: TextSource
    text: str
    creator: bool = False
    scoped: bool = False
    """Kept because it names this place, from a post about several places."""


@dataclass(frozen=True)
class PlaceFacts:
    name: str
    category: Category
    must_try: tuple[str, ...] = ()
    hours: Hours | None = None
    texts: tuple[SourceText, ...] = field(default_factory=tuple)
    profile: CityProfile = field(default_factory=CityProfile)
    tags: tuple[TagHit, ...] = ()
    """Ranked tag hits (tags.tag_hits): the first one with a window drives the heuristic."""

    @classmethod
    def of(
        cls,
        place: Place,
        texts: Sequence[SourceText] = (),
        profile: CityProfile | None = None,
        tags: Sequence[TagHit] = (),
    ) -> PlaceFacts:
        return cls(
            name=place.name,
            category=place.category,
            must_try=tuple(place.must_try),
            hours=place.hours,
            texts=tuple(texts),
            profile=profile or CityProfile(),
            tags=tuple(tags),
        )


class BestTimeRule(Protocol):
    def __call__(self, facts: PlaceFacts, /) -> BestTime | None: ...


def format_window(window: Window) -> str:
    return f"{wall_clock(window[0])}{EN_DASH}{wall_clock(window[1])}"


def parse_window(text: str) -> Window | None:
    match = re.fullmatch(rf"(\d{{2}}:\d{{2}})\s*[{EN_DASH}-]\s*(\d{{2}}:\d{{2}})", text.strip())
    if not match:
        return None
    start, end = to_minutes(match[1]), to_minutes(match[2])
    return (start, end if end > start else end + DAY_MINUTES)


def _lower(text: str) -> str:
    return unicodedata.normalize("NFC", text.lower())


def quote(text: str, start: int, end: int) -> str:
    """The text around a match, trimmed to about QUOTE_CHARS characters."""
    left = max(0, (start + end) // 2 - QUOTE_CHARS // 2)
    right = min(len(text), left + QUOTE_CHARS)
    left = max(0, right - QUOTE_CHARS)
    snippet = " ".join(text[left:right].split())
    return f"{'…' if left else ''}{snippet}{'…' if right < len(text) else ''}"


@dataclass(frozen=True)
class Hit:
    value: str
    source: TextSource
    cite: str


def _hit(value: str, item: SourceText, original: str, match: re.Match[str]) -> Hit:
    label = f"{item.source} about this place" if item.scoped else item.source
    return Hit(value, item.source, f'"{quote(original, match.start(), match.end())}" ({label})')


def typical_open(hours: Hours | None) -> str | None:
    """Most common opening time, ignoring round-the-clock places."""
    if hours is None:
        return None
    opens = [p.open for p in hours.periods if not (p.open == "00:00" and p.close is None)]
    return Counter(opens).most_common(1)[0][0] if opens else None


def mentions_breakfast_dish(facts: PlaceFacts) -> str | None:
    text = _lower(" ".join([facts.name, *facts.must_try]))
    folded = text.isascii()
    for dish in BREAKFAST_DISHES:
        needle = fold(dish) if folded else dish
        if re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", text):
            return dish
    return None


def typical_close(hours: Hours | None, opening: str) -> int | None:
    """Most common close (minutes) of the periods opening at `opening`; > 24:00 when overnight."""
    if hours is None:
        return None
    start = to_minutes(opening)
    closes = [to_minutes(p.close) for p in hours.periods if p.open == opening and p.close]
    shifted = [end if end > start else end + DAY_MINUTES for end in closes]
    return Counter(shifted).most_common(1)[0][0] if shifted else None


def sold_out_deadline(start: int, close: int | None = None) -> str:
    """Two hours after opening, never after closing and never past 23:59 of the same day.

    The routing step reads the deadline as minutes since midnight, so a wrapped "01:00"
    for a 23:00 opener would read as "before 01:00" and drop the place.
    """
    deadline = start + SOLD_OUT_HOURS_AFTER_OPEN * 60
    if close is not None:
        deadline = min(deadline, close)
    return to_hhmm(clamp_to_day(deadline))


def early_deadline(facts: PlaceFacts, slot: str | None) -> str | None:
    opening = typical_open(facts.hours)
    if opening:
        return sold_out_deadline(to_minutes(opening), typical_close(facts.hours, opening))
    if slot in {"early_morning", "morning", "breakfast"} or (
        slot is None and mentions_breakfast_dish(facts)
    ):
        return BREAKFAST_DEADLINE
    if slot:
        return sold_out_deadline(WINDOWS[slot][0])
    return None


def clock_minutes(match: re.Match[str]) -> int:
    """Minutes since midnight of a CLOCK match, reading "8h sáng", "3h chiều", "7pm", "15h"."""
    hour, minute = int(match["hour"]), int(match["minute"] or 0)
    part, ampm = match["part"] or "", match["ampm"]
    if ampm == "am" and hour == 12:
        hour = 0
    elif hour < 12 and (
        ampm == "pm"
        or any(word in part for word in ("chiều", "tối"))
        or ("trưa" in part and hour < 6)
        or (any(word in part for word in ("đêm", "khuya")) and hour >= 7)
    ):
        hour += 12
    return hour * 60 + minute


def visit_window(minutes: int) -> Window:
    return (max(0, minutes - VISIT_MARGIN_MIN), min(DAY_MINUTES, minutes + VISIT_MARGIN_MIN))


def mask_hours_phrases(text: str) -> str:
    """Blank out opening/closing statements, keeping offsets so quotes still line up."""
    return HOURS_PHRASE.sub(lambda m: " " * len(m[0]), text)


def _slot_hits(text: str, item: SourceText, original: str) -> list[Hit]:
    hits: list[Hit] = []
    for slot, pattern in COMPOUND_SLOT_PATTERNS.items():
        if found := pattern.search(text):
            hits.append(_hit(slot, item, original, found))
            text = pattern.sub(lambda m: " " * len(m[0]), text)
    for slot, pattern in SLOT_PATTERNS.items():
        if found := pattern.search(text):
            hits.append(_hit(slot, item, original, found))
    return hits


def _scan(item: SourceText, profile: CityProfile) -> dict[str, list[Hit]]:
    original = unicodedata.normalize("NFC", item.text)
    text = original.lower()
    if len(text) != len(original):
        original = text
    text = mask_hours_phrases(text)
    hits: dict[str, list[Hit]] = {
        "visit": [],
        "slot": [],
        "day": [],
        "crowd": [],
        "sold_out": [],
        "month": [],
    }
    for visit in VISIT_TIME.finditer(text):
        hits["visit"].append(
            _hit(format_window(visit_window(clock_minutes(visit))), item, original, visit)
        )
    hits["slot"] = _slot_hits(text, item, original)
    crowd = CROWD.search(text)
    if crowd:
        hits["crowd"].append(_hit("crowd", item, original, crowd))
    if weekend := WEEKEND.search(text):
        hits["day"].append(_hit("weekday" if crowd else "weekend", item, original, weekend))
    if weekday := WEEKDAY.search(text):
        hits["day"].append(_hit("weekday", item, original, weekday))
    if sold := SOLD_OUT.search(text):
        hits["sold_out"].append(_hit("sold_out", item, original, sold))
    for found in MONTH_NUMBER.finditer(text):
        hits["month"].append(_hit(MONTH_NAMES[int(found[1]) - 1], item, original, found))
    for found in MONTH_WORD.finditer(text):
        hits["month"].append(_hit(found[1][:3].title(), item, original, found))
    if dry := DRY_SEASON.search(text):
        hits["month"].append(_hit(profile.best_months, item, original, dry))
    return hits


def _winner(hits: list[Hit]) -> Hit | None:
    """Most frequent value; ties go to the value mentioned first."""
    if not hits:
        return None
    counts = Counter(hit.value for hit in hits)
    best = max(counts.values())
    return next(hit for hit in hits if counts[hit.value] == best)


def text_rule(facts: PlaceFacts) -> BestTime | None:
    """Keyword rules over comments, caption and transcript (Vietnamese and English).

    An explicit visit time ("ăn lúc 8h sáng") beats day-part words, and the creator's own
    comment beats other commenters. Opening/closing statements ("mở tới 15h chiều") are
    masked first, so they never suggest a time.
    """
    hits: dict[str, list[Hit]] = {}
    creator_visits: list[Hit] = []
    for item in facts.texts:
        for kind, found in _scan(item, facts.profile).items():
            hits.setdefault(kind, []).extend(found)
            if kind == "visit" and item.creator:
                creator_visits.extend(found)
    visit = _winner(creator_visits) or _winner(hits.get("visit", []))
    slot, day = _winner(hits.get("slot", [])), _winner(hits.get("day", []))
    crowd = next(iter(hits.get("crowd", [])), None)
    sold_out = next(iter(hits.get("sold_out", [])), None)
    months = hits.get("month", [])
    used = [h for h in (visit, slot, day, crowd, sold_out, *months) if h is not None]
    if not used:
        return None
    notes: dict[str, list[str]] = {}
    for hit, note in (
        (visit, None),
        (slot, None),
        (day, None),
        (crowd, "go early or avoid peak meal times"),
        (sold_out, "sells out early"),
        *((month, None) for month in months),
    ):
        if hit is not None:
            notes.setdefault(hit.cite, []).extend([note] if note else [])
    evidence = [f"{cite} → {', '.join(extra)}" if extra else cite for cite, extra in notes.items()]
    month_text = ", ".join(dict.fromkeys(h.value for h in months)) or None
    parts: list[tuple[str, str]] = []
    if visit is not None and (window := parse_window(visit.value)):
        at = wall_clock(sum(window) // 2)
        parts.append((f"visited around {at}", f"đi lúc {at}"))
    elif slot is not None:
        parts.append(SLOT_WHY[slot.value])
    if day is not None:
        parts.append(DAY_WHY[day.value])
    if crowd is not None:
        parts.append(CROWD_WHY)
    if sold_out is not None:
        parts.append(SOLD_OUT_WHY)
    if month_text:
        parts.append((f"best in {month_text}", f"đẹp nhất {month_text}"))
    source_en, source_vi = SOURCE_WHY[used[0].source]
    return BestTime(
        hours=visit.value if visit else format_window(WINDOWS[slot.value]) if slot else None,
        days=day.value if day else None,
        months=month_text,
        deadline=early_deadline(facts, slot.value if slot else None) if sold_out else None,
        source=used[0].source,
        evidence="; ".join(evidence),
        why=f"{source_en}: {', '.join(en for en, _ in parts)}",
        why_vi=f"{source_vi}: {', '.join(vi for _, vi in parts)}",
    )


def _months_note(profile: CityProfile) -> str:
    region = profile.aliases[0] if profile.aliases else "city"
    return f"months: {region} {profile.best_months_note}"


def tag_rule(facts: PlaceFacts) -> BestTime | None:
    """Heuristic window of the first ranked tag, preferring an alternative that fits the hours."""
    for hit in facts.tags:
        windows = TAG_WINDOWS.get(hit.tag)
        if not windows:
            continue
        window = next((w for w in windows if overlaps_hours(w, facts.hours)), windows[0])
        why, why_vi = tag_why(hit.tag, facts.category)
        return BestTime(
            hours=format_window(window),
            months=facts.profile.best_months,
            source="heuristic",
            evidence=f"tag rule: {hit.tag} ({hit.reason}); {_months_note(facts.profile)}",
            why=why,
            why_vi=why_vi,
        )
    return None


def category_rule(facts: PlaceFacts) -> BestTime | None:
    """Fallback by category, labelled "heuristic"; every category gets a window."""
    slot: str
    reason: str
    why: tuple[str, str]
    if facts.category is Category.FOOD:
        if dish := mentions_breakfast_dish(facts):
            slot, reason = "breakfast", f"breakfast dish ({dish})"
            why = ("breakfast dish", "món ăn sáng")
        else:
            slot, reason = "evening", "street food / dinner"
            why = ("food place, dinner time", "quán ăn, giờ ăn tối")
    elif facts.category is Category.CAFE:
        opening = typical_open(facts.hours)
        late = opening is not None and to_minutes(opening) >= 11 * 60
        slot = "cafe_afternoon" if late else "cafe_morning"
        reason = "cafe, quiet mid-morning or late afternoon (09:00-11:00 or 15:00-17:00)"
        why = (
            ("café, late afternoon", "cà phê, chiều muộn")
            if late
            else ("café, quiet mid-morning", "cà phê, sáng yên tĩnh")
        )
    elif facts.category is Category.ATTRACTION:
        text = _lower(facts.name)
        viewpoints = (*VIEWPOINT_WORDS, *(_lower(v) for v in facts.profile.viewpoints))
        if any(word in text for word in viewpoints):
            slot, reason = "sunset", "viewpoint at sunset"
            why = ("viewpoint at sunset", "ngắm hoàng hôn")
        else:
            slot, reason = "attraction_morning", "outdoor sight, avoid midday heat"
            why = ("sightseeing before the midday heat", "tham quan trước trưa nắng")
    else:
        slot, reason = "daytime", "no category rule, daytime"
        why = ("daytime, while open", "ban ngày, trong giờ mở cửa")
    return BestTime(
        hours=format_window(WINDOWS[slot]),
        months=facts.profile.best_months,
        source="heuristic",
        evidence=f"category rule: {reason}; {_months_note(facts.profile)}",
        why=why[0],
        why_vi=why[1],
    )


EVIDENCE_RULES: tuple[BestTimeRule, ...] = (text_rule,)
"""Rules that read what posts say; their result may feed the place tags."""
DEFAULT_RULES: tuple[BestTimeRule, ...] = (*EVIDENCE_RULES, tag_rule, category_rule)

_FILLABLE = ("hours", "days", "months", "deadline")


def combine(results: Sequence[BestTime]) -> BestTime:
    """First result wins; later ones only fill empty fields, and the evidence says so."""
    primary = results[0]
    update: dict[str, str | None] = {}
    evidence = [primary.evidence] if primary.evidence else []
    why = [(primary.why, primary.why_vi)] if primary.why else []
    for extra in results[1:]:
        filled = [
            name
            for name in _FILLABLE
            if getattr(primary, name) is None
            and name not in update
            and getattr(extra, name) is not None
        ]
        for name in filled:
            update[name] = getattr(extra, name)
        if filled:
            evidence.append(f"{', '.join(filled)} from {extra.source} ({extra.evidence})")
        if "hours" in filled and extra.why:
            why.append((extra.why, extra.why_vi))
    update["evidence"] = "; ".join(evidence)
    if why:
        update["why"] = "; ".join(en for en, _ in why if en)
        update["why_vi"] = "; ".join(vi for _, vi in why if vi) or None
    return primary.model_copy(update=update)


def _overlap(window: Window, start: int, end: int) -> Window | None:
    for shift in (0, DAY_MINUTES):
        lo, hi = max(window[0] + shift, start), min(window[1] + shift, end)
        if hi - lo >= MIN_OVERLAP_MIN:
            return (lo, hi)
    return None


def clamp_window(window: Window, hours: Hours | None, days: str | None) -> Window:
    """Fit a window inside the opening periods; most common fit across the relevant days."""
    if hours is None or not hours.periods:
        return window
    wanted = WEEKEND_DAYS if days == "weekend" else WEEKDAYS if days == "weekday" else None
    periods = [p for p in hours.periods if wanted is None or p.day in wanted] or hours.periods
    if any(p.close is None for p in periods):
        return window
    spans: list[Window] = []
    for period in periods:
        start = to_minutes(period.open)
        end = to_minutes(period.close or period.open)
        spans.append((start, end if end > start else end + DAY_MINUTES))
    fits = [fit for span in spans if (fit := _overlap(window, *span))]
    if fits:
        if window in fits:
            return window
        counts = Counter(fits)
        return max(counts, key=lambda w: (counts[w], w[1] - w[0]))
    start, end = Counter(spans).most_common(1)[0][0]
    return (start, min(end, start + FALLBACK_WINDOW_MIN))


def respect_deadline(window: Window, deadline: str | None) -> Window:
    """A place that sells out early is best visited in the hours before the deadline."""
    if deadline is None:
        return window
    limit = to_minutes(deadline)
    if window[1] <= limit:
        return window
    return (max(0, limit - SOLD_OUT_HOURS_AFTER_OPEN * 60), limit)


def opens_clause(window: Window, hours: Hours | None) -> tuple[str, str] | None:
    """(EN, VI) "opens 06:30" when the window starts at the usual opening time."""
    opening = typical_open(hours)
    if opening is None or window[0] % DAY_MINUTES != to_minutes(opening):
        return None
    return f"opens {opening}", f"mở cửa {opening}"


def fit_to_hours(best: BestTime, hours: Hours | None) -> BestTime:
    """Clamp the window into the opening hours (noted in the evidence) and say when it opens."""
    window = parse_window(best.hours) if best.hours else None
    if window is None:
        return best
    fitted = clamp_window(respect_deadline(window, best.deadline), hours, best.days)
    update: dict[str, str | None] = {}
    if fitted != window:
        note = f"window adjusted to opening hours / deadline ({format_window(fitted)})"
        update["hours"] = format_window(fitted)
        update["evidence"] = f"{best.evidence}; {note}" if best.evidence else note
    clause = opens_clause(fitted, hours)
    if clause and best.why and clause[0] not in best.why:
        update["why"] = f"{best.why}, {clause[0]}"
        update["why_vi"] = f"{best.why_vi}, {clause[1]}" if best.why_vi else None
    return best.model_copy(update=update) if update else best


def suggest(facts: PlaceFacts, rules: Sequence[BestTimeRule] = DEFAULT_RULES) -> BestTime | None:
    results = [result for rule in rules if (result := rule(facts)) is not None]
    if not results:
        return None
    return fit_to_hours(combine(results), facts.hours)
