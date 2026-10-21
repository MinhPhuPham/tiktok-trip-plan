"""The user's own place list (input/places.yaml) as candidates: section → category and meal hint.

Each entry is "name | address | remark" (address and remark optional). Every entry becomes a
strongly recommended Candidate with the line itself as `manual` evidence.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from tiktok_trip.extraction.parse import strip_decoration
from tiktok_trip.matching import fold
from tiktok_trip.models import Candidate, Category, Evidence, EvidenceSource

log = logging.getLogger(__name__)

MANUAL_VIDEO_ID = "manual:places.yaml"
MANUAL_VIDEO_URL = "input/places.yaml"
MANUAL_CONFIDENCE = 0.9
MUST_GO_QUOTE = "user's own must-go list"
FIELD_SEPARATOR = "|"


class ManualListError(ValueError):
    pass


@dataclass(frozen=True)
class Section:
    category: Category
    hint: str | None = None


BREAKFAST = Section(Category.FOOD, "meal: breakfast")
LUNCH = Section(Category.FOOD, "meal: lunch")
DINNER = Section(Category.FOOD, "meal: dinner")
SNACK = Section(Category.FOOD, "meal: snack")
CAFE = Section(Category.CAFE, "cafe")
ATTRACTION = Section(Category.ATTRACTION)
OTHER = Section(Category.OTHER)

SECTIONS: dict[str, Section] = {
    "an sang": BREAKFAST,
    "breakfast": BREAKFAST,
    "an trua": LUNCH,
    "lunch": LUNCH,
    "an toi": DINNER,
    "dinner": DINNER,
    "an vat": SNACK,
    "snack": SNACK,
    "snacks": SNACK,
    "ca phe": CAFE,
    "cafe": CAFE,
    "coffee": CAFE,
    "di choi": ATTRACTION,
    "tham quan": ATTRACTION,
    "attraction": ATTRACTION,
    "attractions": ATTRACTION,
}


def section_for(title: str) -> Section:
    """'Ăn sáng:' → food + breakfast; an unknown title is an `other` section without a hint."""
    key = " ".join(fold(title).strip().rstrip(":").split())
    section = SECTIONS.get(key)
    if section is None:
        log.warning("places.yaml: unknown section %r, its places get category 'other'", title)
        return OTHER
    return section


def parse_entry(line: str, section: Section) -> Candidate | None:
    """'Name | address | remark' → Candidate; None (with a warning) when the name is empty."""
    parts = [strip_decoration(part) for part in line.split(FIELD_SEPARATOR, 2)]
    name, address, remark = [*parts, "", ""][:3]
    if not name:
        log.warning("places.yaml: entry %r has no name, skipped", line)
        return None
    notes = "; ".join(part for part in (section.hint, remark) if part) or None
    try:
        return Candidate(
            video_id=MANUAL_VIDEO_ID,
            video_url=MANUAL_VIDEO_URL,
            name=name,
            category=section.category,
            address_as_mentioned=address or None,
            notes=notes,
            evidence=[Evidence(source=EvidenceSource.MANUAL, quote=line.strip())],
            confidence=MANUAL_CONFIDENCE,
            recommendation="strong",
            recommendation_quote=MUST_GO_QUOTE,
            recommendation_source=EvidenceSource.MANUAL,
        )
    except ValidationError as exc:
        log.warning("places.yaml: entry %r is invalid, skipped: %s", line, exc)
        return None


def candidates_from_sections(data: Any) -> list[Candidate]:
    """[{section, places: [line, ...]}, ...] → candidates in file order."""
    if data is None:
        return []
    if not isinstance(data, list):
        raise ManualListError("expected a list of sections ({section, places})")
    candidates: list[Candidate] = []
    for index, item in enumerate(data):
        if not isinstance(item, Mapping):
            log.warning("places.yaml: section %d is not a mapping, skipped", index + 1)
            continue
        section = section_for(str(item.get("section") or ""))
        for line in item.get("places") or []:
            if not isinstance(line, str):
                log.warning("places.yaml: entry %r is not text, skipped", line)
                continue
            if candidate := parse_entry(line, section):
                candidates.append(candidate)
    return candidates


def load_manual_candidates(path: Path) -> list[Candidate]:
    """Candidates from input/places.yaml; none when the file does not exist."""
    if not path.exists():
        return []
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ManualListError(f"invalid YAML: {exc}") from exc
    return candidates_from_sections(data)
