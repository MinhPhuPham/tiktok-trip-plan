from pathlib import Path

from tiktok_trip.export.schema import render_schema, trip_schema

SCHEMA_FILE = Path(__file__).resolve().parents[1] / "web" / "src" / "data" / "trip.schema.json"
REGENERATE = (
    "uv run python -m tiktok_trip.export.schema web/src/data/trip.schema.json"
    " && npm --prefix web run gen:types"
)


def test_web_schema_is_current() -> None:
    assert SCHEMA_FILE.exists(), f"{SCHEMA_FILE} is missing; run: {REGENERATE}"
    current = SCHEMA_FILE.read_text(encoding="utf-8")
    assert current == render_schema(), f"{SCHEMA_FILE.name} is stale; run: {REGENERATE}"


def test_schema_uses_serialised_names_and_requires_defaults() -> None:
    schema = trip_schema()
    props = schema["properties"]
    assert "tripDates" in props
    assert "trip_dates" not in props
    assert "roads" in schema["required"]
    plan_config = schema["$defs"]["MapPlanConfig"]["properties"]
    assert "dayStart" in plan_config
    labels = schema["$defs"]["MapLabels"]
    assert labels["properties"]["twelve_hour"]["type"] == "boolean"
