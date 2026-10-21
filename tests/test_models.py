from tiktok_trip.models import Candidate, Evidence, EvidenceSource, Place


def test_candidate_drops_address_without_evidence() -> None:
    candidate = Candidate(
        video_id="v1", video_url="u", name="Bánh Xèo", address_as_mentioned="12 X", confidence=0.9
    )
    assert candidate.address_as_mentioned is None


def test_candidate_keeps_address_with_evidence() -> None:
    candidate = Candidate(
        video_id="v1",
        video_url="u",
        name="Bánh Xèo",
        address_as_mentioned="12 X",
        evidence=[Evidence(source=EvidenceSource.CAPTION, quote="12 X, Q1")],
        confidence=0.9,
    )
    assert candidate.address_as_mentioned == "12 X"


def test_place_computed_fields_serialize() -> None:
    place = Place(
        id="gp:ChIJabc",
        name="Phở A",
        address="1 B",
        lat=10.7,
        lng=106.7,
        confidence=1.0,
        videos=["a", "b"],
    )
    dumped = place.model_dump(mode="json")
    assert dumped["mention_count"] == 2
    assert dumped["maps_url"].endswith("&query_place_id=ChIJabc")
    assert Place.model_validate(dumped).mention_count == 2
