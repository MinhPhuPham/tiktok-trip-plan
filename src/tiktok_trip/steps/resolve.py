"""Step 4: turn candidates into verified places, or review rows for a human.

Every run recomputes from candidates.json, review decisions and the HTTP cache (so re-runs
cost no API calls), then carries enrichment over from the previous places.json by id.
"""

from __future__ import annotations

import logging
import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field

import httpx

from tiktok_trip.clients import geocoder as geocoding
from tiktok_trip.clients.geocoder import GeoPoint
from tiktok_trip.clients.google_places import GooglePlacesClient, SearchPlace
from tiktok_trip.config import ResolveConfig
from tiktok_trip.context import Context
from tiktok_trip.errors import ApiError, UserFacingError
from tiktok_trip.geo import haversine_km
from tiktok_trip.matching import (
    HouseMatch,
    branch_score,
    evidence_segments,
    fold,
    house_address,
    house_match,
    name_score,
    shares_word,
)
from tiktok_trip.models import (
    Candidate,
    Category,
    Evidence,
    ExcludedCandidate,
    Place,
    ReviewOption,
    ReviewReason,
    ReviewRow,
)
from tiktok_trip.preferences import Preferences, apply_preferences, load_preferences
from tiktok_trip.priority import Signal, rate
from tiktok_trip.storage import load_models, save_models, write_csv

log = logging.getLogger(__name__)

CLOSED = "CLOSED_PERMANENTLY"
OPERATIONAL = "OPERATIONAL"
SKIP = "skip"
HUMAN_CONFIDENCE = 1.0
NAME_GREY_BAND = 15.0
BRANCH_MARGIN = 15.0
NAME_TIE_MARGIN = 5.0
SAME_SPOT_KM = 0.05
MAX_OPTIONS = 3
MAX_ERRORS_SHOWN = 5
WEAK_NAME_CONFIDENCE = 0.8
WEAK_NAME_NOTE = "accepted on exact address, weak name"

REVIEW_CSV_HEADER = (
    "key",
    "video_url",
    "name",
    "address_as_mentioned",
    "reason",
    "option_1",
    "option_2",
    "option_3",
    "decision",
)

GOOGLE_TYPE_CATEGORY = {
    "cafe": Category.CAFE,
    "coffee_shop": Category.CAFE,
    "tea_house": Category.CAFE,
    "restaurant": Category.FOOD,
    "food": Category.FOOD,
    "meal_takeaway": Category.FOOD,
    "bakery": Category.FOOD,
    "tourist_attraction": Category.ATTRACTION,
    "museum": Category.ATTRACTION,
    "park": Category.ATTRACTION,
    "historical_landmark": Category.ATTRACTION,
    "place_of_worship": Category.ATTRACTION,
    "observation_deck": Category.ATTRACTION,
}

ENRICHED_FIELDS = ("hours", "price_range", "rating", "rating_count", "spatial", "status")


@dataclass(frozen=True)
class Match:
    place_id: str
    name: str
    address: str
    lat: float
    lng: float
    distance_km: float
    name_score: float
    branch_score: float | None = None
    business_status: str = OPERATIONAL
    types: tuple[str, ...] = ()
    house: HouseMatch | None = None
    """How the option's address relates to the printed house number and street, if any."""

    def option(self) -> ReviewOption:
        return ReviewOption(
            place_id=self.place_id,
            name=self.name,
            address=self.address,
            lat=self.lat,
            lng=self.lng,
            distance_km=round(self.distance_km, 2),
            name_score=self.name_score,
        )


@dataclass(frozen=True)
class Accept:
    match: Match
    weak_name: bool = False
    """Accepted on the exact printed address although the name score is below the minimum."""


@dataclass(frozen=True)
class Review:
    reason: ReviewReason
    options: list[Match] = field(default_factory=list)


@dataclass(frozen=True)
class NoMatch:
    outside: list[Match] = field(default_factory=list)


