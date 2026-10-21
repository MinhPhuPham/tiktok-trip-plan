"""input/preferences.yaml: places the user must visit (`must_go`) or has removed (`removed`).

Entries are place ids or names. A name matches a place (or a name the videos used for it) when
`name_score` >= NAME_MATCH or it appears in it as whole words, diacritics folded; "A (B)" also
tries A and B alone. Removed places get status "skip"; must-go places get priority "must".
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from pydantic import BaseModel, Field, ValidationError, field_validator

from tiktok_trip.errors import UserFacingError
from tiktok_trip.matching import fold, name_score
from tiktok_trip.models import Place

log = logging.getLogger(__name__)

NAME_MATCH = 85.0
MIN_SUBSTRING = 4
MUST_REASON = "must-go (input/preferences.yaml)"
PARENTHESES = re.compile(r"^(?P<outer>[^()]+?)\s*\((?P<inner>[^()]+)\)\s*$")


class Preferences(BaseModel):
    must_go: list[str] = Field(default_factory=list)
    removed: list[str] = Field(default_factory=list)

    @field_validator("must_go", "removed", mode="before")
    @classmethod
    def _entries(cls, value: object) -> object:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if item is not None and str(item).strip()]
        return value


def load_preferences(path: Path) -> Preferences:
    """Empty preferences when the file does not exist; a clear error when it is malformed."""
    if not path.exists():
        return Preferences()
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        return Preferences.model_validate(data)
    except (yaml.YAMLError, ValidationError) as exc:
        raise UserFacingError(f"{path} is not valid: {exc}") from exc


def _variants(entry: str) -> list[str]:
    match = PARENTHESES.match(entry)
    return [entry, match["outer"], match["inner"]] if match else [entry]


def _contains(text: str, phrase: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(phrase)}(?!\w)", text) is not None


def name_matches(entry: str, name: str) -> bool:
    for variant in _variants(entry):
        if name_score(variant, name) >= NAME_MATCH:
            return True
        folded = " ".join(fold(variant).split())
        if len(folded) >= MIN_SUBSTRING and _contains(" ".join(fold(name).split()), folded):
            return True
    return False


def matches(entry: str, place: Place, aliases: Iterable[str] = ()) -> bool:
    """True when `entry` is the place id or names the place (its name or an alias)."""
    entry = entry.strip()
    if entry == place.id:
        return True
    return any(name_matches(entry, name) for name in (place.name, *aliases))


@dataclass
class Applied:
    places: list[Place]
    unmatched: list[tuple[str, str]] = field(default_factory=list)
    """(list name, entry) for every preference that matched no place."""
    conflicts: list[str] = field(default_factory=list)
    """Place ids listed under both must_go and removed (removed wins)."""


def apply_preferences(
    places: Sequence[Place], prefs: Preferences, aliases: Mapping[str, Sequence[str]]
) -> Applied:
    """Mark removed places skip and must-go places "must"; earlier marks are recomputed."""
    used: set[tuple[str, str]] = set()
    result = Applied(places=[])
    for place in places:
        names = aliases.get(place.id, ())
        removed = [e for e in prefs.removed if matches(e, place, names)]
        must = [e for e in prefs.must_go if matches(e, place, names)]
        used.update(("removed", e) for e in removed)
        used.update(("must_go", e) for e in must)
        update: dict[str, object] = {"preference": None}
        if removed:
            update = {"preference": "removed", "status": "skip"}
            if must:
                result.conflicts.append(place.id)
        elif must:
            update = {"preference": "must_go", "priority": "must", "priority_reason": MUST_REASON}
        result.places.append(place.model_copy(update=update))
    result.unmatched = [
        (kind, entry)
        for kind, entries in (("must_go", prefs.must_go), ("removed", prefs.removed))
        for entry in entries
        if (kind, entry) not in used
    ]
    return result
