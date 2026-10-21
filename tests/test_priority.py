"""Place priority rule: repeat mentions and strong praise rank high, plain list entries low."""

from __future__ import annotations

import pytest

from tiktok_trip.models import Priority
from tiktok_trip.priority import Rating, Signal, rank, rate

STRONG = Signal("strong", post_places=5, quote="nhất định phải ghé", source="caption")
NORMAL = Signal("normal", post_places=5, quote="ngon, đáng thử", source="transcript")
LISTED = Signal("none", post_places=29)
DEDICATED = Signal("none", post_places=1)
LEGACY = Signal(None, post_places=1)


@pytest.mark.parametrize(
    ("mentions", "signals", "expected"),
    [
        (2, [LISTED, LISTED], Rating("high", "recommended in 2 posts")),
        (3, [LEGACY, LEGACY, LEGACY], Rating("high", "recommended in 3 posts")),
        (1, [STRONG], Rating("high", "strong: 'nhất định phải ghé' (caption)")),
        (1, [NORMAL], Rating("medium", "recommended: 'ngon, đáng thử' (transcript)")),
        (1, [DEDICATED], Rating("medium", "dedicated post (the only place in it)")),
        (1, [LISTED], Rating("low", "listed in a 29-place post")),
        (1, [LEGACY], Rating(None, None)),
        (1, [], Rating(None, None)),
        (1, [LEGACY, LISTED], Rating("low", "listed in a 29-place post")),
        (1, [LISTED, STRONG], Rating("high", "strong: 'nhất định phải ghé' (caption)")),
    ],
)
def test_rule_table(mentions: int, signals: list[Signal], expected: Rating) -> None:
    assert rate(mentions, signals) == expected


def test_dedicated_post_lifts_none_but_never_lowers() -> None:
    assert DEDICATED.effective == "normal"
    assert Signal("strong", post_places=1, quote="best").effective == "strong"
    assert LISTED.effective == "none"
    assert LEGACY.effective is None


def test_long_quote_is_clipped_and_source_optional() -> None:
    reason = rate(1, [Signal("strong", post_places=3, quote="phải thử " * 20)]).reason
    assert reason is not None
    assert reason.startswith("strong: 'phải thử")
    assert reason.endswith("…'")
    assert len(reason) < 80


def test_rank_orders_high_to_unknown() -> None:
    levels: list[Priority | None] = [None, "low", "high", "medium"]
    assert sorted(levels, key=rank) == ["high", "medium", "low", None]