Outcome = Accept | Review | NoMatch


def mentions(text: str, phrase: str) -> bool:
    """True when `phrase` appears as whole words in `text`, ignoring case and diacritics."""
    return re.search(rf"(?<!\w){re.escape(fold(phrase))}(?!\w)", fold(text)) is not None


def exclusion_reason(candidate: Candidate, keywords: Iterable[str]) -> str | None:
    """Why an `other` candidate is left out (first keyword found in its name, then notes)."""
    if candidate.category is not Category.OTHER:
        return None
    for label, text in (("name", candidate.name), ("notes", candidate.notes or "")):
        for keyword in keywords:
            if keyword.strip() and text and mentions(text, keyword):
                return f"keyword {keyword!r} in {label}"
    return None


def search_query(candidate: Candidate, city: str) -> str:
    """Name, address as mentioned, and the city unless the address already names it."""
    address = candidate.address_as_mentioned or ""
    suffix = "" if city and mentions(address, city) else city
    return " ".join(p for p in (candidate.name, address, suffix) if p)


def api_error_summary(errors: dict[str, list[str]], total: int) -> str:
    """One message for the CLI: which candidates hit which API error; outputs were left as is."""
    failed = sum(len(keys) for keys in errors.values())
    lines = [
        f"Resolve stopped: {failed} of {total} candidate(s) hit an API error, so places.json "
        "and review.json were left unchanged. Fix the cause and run "
        "`tiktok-trip run --from resolve` (answers already received are cached)."
    ]
    for message, keys in list(errors.items())[:MAX_ERRORS_SHOWN]:
        shown = ", ".join(keys[:3]) + (f" and {len(keys) - 3} more" if len(keys) > 3 else "")
        lines.append(f"- {shown}: {message}")
    if len(errors) > MAX_ERRORS_SHOWN:
        lines.append(f"- ... and {len(errors) - MAX_ERRORS_SHOWN} other error(s)")
    return "\n".join(lines)


def score(
    candidate: Candidate,
    *,
    place_id: str,
    name: str,
    address: str,
    lat: float,
    lng: float,
    center: tuple[float, float],
    regions: Sequence[str],
    business_status: str | None = None,
    types: Iterable[str] = (),
) -> Match:
    evidence = evidence_segments(candidate.address_as_mentioned, candidate.landmarks, regions)
    return Match(
        place_id=place_id,
        name=name,
        address=address,
        lat=lat,
        lng=lng,
        distance_km=haversine_km(center[0], center[1], lat, lng),
        name_score=name_score(candidate.name, name),
        branch_score=branch_score(evidence, name, address, regions),
        business_status=business_status or OPERATIONAL,
        types=tuple(types),
        house=house_match(house_address(candidate.address_as_mentioned), address),
    )


def score_google(
    candidate: Candidate,
    hits: Sequence[SearchPlace],
    center: tuple[float, float],
    regions: Sequence[str],
) -> list[Match]:
    return [
        score(
            candidate,
            place_id=hit.place_id,
            name=hit.name,
            address=hit.address,
            lat=hit.lat,
            lng=hit.lng,
            center=center,
            regions=regions,
            business_status=hit.business_status,
            types=hit.types,
        )
        for hit in hits
    ]


def score_osm(
    candidate: Candidate, point: GeoPoint, center: tuple[float, float], regions: Sequence[str]
) -> Match | None:
    if point.osm_ref is None:
        return None
    return score(
        candidate,
        place_id=point.osm_ref,
        name=point.display_name.split(",")[0].strip(),
        address=point.display_name,
        lat=point.lat,
        lng=point.lng,
        center=center,
        regions=regions,
    )


def _rank_key(match: Match) -> tuple[float, float]:
    return (match.branch_score or 0.0, match.name_score)


