"""Step 5: opening hours, price and rating from Place Details, tags, and a labelled best time."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace
from itertools import pairwise
from typing import Any

import httpx

from tiktok_trip.besttime import EVIDENCE_RULES, RULES_VERSION, PlaceFacts, SourceText, suggest
from tiktok_trip.clients.google_places import GooglePlacesClient, PlaceDetails, format_amount
from tiktok_trip.clock import EN_DASH
from tiktok_trip.config import CityProfile, MissingSecretError
from tiktok_trip.context import Context
from tiktok_trip.extraction.raw import (
    VideoFiles,
    known_sources,
    load_comments,
    load_transcript,
    read_caption,
    video_id_from_url,
)
from tiktok_trip.matching import clean, core_name, fold, name_score, strip_regions
from tiktok_trip.models import BestTime, Candidate, Place, PriceRange
from tiktok_trip.paths import Paths
from tiktok_trip.storage import load_models, save_models
from tiktok_trip.tags import TagFacts, sort_tags, tag_hits

log = logging.getLogger(__name__)

PLACEHOLDER_PRICE = re.compile(rf"^\d{{1,3}}{EN_DASH}.*\bVND$")
"""A stored Google range whose lower bound is the 1 VND placeholder (older parser)."""
NOTE_PRICE = re.compile(
    r"(?<![\w.,])(\d{1,3}(?:[.,]\d{3})+|\d{1,3}\s?k)(?!\w|[.,]\d|\s?(?:m|km|mét|m2)\b)",
    re.IGNORECASE,
)
MIN_NOTE_PRICE = 1_000
MAX_NOTE_PRICE = 5_000_000
MAIN_ITEM_MIN = 15_000
"""Drinks and add-ons below this are ignored when at least two prices remain."""
MIN_TERM_CHARS = 4
"""A single word names a place only from this length (folded); word pairs always count."""


def has_placeholder_price(place: Place) -> bool:
    price = place.price_range
    return (
        price is not None
        and price.source == "google"
        and bool(PLACEHOLDER_PRICE.match(price.value))
    )


def needs_details(place: Place) -> bool:
    return place.id.startswith("gp:") and (
        place.hours is None or place.rating is None or has_placeholder_price(place)
    )


def apply_details(place: Place, details: PlaceDetails) -> Place:
    """Fill empty fields (a Google price may be refreshed); comment or human values stay."""
    update: dict[str, Any] = {}
    for name in ("hours", "price_range", "rating", "rating_count"):
        current, fresh = getattr(place, name), getattr(details, name)
        replaceable = current is None or (name == "price_range" and current.source == "google")
        if replaceable and fresh is not None and fresh != current:
            update[name] = fresh
    return place.model_copy(update=update) if update else place


def note_prices(notes: list[str]) -> list[int]:
    """VND amounts written in the notes ("35.000", "45k"), in order of appearance."""
    amounts: list[int] = []
    for found in NOTE_PRICE.finditer(" ".join(notes)):
        raw = found[1].lower().replace(" ", "")
        value = int(raw[:-1]) * 1_000 if raw.endswith("k") else int(re.sub(r"[.,]", "", raw))
        if MIN_NOTE_PRICE <= value <= MAX_NOTE_PRICE:
            amounts.append(value)
    return amounts


def price_from_notes(notes: list[str]) -> PriceRange | None:
    """Menu range from prices in the notes; needs at least two, side items dropped if possible."""
    amounts = note_prices(notes)
    main = [value for value in amounts if value >= MAIN_ITEM_MIN]
    chosen = main if len(main) >= 2 else amounts
    if len(chosen) < 2:
        return None
    low, high = min(chosen), max(chosen)
    span = (
        format_amount(low) if low == high else f"{format_amount(low)}{EN_DASH}{format_amount(high)}"
    )
    return PriceRange(value=f"{span} VND", source="notes")


def with_notes_price(place: Place) -> Place:
    """Prefer menu prices from the notes over Google's range; never over comment/human values.

    A legacy "caption" price (the old label for notes-derived prices) is recomputed too.
    """
    current = place.price_range
    if current is not None and current.source not in ("google", "caption"):
        return place
    found = price_from_notes(place.notes)
    if found is None and current is not None and current.source == "caption":
        found = PriceRange(value=current.value, source="notes")
    if found is None or found == current:
        return place
    return place.model_copy(update={"price_range": found})


def url_key(url: str) -> str:
    return url.split("?", 1)[0].split("#", 1)[0].rstrip("/").lower()


def video_index(paths: Paths) -> dict[str, str]:
    """Normalized video URL -> video id, from the source.json files fetch wrote."""
    return {url_key(url): video_id for url, video_id in known_sources(paths).items()}


def video_files(url: str, index: dict[str, str], paths: Paths) -> VideoFiles | None:
    video_id = index.get(url_key(url)) or video_id_from_url(url)
    if video_id is None:
        return None
    files = VideoFiles.of(paths, video_id)
    return files if files.root.is_dir() else None


def read_texts(files: VideoFiles) -> list[SourceText]:
    """Caption, comments and transcript of one video; missing or broken files add nothing."""
    texts: list[SourceText] = []
    if caption := read_caption(files):
        texts.append(SourceText("caption", caption))
    texts.extend(
        SourceText("comments", c.text, creator=c.is_creator)
        for c in load_comments(files)
        if c.text.strip()
    )
    if transcript := load_transcript(files):
        texts.extend(
            SourceText("transcript", s.text) for s in transcript.segments if s.text.strip()
        )
    return texts


def _grams(text: str, regions: Sequence[str]) -> tuple[set[str], set[str]]:
    tokens = [
        t
        for t in core_name(strip_regions(text, regions), folded=True).split()
        if any(ch.isalpha() for ch in t)
    ]
    return set(tokens), {f"{a} {b}" for a, b in pairwise(tokens)}


@dataclass(frozen=True)
class PlaceTerms:
    """Folded words and word pairs that name one place and none of the others in its post."""

    words: frozenset[str]
    phrases: frozenset[str]

    def named_in(self, text: str) -> bool:
        tokens = clean(fold(text)).split()
        return not self.words.isdisjoint(tokens) or not self.phrases.isdisjoint(
            f"{a} {b}" for a, b in pairwise(tokens)
        )


def place_terms(
    own: Iterable[str], others: Iterable[str], regions: Sequence[str] = ()
) -> PlaceTerms:
    own_words: set[str] = set()
    own_phrases: set[str] = set()
    other_words: set[str] = set()
    other_phrases: set[str] = set()
    for text in own:
        words, phrases = _grams(text, regions)
        own_words |= words
        own_phrases |= phrases
    for text in others:
        words, phrases = _grams(text, regions)
        other_words |= words
        other_phrases |= phrases
    return PlaceTerms(
        words=frozenset(w for w in own_words - other_words if len(w) >= MIN_TERM_CHARS),
        phrases=frozenset(own_phrases - other_phrases),
    )


def _candidate_texts(candidates: Iterable[Candidate]) -> list[str]:
    return [text for c in candidates for text in (c.name, *c.must_try)]


def terms_for(place: Place, siblings: Sequence[Candidate], regions: Sequence[str]) -> PlaceTerms:
    """Terms of `place` against the other places named in the same post.

    Its own candidates are the ones resolve merged into it; for an older places.json without
    candidate keys, the candidate whose name is closest to the place name.
    """
    own = [c for c in siblings if c.key in place.candidate_keys] or [
        max(siblings, key=lambda c: name_score(c.name, place.name))
    ]
    own_keys = {c.key for c in own}
    others = [c for c in siblings if c.key not in own_keys]
    return place_terms([place.name, *_candidate_texts(own)], _candidate_texts(others), regions)


def scope_texts(texts: Iterable[SourceText], terms: PlaceTerms) -> list[SourceText]:
    """The caption, plus only the comments and transcript lines that name the place."""
    return [
        t if t.source == "caption" else replace(t, scoped=True)
        for t in texts
        if t.source == "caption" or terms.named_in(t.text)
    ]


class TextReader:
    """Texts per place, reading each video's files at most once per run.

    In a post that names several places, comments and transcript lines are kept only for the
    place they name, so "đi tối" about one shop is not evidence for its neighbours in a top 5.
    """

    def __init__(
        self, paths: Paths, candidates: Iterable[Candidate] = (), regions: Sequence[str] = ()
    ) -> None:
        self.paths = paths
        self.index = video_index(paths)
        self.regions = tuple(regions)
        self._cache: dict[str, list[SourceText]] = {}
        self._posts: defaultdict[str, dict[str, Candidate]] = defaultdict(dict)
        for candidate in candidates:
            self._posts[candidate.video_id].setdefault(candidate.key, candidate)

    def for_place(self, place: Place) -> list[SourceText]:
        texts: list[SourceText] = []
        for url in place.videos:
            files = video_files(url, self.index, self.paths)
            if files is None:
                continue
            if files.video_id not in self._cache:
                self._cache[files.video_id] = read_texts(files)
            video_texts = self._cache[files.video_id]
            siblings = list(self._posts[files.video_id].values())
            if len(siblings) > 1:
                video_texts = scope_texts(video_texts, terms_for(place, siblings, self.regions))
            texts.extend(video_texts)
        return texts


class _Details:
    """Lazily built Google client; a missing key disables Details once, with one warning."""

    def __init__(self, ctx: Context) -> None:
        self.ctx = ctx
        self._client: GooglePlacesClient | None = None
        self.disabled = False

    def fetch(self, place: Place) -> PlaceDetails | None:
        if self.disabled:
            return None
        if self._client is None:
            try:
                self._client = GooglePlacesClient(self.ctx)
            except MissingSecretError as exc:
                log.warning("Skipping Place Details: %s", exc)
                self.disabled = True
                return None
        try:
            return self._client.details(place.id.removeprefix("gp:"))
        except httpx.HTTPError as exc:
            log.warning("Place Details failed for %s: %s", place.name, exc)
            return None

    def close(self) -> None:
        if self._client is not None:
            self._client.close()


def inputs_hash(facts: PlaceFacts) -> str:
    """Short fingerprint of everything a best-time suggestion is computed from."""
    payload = json.dumps(
        [
            RULES_VERSION,
            facts.name,
            facts.category,
            facts.must_try,
            facts.hours.model_dump(mode="json") if facts.hours else None,
            [(t.source, t.text, t.creator, t.scoped) for t in facts.texts],
            facts.profile.model_dump(mode="json"),
            [(hit.tag, hit.reason, hit.strength) for hit in facts.tags],
        ],
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def needs_best_time(current: BestTime | None, fingerprint: str) -> bool:
    """Missing, heuristic, or computed from inputs that changed since. Manual values stay."""
    if current is None or current.source == "heuristic":
        return True
    return current.inputs_hash is not None and current.inputs_hash != fingerprint


def is_manual(best: BestTime | None) -> bool:
    return best is not None and best.inputs_hash is None and best.source != "heuristic"


def with_best_time(
    place: Place, texts: list[SourceText], profile: CityProfile | None = None
) -> Place:
    """Set the tags and, when its inputs changed, the best time (manual values stay).

    Tags read the evidence-based best time (what the posts say, or a manual value), and the
    heuristic best time then reads the tags, so a place always ends with a best time.
    """
    facts = PlaceFacts.of(place, texts, profile)
    evidence = (
        place.best_time if is_manual(place.best_time) else suggest(facts, rules=EVIDENCE_RULES)
    )
    hits = tag_hits(TagFacts.of(place, evidence, facts.profile.viewpoints))
    facts = replace(facts, tags=tuple(hits))
    update: dict[str, Any] = {}
    tags = sort_tags(hit.tag for hit in hits)
    if tags != place.tags:
        update["tags"] = tags
    fingerprint = inputs_hash(facts)
    if needs_best_time(place.best_time, fingerprint) and (best := suggest(facts)) is not None:
        fresh = best.model_copy(update={"inputs_hash": fingerprint})
        if fresh != place.best_time:
            update["best_time"] = fresh
    return place.model_copy(update=update) if update else place


def run(ctx: Context) -> None:
    places = load_models(ctx.paths.places_file, Place)
    reader = TextReader(
        ctx.paths,
        load_models(ctx.paths.candidates_file, Candidate),
        (ctx.config.city, *ctx.config.city_profile.aliases),
    )
    profile = ctx.config.city_profile
    details = _Details(ctx)
    fetched = timed = tagged = 0
    enriched: list[Place] = []
    try:
        for original in places:
            place = original
            if needs_details(place) and (found := details.fetch(place)) is not None:
                place = apply_details(place, found)
                fetched += 1
            place = with_notes_price(place)
            timed_place = with_best_time(place, reader.for_place(place), profile)
            timed += timed_place.best_time != place.best_time
            tagged += timed_place.tags != place.tags
            place = timed_place
            enriched.append(place)
    finally:
        details.close()
    save_models(ctx.paths.places_file, enriched)
    log.info(
        "Enrich: %d places, %d with new Place Details, %d new or updated best-time suggestions, "
        "%d with new tags",
        len(enriched),
        fetched,
        timed,
        tagged,
    )
