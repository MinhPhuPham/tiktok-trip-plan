"""Pure matching helpers for resolve: name normalization, fuzzy scores, branch evidence.

Addresses are compared on street, house number, ward and landmark tokens only. District
names ("Quận 1", "Huyện X", "TP Thủ Đức") are removed first because the July 2025 reform
abolished districts, so old videos and new Google addresses disagree on them.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from itertools import pairwise
from typing import Literal

from rapidfuzz import fuzz

from tiktok_trip.clock import EN_DASH

FOLDED_WEIGHT = 0.95

GENERIC_NAME_WORDS = (
    "nhà hàng",
    "quán ăn",
    "quán",
    "tiệm",
    "cửa hàng",
    "chi nhánh",
    "cơ sở",
    "restaurant",
    "shop",
    "store",
    "branch",
)

ADDRESS_STOPWORDS = frozenset(
    {
        "duong",
        "d",
        "phuong",
        "p",
        "so",
        "hem",
        "kiet",
        "ngo",
        "street",
        "st",
        "road",
        "rd",
        "ward",
        "alley",
        "va",
        "gan",
        "canh",
        "doi",
        "dien",
        "near",
        "the",
        "of",
    }
)

COUNTRY_PHRASES = ("viet nam", "vietnam")
REGION_PREFIXES = ("thanh pho", "tp", "tinh")

_DISTRICT_WORDS = r"(?:quận|huyện|district|dist\.?|thành phố|thanh pho|tp\.?|thị xã|tx\.?)"
_NUMBERED_DISTRICT = re.compile(r"\b(?:quận|quan|q|district|dist|huyện|huyen)\s*\.?\s*\d{1,2}\b")
_DISTRICT_SEGMENT = re.compile(rf"^{_DISTRICT_WORDS}(?:\s|$)")
_TRAILING_DISTRICT = re.compile(rf"\s{_DISTRICT_WORDS}\s+\w+(?:\s+\w+){{0,2}}$")
_NON_WORD = re.compile(r"[^\w]+")
_POSTCODE = re.compile(r"\b\d{5,6}\b")
_BRANCH_SEPARATORS = re.compile(rf"\s+[-{EN_DASH}|]\s+|\s*\(")
_HOUSE = re.compile(
    r"^(?:(?:so|no\.?|lo|kiot|ki ot)\s*)?"
    r"(?P<number>[a-z]?\d+[a-z]?(?:\s*/\s*[a-z]?\d+[a-z]?)*(?:\s*-\s*\d+[a-z]?)?(?:\s*bis)?)"
    r"\s+(?P<street>[a-z].*)$"
)
_TRAILING_WARD = re.compile(r"\s+(?:(?:p|f|phuong|ward)\s*\.?\s*\d{1,2}|(?:phuong|ward)\s+.*)$")

_LEADING_ZEROS = re.compile(r"(?<!\d)0+(?=\d)")

HouseMatch = Literal["exact", "street"]


def fold(text: str) -> str:
    """Lowercase and strip Vietnamese diacritics (đ becomes d)."""
    decomposed = unicodedata.normalize("NFD", text.lower().replace("đ", "d").replace("Đ", "d"))
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def clean(text: str) -> str:
    return " ".join(_NON_WORD.sub(" ", unicodedata.normalize("NFC", text.lower())).split())


def _strip_phrases(text: str, phrases: Iterable[str]) -> str:
    alternatives = "|".join(re.escape(p) for p in sorted(phrases, key=len, reverse=True))
    return " ".join(re.sub(rf"(?<!\w)(?:{alternatives})(?!\w)", " ", text).split())


_FOLDED_GENERIC = tuple(fold(word) for word in GENERIC_NAME_WORDS)


def core_name(name: str, *, folded: bool = False) -> str:
    """Name without generic shop words; falls back to the full name if nothing is left."""
    text = clean(fold(name) if folded else name)
    stripped = _strip_phrases(text, _FOLDED_GENERIC if folded else GENERIC_NAME_WORDS)
    return stripped or text


def name_variants(place_name: str) -> list[str]:
    """The full Google name plus the part before a branch suffix like " - Lê Lợi" or "(CN 2)"."""
    variants = [place_name]
    head = _BRANCH_SEPARATORS.split(place_name, maxsplit=1)[0].strip()
    if head and head != place_name:
        variants.append(head)
    return variants


def name_score(candidate_name: str, place_name: str) -> float:
    """0-100 similarity; a diacritic-free comparison counts slightly less than an exact one."""
    best = 0.0
    for variant in name_variants(place_name):
        primary = fuzz.token_set_ratio(core_name(candidate_name), core_name(variant))
        secondary = fuzz.token_set_ratio(
            core_name(candidate_name, folded=True), core_name(variant, folded=True)
        )
        best = max(best, primary, secondary * FOLDED_WEIGHT)
    return round(best, 1)


def shares_word(candidate_name: str, place_name: str) -> bool:
    """True when the folded names have a word in common besides generic shop words."""
    return not set(core_name(candidate_name, folded=True).split()).isdisjoint(
        core_name(place_name, folded=True).split()
    )


def _tokens(text: str) -> list[str]:
    return [t for t in clean(fold(text)).split() if t not in ADDRESS_STOPWORDS]


def region_phrases(regions: Iterable[str]) -> list[str]:
    """Folded city/province names to strip from addresses, with "TP X" / "X city" variants."""
    phrases: dict[str, None] = dict.fromkeys(COUNTRY_PHRASES)
    for region in regions:
        name = clean(fold(region))
        if not name:
            continue
        phrases.setdefault(name)
        phrases.setdefault(f"{name} city")
        for prefix in REGION_PREFIXES:
            phrases.setdefault(f"{prefix} {name}")
    return list(phrases)


def strip_regions(text: str, regions: Iterable[str]) -> str:
    """Folded, cleaned `text` without city/country names; the folded text if nothing is left."""
    folded = clean(fold(text))
    return _strip_phrases(folded, region_phrases(regions)) or folded


def address_segments(text: str, regions: Sequence[str] = ()) -> list[list[str]]:
    """Token lists per comma segment, without districts, region names or stopwords.

    `regions` are the city and its aliases (CityProfile). District words are detected
    before folding: folded "quận" (district) equals "quán" (shop).
    """
    region = region_phrases(regions)
    segments: list[list[str]] = []
    for raw in unicodedata.normalize("NFC", text.lower()).split(","):
        segment = _NUMBERED_DISTRICT.sub(" ", raw).strip()
        if not segment or _DISTRICT_SEGMENT.match(segment):
            continue
        segment = _TRAILING_DISTRICT.sub(" ", segment)
        segment = _POSTCODE.sub(" ", _strip_phrases(clean(fold(segment)), region))
        if tokens := _tokens(segment):
            segments.append(tokens)
    return segments


def _grams(segments: Sequence[Sequence[str]]) -> tuple[set[str], set[str]]:
    unigrams = {token for segment in segments for token in segment}
    bigrams = {f"{a} {b}" for segment in segments for a, b in pairwise(segment)}
    return unigrams, bigrams


def evidence_segments(
    address_as_mentioned: str | None, landmarks: Sequence[str], regions: Sequence[str] = ()
) -> list[list[str]]:
    texts = [address_as_mentioned or "", *landmarks]
    return [segment for text in texts if text for segment in address_segments(text, regions)]


def branch_score(
    evidence: Sequence[Sequence[str]], name: str, address: str, regions: Sequence[str] = ()
) -> float | None:
    """Share (0-100) of evidence unigrams and bigrams found in a place's name + address.

    None when there is no usable evidence. Bigrams reward whole street names, so
    "Lê Lợi" beats "Lê Lai" even though both share the token "le".
    """
    ev_uni, ev_bi = _grams(evidence)
    total = len(ev_uni) + len(ev_bi)
    if total == 0:
        return None
    target = [_tokens(name), *address_segments(address, regions)]
    tgt_uni, tgt_bi = _grams(target)
    hits = len(ev_uni & tgt_uni) + len(ev_bi & tgt_bi)
    return round(100 * hits / total, 1)


@dataclass(frozen=True)
class HouseAddress:
    """A printed house number ("21", "17/6", "3bis", "h19") and its street tokens."""

    number: str
    street: tuple[str, ...]


def _house_in(segment: str) -> HouseAddress | None:
    raw = unicodedata.normalize("NFC", segment.lower())
    raw = _TRAILING_DISTRICT.sub(" ", _NUMBERED_DISTRICT.sub(" ", raw))
    found = _HOUSE.match(" ".join(fold(raw).split()))
    if found is None:
        return None
    street = _TRAILING_WARD.sub("", found["street"])
    tokens = tuple(_tokens(street))
    if not tokens:
        return None
    number = _LEADING_ZEROS.sub("", re.sub(r"\s+", "", found["number"]))
    return HouseAddress(number=number, street=tokens)


def house_address(text: str | None) -> HouseAddress | None:
    """House number and street from the first comma segment that starts with a number.

    "Số 1 X", "Lô H19 X" and "3 Bis X" count; an alley ("Hẻm 17 X"), a hamlet ("Thôn 5")
    or a number later in the segment ("Dốc số 9") is not a house number.
    """
    for segment in (text or "").split(","):
        if found := _house_in(segment):
            return found
    return None


def house_match(mentioned: HouseAddress | None, address: str) -> HouseMatch | None:
    """ "exact" for the same number and street, "street" for the same street at another number."""
    if mentioned is None:
        return None
    found = house_address(address)
    if found is None or found.street != mentioned.street:
        return None
    return "exact" if found.number == mentioned.number else "street"