def is_ambiguous(ranked: Sequence[Match], *, has_evidence: bool) -> bool:
    """True when the two best plausible branches are too close to pick one automatically."""
    if len(ranked) < 2:
        return False
    first, second = ranked[0], ranked[1]
    if haversine_km(first.lat, first.lng, second.lat, second.lng) <= SAME_SPOT_KM:
        return False
    if has_evidence:
        return (first.branch_score or 0.0) - (second.branch_score or 0.0) < BRANCH_MARGIN
    return first.name_score - second.name_score < NAME_TIE_MARGIN


def _weak_ties(best: Match, others: Iterable[Match]) -> list[Match]:
    """Other shops at the same printed address whose names fit about as (weakly) well.

    Listings of one strongly named shop at its printed address are duplicates, not ties.
    """
    return [
        m
        for m in others
        if best.name_score - m.name_score < NAME_TIE_MARGIN
        and haversine_km(best.lat, best.lng, m.lat, m.lng) > SAME_SPOT_KM
    ]


def assess_house(
    candidate: Candidate, in_city: Sequence[Match], plausible: Sequence[Match], cfg: ResolveConfig
) -> Outcome | None:
    """Rules for a printed house number; None leaves the decision to the general rules.

    The exact number and street outweigh a brand spelled differently (KIWI / Kimi) when the
    name is at least `min_exact_address_name_score` similar and shares a word. A plausible
    option on the same street at another number may be another branch or shop: a human decides.
    """
    open_in_city = [m for m in in_city if m.business_status != CLOSED]
    exact = sorted(
        (m for m in open_in_city if m.house == "exact"),
        key=lambda m: (m.name_score, m.branch_score or 0.0),
        reverse=True,
    )
    named_exact = [
        m
        for m in exact
        if m.name_score >= cfg.min_exact_address_name_score and shares_word(candidate.name, m.name)
    ]
    if named_exact:
        best = named_exact[0]
        weak = best.name_score < cfg.min_name_score
        if weak and (tied := _weak_ties(best, named_exact[1:])):
            return Review("ambiguous_branch", [best, *tied][:MAX_OPTIONS])
        if candidate.confidence < cfg.review_below_confidence:
            return Review("low_confidence", named_exact[:MAX_OPTIONS])
        return Accept(best, weak_name=weak)
    if plausible and plausible[0].house == "street":
        options = _unique([*exact, *plausible])[:MAX_OPTIONS]
        return Review("ambiguous_branch" if len(options) > 1 else "low_confidence", options)
    return None


def assess_plausible(
    candidate: Candidate, plausible: Sequence[Match], cfg: ResolveConfig
) -> Outcome:
    """One clear branch among open, similarly named options inside the city."""
    has_evidence = any(m.branch_score is not None for m in plausible)
    if is_ambiguous(plausible, has_evidence=has_evidence):
        return Review("ambiguous_branch", list(plausible[:MAX_OPTIONS]))
    best = plausible[0]
    address_contradicts = bool(candidate.address_as_mentioned) and best.branch_score == 0
    if candidate.confidence < cfg.review_below_confidence or address_contradicts:
        return Review("low_confidence", list(plausible[:MAX_OPTIONS]))
    return Accept(best)


def assess(candidate: Candidate, matches: Sequence[Match], cfg: ResolveConfig) -> Outcome:
    """Apply the acceptance rules: inside the city, similar name, not closed, one clear branch."""
    in_city = [m for m in matches if m.distance_km <= cfg.max_city_distance_km]
    named = [m for m in in_city if m.name_score >= cfg.min_name_score]
    plausible = sorted(
        (m for m in named if m.business_status != CLOSED), key=_rank_key, reverse=True
    )
    if house_address(candidate.address_as_mentioned) is not None and (
        decided := assess_house(candidate, in_city, plausible, cfg)
    ):
        return decided
    if plausible:
        return assess_plausible(candidate, plausible, cfg)
    if closed := [m for m in named if m.business_status == CLOSED]:
        return Review("closed", closed[:MAX_OPTIONS])
    floor = cfg.min_name_score - NAME_GREY_BAND
    grey = sorted(
        (m for m in in_city if floor <= m.name_score < cfg.min_name_score),
        key=lambda m: m.name_score,
        reverse=True,
    )
    if grey:
        return Review("low_name_score", grey[:MAX_OPTIONS])
    outside = [
        m
        for m in matches
        if m.distance_km > cfg.max_city_distance_km and m.name_score >= cfg.min_name_score
    ]
    return NoMatch(sorted(outside, key=lambda m: m.distance_km))


