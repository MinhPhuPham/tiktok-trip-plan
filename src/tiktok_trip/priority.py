"""Place priority from recommendation signals: repeat mentions and strong praise rank highest.

| signals                                                   | priority |
|-----------------------------------------------------------|----------|
| mentioned in 2+ posts, or any post recommends it strongly | high     |
| one post, recommended with praise or its only place       | medium   |
| one post that only lists it among other places            | low      |
| no recommendation assessed (extracted before the field)   | None     |

`must` sits above all of them; it comes only from input/preferences.yaml (see preferences.py).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from tiktok_trip.models import Priority, Recommendation

QUOTE_CHARS = 60
RANK: dict[Priority | None, int] = {"must": 0, "high": 1, "medium": 2, "low": 3, None: 4}
STARS: dict[Priority | None, str] = {
    "must": "★★★★",
    "high": "★★★",
    "medium": "★★",
    "low": "★",
    None: "",
}
LEVELS: tuple[Priority, ...] = ("must", "high", "medium", "low")


@dataclass(frozen=True)
class Signal:
    """One candidate's recommendation and the number of places its post names."""

    strength: Recommendation | None
    post_places: int = 1
    quote: str | None = None
    source: str | None = None

    @property
    def dedicated(self) -> bool:
        return self.post_places == 1

    @property
    def effective(self) -> Recommendation | None:
        """A post about this one place counts as at least a normal recommendation."""
        if self.strength == "none" and self.dedicated:
            return "normal"
        return self.strength


@dataclass(frozen=True)
class Rating:
    priority: Priority | None
    reason: str | None


def _quoted(signal: Signal) -> str:
    quote = " ".join((signal.quote or "").split())
    if len(quote) > QUOTE_CHARS:
        quote = quote[: QUOTE_CHARS - 1].rstrip() + "…"
    return f"'{quote}' ({signal.source})" if signal.source else f"'{quote}'"


def rate(mention_count: int, signals: Sequence[Signal]) -> Rating:
    """Priority and a short audit reason; repeat mentions win even without assessed signals."""
    if mention_count >= 2:
        return Rating("high", f"recommended in {mention_count} posts")
    assessed = [s for s in signals if s.strength is not None]
    if not assessed:
        return Rating(None, None)
    if strong := next((s for s in assessed if s.effective == "strong"), None):
        return Rating("high", f"strong: {_quoted(strong)}")
    if normal := next((s for s in assessed if s.effective == "normal"), None):
        if normal.quote:
            return Rating("medium", f"recommended: {_quoted(normal)}")
        return Rating("medium", "dedicated post (the only place in it)")
    size = max(s.post_places for s in assessed)
    return Rating("low", f"listed in a {size}-place post")


def rank(priority: Priority | None) -> int:
    """Sort key: must, high, medium, low, then unknown."""
    return RANK[priority]
