"""Turning model output into validated Candidates, and merging them per video."""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from collections.abc import Iterable, Mapping
from typing import Any, get_args

from pydantic import ValidationError

from tiktok_trip.models import Candidate, Recommendation

log = logging.getLogger(__name__)

RECOMMENDATIONS = frozenset(get_args(Recommendation))
FENCE = re.compile(r"^\s*```[\w-]*\s*\n?(.*?)\n?\s*```\s*$", re.DOTALL)
DECORATIVE_CATEGORIES = frozenset({"So", "Sk", "Cf", "Me", "Zs", "Cc"})
"""Symbols (★ ✨ 📍 emoji), emoji modifiers, joiners, keycaps and whitespace."""
DECORATED_FIELDS = ("name", "address_as_mentioned")
EDGE_KEYCAPS = re.compile(r"^(?:[0-9#*]\ufe0f?\u20e3)+|(?:[0-9#*]\ufe0f?\u20e3)+$")


class ExtractionParseError(ValueError):
    pass


def strip_code_fences(text: str) -> str:
    match = FENCE.match(text)
    return match.group(1).strip() if match else text.strip()


def parse_json_payload(text: str) -> Any:
    """Parse model output that should be JSON, tolerating fences and stray prose around it."""
    cleaned = strip_code_fences(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    for opener, closer in (("[", "]"), ("{", "}")):
        start, end = cleaned.find(opener), cleaned.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(cleaned[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise ExtractionParseError(f"no JSON found in model output: {cleaned[:120]!r}")


def _decorative(char: str) -> bool:
    return (
        char.isspace()
        or unicodedata.category(char) in DECORATIVE_CATEGORIES
        or "\ufe00" <= char <= "\ufe0f"
    )


def _strip_symbols(text: str) -> str:
    start, end = 0, len(text)
    while start < end and _decorative(text[start]):
        start += 1
    while end > start and _decorative(text[end - 1]):
        end -= 1
    return text[start:end]


def strip_decoration(text: str) -> str:
    """Drop decorative symbols, keycap emoji and whitespace around `text`; inner text is kept."""
    while (stripped := EDGE_KEYCAPS.sub("", _strip_symbols(text))) != text:
        text = stripped
    return text


def _undecorated(item: Mapping[str, Any]) -> dict[str, Any]:
    data = dict(item)
    for name in DECORATED_FIELDS:
        if isinstance(data.get(name), str):
            data[name] = strip_decoration(data[name]) or None
    return data


def candidates_from_payload(payload: Any, video_id: str, video_url: str) -> list[Candidate]:
    """Validate a list of candidate dicts, forcing the true video id/url and skipping bad items."""
    if isinstance(payload, Mapping):
        payload = payload.get("candidates", payload.get("places", [payload]))
    if not isinstance(payload, list):
        raise ExtractionParseError(f"expected a JSON array, got {type(payload).__name__}")
    candidates: list[Candidate] = []
    for index, item in enumerate(payload):
        if not isinstance(item, Mapping):
            log.warning("%s: item %d is not an object, skipped", video_id, index)
            continue
        data = {
            **_undecorated(item),
            "video_id": video_id,
            "video_url": video_url or item.get("video_url", ""),
        }
        data.setdefault("confidence", 0.5)
        data["recommendation"] = recommendation_value(data.get("recommendation"))
        try:
            candidates.append(Candidate.model_validate(data))
        except ValidationError as exc:
            log.warning("%s: item %d is invalid, skipped: %s", video_id, index, _short(exc))
    return candidates


def recommendation_value(value: Any) -> str | None:
    """'Strong ' -> 'strong'; an unknown value is None (not assessed) instead of an invalid item."""
    text = value.strip().lower() if isinstance(value, str) else None
    return text if text in RECOMMENDATIONS else None


def merge_candidates(
    existing: Iterable[Candidate], fresh: Mapping[str, list[Candidate]]
) -> list[Candidate]:
    """Replace the candidates of every video in `fresh`, keep the others untouched."""
    kept = [c for c in existing if c.video_id not in fresh]
    for video_id in sorted(fresh):
        kept.extend(fresh[video_id])
    return kept


def _short(exc: ValidationError) -> str:
    return "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