def osm_fallback(fallback: Outcome, google: NoMatch) -> Review:
    """A geocoder point has no branch, status or category data: a human confirms it."""
    if isinstance(fallback, Accept):
        return Review("low_confidence", [fallback.match])
    if isinstance(fallback, Review):
        return fallback
    if outside := [*google.outside, *fallback.outside]:
        return Review("outside_city", outside[:MAX_OPTIONS])
    return Review("not_found")


def category_for(candidate: Candidate, types: Iterable[str]) -> Category:
    if candidate.category is not Category.OTHER:
        return candidate.category
    for google_type in types:
        if google_type in GOOGLE_TYPE_CATEGORY:
            return GOOGLE_TYPE_CATEGORY[google_type]
    return Category.OTHER


def build_place(
    candidate: Candidate,
    *,
    place_id: str,
    name: str,
    address: str,
    lat: float,
    lng: float,
    confidence: float,
    business_status: str = OPERATIONAL,
    types: Iterable[str] = (),
) -> Place:
    return Place(
        id=place_id,
        name=name,
        category=category_for(candidate, types),
        address=address,
        address_as_mentioned=candidate.address_as_mentioned,
        lat=lat,
        lng=lng,
        business_status=business_status,
        must_try=list(candidate.must_try),
        notes=[candidate.notes] if candidate.notes else [],
        videos=[candidate.video_url],
        candidate_keys=[candidate.key],
        evidence=list(candidate.evidence),
        confidence=confidence,
    )


def place_from_match(candidate: Candidate, match: Match, confidence: float) -> Place:
    return build_place(
        candidate,
        place_id=match.place_id,
        name=match.name,
        address=match.address,
        lat=match.lat,
        lng=match.lng,
        confidence=confidence,
        business_status=match.business_status,
        types=match.types,
    )


def accepted_place(candidate: Candidate, outcome: Accept) -> Place:
    if not outcome.weak_name:
        return place_from_match(candidate, outcome.match, candidate.confidence)
    place = place_from_match(
        candidate, outcome.match, min(candidate.confidence, WEAK_NAME_CONFIDENCE)
    )
    note = f"{WEAK_NAME_NOTE} (name score {outcome.match.name_score:g})"
    return place.model_copy(update={"notes": [*place.notes, note]})


def _unique[T](items: Iterable[T]) -> list[T]:
    seen: list[T] = []
    for item in items:
        if item not in seen:
            seen.append(item)
    return seen


def merge_places(existing: Place, new: Place) -> Place:
    """Combine two mentions of the same place id; enrichment on `existing` is kept."""
    evidence: list[Evidence] = _unique([*existing.evidence, *new.evidence])
    return existing.model_copy(
        update={
            "videos": _unique([*existing.videos, *new.videos]),
            "candidate_keys": _unique([*existing.candidate_keys, *new.candidate_keys]),
            "evidence": evidence,
            "must_try": _unique([*existing.must_try, *new.must_try]),
            "notes": _unique([*existing.notes, *new.notes]),
            "address_as_mentioned": existing.address_as_mentioned or new.address_as_mentioned,
            "confidence": max(existing.confidence, new.confidence),
            "category": existing.category
            if existing.category is not Category.OTHER
            else new.category,
        }
    )


def post_sizes(candidates: Iterable[Candidate]) -> Counter[str]:
    """Distinct places each video names, so a single-place post counts as a dedicated review."""
    return Counter(video_id for video_id, _ in {(c.video_id, c.key) for c in candidates})


def signal(candidate: Candidate, sizes: Mapping[str, int]) -> Signal:
    source = candidate.recommendation_source
    return Signal(
        strength=candidate.recommendation,
        post_places=sizes.get(candidate.video_id, 1),
        quote=candidate.recommendation_quote,
        source=source.value if source else None,
    )


def prioritize(place: Place, sources: Sequence[Candidate], sizes: Mapping[str, int]) -> Place:
    """Recompute priority from every candidate merged into the place (nothing manual is kept)."""
    rating = rate(place.mention_count, [signal(c, sizes) for c in sources])
    return place.model_copy(update={"priority": rating.priority, "priority_reason": rating.reason})


def carry_enrichment(previous: Place | None, fresh: Place) -> Place:
    """Keep fields filled by later steps. best_time is kept only if the videos did not change.

    A status set by a `removed` preference is not carried: preferences are applied afresh.
    """
    if previous is None:
        return fresh
    update = {
        name: getattr(previous, name)
        for name in ENRICHED_FIELDS
        if getattr(previous, name) is not None
    }
    if previous.preference == "removed":
        update.pop("status", None)
    if previous.best_time is not None and previous.videos == fresh.videos:
        update["best_time"] = previous.best_time
    return fresh.model_copy(update=update)


def review_row(candidate: Candidate, outcome: Review, decision: str | None = None) -> ReviewRow:
    return ReviewRow(
        candidate=candidate,
        reason=outcome.reason,
        options=[m.option() for m in outcome.options],
        decision=decision,
    )


def _option_cell(option: ReviewOption) -> str:
    return f"{option.name} | {option.address} | {option.place_id}"


def review_csv_rows(rows: Iterable[ReviewRow]) -> list[list[str]]:
    table: list[list[str]] = []
    for row in rows:
        options = [_option_cell(o) for o in row.options[:MAX_OPTIONS]]
        options += [""] * (MAX_OPTIONS - len(options))
        table.append(
            [
                row.key,
                row.candidate.video_url,
                row.candidate.name,
                row.candidate.address_as_mentioned or "",
                row.reason,
                *options,
                row.decision or "",
            ]
        )
    return table


def save_review(ctx: Context, rows: Sequence[ReviewRow]) -> None:
    save_models(ctx.paths.review_file, rows)
    write_csv(ctx.paths.review_csv, REVIEW_CSV_HEADER, review_csv_rows(rows))


class Resolver:
    """IO wrapper: clients are created lazily so cached or decided runs need no network."""

    def __init__(self, ctx: Context) -> None:
        self.ctx = ctx
        self.cfg = ctx.config.resolve
        self.city = ctx.config.city
        self.regions = (self.city, *ctx.config.city_profile.aliases)
        self._google: GooglePlacesClient | None = None
        self._geocoder: geocoding.FallbackGeocoder | None = None
        self._center: tuple[float, float] | None = None

    @property
    def google(self) -> GooglePlacesClient:
        if self._google is None:
            self._google = GooglePlacesClient(self.ctx)
        return self._google

    @property
    def geocoder(self) -> geocoding.FallbackGeocoder:
        if self._geocoder is None:
            self._geocoder = geocoding.build(self.ctx)
        return self._geocoder

    @property
    def center(self) -> tuple[float, float]:
        if self._center is None:
            point = self.geocoder.city_point(self.city)
            if point is None:
                raise UserFacingError(
                    f"Could not find a city point for {self.city!r} with any geocoder."
                )
            self._center = (point.lat, point.lng)
            log.info(
                "City center for %s (%s): %.5f, %.5f", self.city, point.source, point.lat, point.lng
            )
        return self._center

    def resolve(self, candidate: Candidate) -> Outcome:
        """Google first; an OSM point (Nominatim/Photon) is only ever offered for review.

        The fallback uses `osm_only()`: a Google answer there would be a paid call with no OSM id.
        """
        query = search_query(candidate, self.city)
        hits = self.google.text_search(
            query, center=self.center, radius_m=self.cfg.max_city_distance_km * 1000
        )
        outcome = assess(
            candidate, score_google(candidate, hits, self.center, self.regions), self.cfg
        )
        if not isinstance(outcome, NoMatch):
            return outcome
        point = self.geocoder.osm_only().geocode(query)
        osm = score_osm(candidate, point, self.center, self.regions) if point else None
        return osm_fallback(assess(candidate, [osm] if osm else [], self.cfg), outcome)

    def decided_place(self, row: ReviewRow) -> Place:
        choice = row.decision
        if not choice or choice == SKIP:
            raise ValueError(f"Row {row.key!r} has no place decision.")
        candidate = row.candidate
        option = next((o for o in row.options if o.place_id == choice), None)
        if option is not None:
            return build_place(
                candidate,
                place_id=option.place_id,
                name=option.name,
                address=option.address,
                lat=option.lat,
                lng=option.lng,
                confidence=HUMAN_CONFIDENCE,
                business_status=CLOSED if row.reason == "closed" else OPERATIONAL,
            )
        if choice.startswith("gp:"):
            hit = self.google.place(choice.removeprefix("gp:"))
            if hit is None:
                raise ValueError(f"Google returned no location for {choice}.")
            return build_place(
                candidate,
                place_id=hit.place_id,
                name=hit.name,
                address=hit.address,
                lat=hit.lat,
                lng=hit.lng,
                confidence=HUMAN_CONFIDENCE,
                business_status=hit.business_status or OPERATIONAL,
                types=hit.types,
            )
        raise ValueError(f"{choice} is not one of the options and is not a gp: place id.")

    def close(self) -> None:
        if self._google is not None:
            self._google.close()
        if self._geocoder is not None:
            self._geocoder.close()


def _add(places: dict[str, Place], place: Place) -> bool:
    """Insert or merge; True when the place id was already present (a duplicate)."""
    if place.id in places:
        places[place.id] = merge_places(places[place.id], place)
        return True
    places[place.id] = place
    return False


@dataclass
class Tally:
    places: dict[str, Place] = field(default_factory=dict)
    sources: defaultdict[str, list[Candidate]] = field(default_factory=lambda: defaultdict(list))
    reviews: list[ReviewRow] = field(default_factory=list)
    excluded: list[ExcludedCandidate] = field(default_factory=list)
    stats: Counter[str] = field(default_factory=Counter)
    api_errors: defaultdict[str, list[str]] = field(default_factory=lambda: defaultdict(list))

    def exclude(self, candidate: Candidate, reason: str) -> None:
        self.excluded.append(
            ExcludedCandidate(key=candidate.key, name=candidate.name, reason=reason)
        )
        self.stats["excluded"] += 1

    def add(self, place: Place, candidate: Candidate) -> None:
        self.stats["deduped" if _add(self.places, place) else "accepted"] += 1
        self.sources[place.id].append(candidate)

    def prioritized(self, sizes: Mapping[str, int]) -> list[Place]:
        return [prioritize(p, self.sources[p.id], sizes) for p in self.places.values()]

    def aliases(self) -> dict[str, list[str]]:
        """Names the candidates used for each place, for matching preferences."""
        return {pid: _unique(c.name for c in sources) for pid, sources in self.sources.items()}


def with_preferences(
    places: Sequence[Place], prefs: Preferences, aliases: Mapping[str, Sequence[str]]
) -> list[Place]:
    """Apply input/preferences.yaml and warn about entries that match no place."""
    applied = apply_preferences(places, prefs, aliases)
    for kind, entry in applied.unmatched:
        log.warning(
            "preferences.yaml %s %r matches no place in places.json "
            "(check the spelling or the place id; it may still be waiting in review)",
            kind,
            entry,
        )
    for place_id in applied.conflicts:
        log.warning("preferences.yaml lists %s under both must_go and removed; removed", place_id)
    marked = Counter(p.preference for p in applied.places if p.preference)
    if marked:
        log.info("Preferences: %d must-go, %d removed", marked["must_go"], marked["removed"])
    return applied.places


def _process(
    resolver: Resolver, tally: Tally, candidate: Candidate, prior: ReviewRow | None
) -> None:
    """Resolve one candidate into `tally`; API errors are collected there, not raised."""
    try:
        if prior is not None and prior.decision:
            row = prior.model_copy(update={"candidate": candidate})
            place = None if row.decision == SKIP else resolver.decided_place(row)
            tally.reviews.append(row)
            if place is None:
                tally.stats["skipped"] += 1
            else:
                tally.add(place, candidate)
            return
        outcome = resolver.resolve(candidate)
    except httpx.HTTPError as exc:
        reason = str(exc) if isinstance(exc, ApiError) else f"{type(exc).__name__}: {exc}"
        tally.api_errors[reason].append(candidate.key)
        log.warning("API error for %s; continuing with the other candidates", candidate.key)
        return
    except ValueError as exc:
        tally.stats["failed"] += 1
        log.warning("Could not resolve %s: %s", candidate.key, exc)
        if prior is not None:
            tally.reviews.append(prior)
        return
    if isinstance(outcome, Accept):
        tally.add(accepted_place(candidate, outcome), candidate)
    elif isinstance(outcome, Review):
        tally.reviews.append(review_row(candidate, outcome))
        tally.stats["review"] += 1


def run(ctx: Context) -> None:
    """Rebuild places.json and review.json from candidates.json and every recorded decision.

    Re-deciding a row therefore drops the place an earlier decision added. An API or network
    error on any candidate leaves both files untouched and raises once the others are scored.
    """
    if not ctx.paths.candidates_file.exists():
        log.warning("No %s yet; run extract first.", ctx.paths.candidates_file.name)
        return
    candidates = load_models(ctx.paths.candidates_file, Candidate)
    prefs = load_preferences(ctx.paths.preferences_file)
    previous = {p.id: p for p in load_models(ctx.paths.places_file, Place)}
    prior_rows = {r.key: r for r in load_models(ctx.paths.review_file, ReviewRow)}
    resolver = Resolver(ctx)
    tally = Tally()
    seen: set[str] = set()
    try:
        for candidate in candidates:
            if candidate.key in seen:
                continue
            seen.add(candidate.key)
            if reason := exclusion_reason(candidate, ctx.config.resolve.exclude_keywords):
                tally.exclude(candidate, reason)
            else:
                _process(resolver, tally, candidate, prior_rows.get(candidate.key))
    finally:
        resolver.close()
    if tally.api_errors:
        raise UserFacingError(api_error_summary(tally.api_errors, len(seen)))

    places, reviews, stats = tally.places, tally.reviews, tally.stats
    sizes = post_sizes(candidates)
    carried = [carry_enrichment(previous.get(p.id), p) for p in tally.prioritized(sizes)]
    result = with_preferences(carried, prefs, tally.aliases())
    dropped = len(set(previous) - set(places))
    save_models(ctx.paths.places_file, result)
    save_review(ctx, reviews)
    save_models(ctx.paths.excluded_file, tally.excluded)
    log.info(
        "Resolve: %d accepted, %d deduped, %d sent to review, %d skipped, %d excluded, "
        "%d failed → %d places%s",
        stats["accepted"],
        stats["deduped"],
        stats["review"],
        stats["skipped"],
        stats["excluded"],
        stats["failed"],
        len(result),
        f" ({dropped} no longer produced, removed)" if dropped else "",
    )
