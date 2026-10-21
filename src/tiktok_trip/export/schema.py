"""JSON schema of trip.json (MapData as serialised), the source of web/src/data/trip.gen.ts.

Usage: python -m tiktok_trip.export.schema web/src/data/trip.schema.json
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Any

from pydantic.json_schema import GenerateJsonSchema
from pydantic_core import core_schema

from tiktok_trip.export.map_data import MapData

logger = logging.getLogger(__name__)

SCHEMA_ID = "https://tiktok-trip.local/trip.schema.json"

FieldSchema = (
    core_schema.ModelField
    | core_schema.DataclassField
    | core_schema.TypedDictField
    | core_schema.ComputedField
)


class SerializedSchema(GenerateJsonSchema):
    """Every serialised field is present in trip.json, so a default does not make it optional.

    Fields carry no title, so json-schema-to-typescript names only the models.
    """

    def field_title_should_be_set(self, schema: core_schema.CoreSchema | FieldSchema) -> bool:
        return False

    def field_is_required(
        self,
        field: core_schema.ModelField | core_schema.DataclassField | core_schema.TypedDictField,
        total: bool,
    ) -> bool:
        if self.mode == "serialization":
            return not field.get("serialization_exclude")
        return super().field_is_required(field, total)


def trip_schema() -> dict[str, Any]:
    schema = MapData.model_json_schema(
        by_alias=True, mode="serialization", schema_generator=SerializedSchema
    )
    return {"$id": SCHEMA_ID, **schema}


def render_schema() -> str:
    return json.dumps(trip_schema(), indent=2, ensure_ascii=False) + "\n"


def write_schema(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_schema(), encoding="utf-8")
    logger.info("Wrote %s", path)


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if len(argv) != 1:
        logger.error("Usage: python -m tiktok_trip.export.schema <path/to/trip.schema.json>")
        return 2
    write_schema(Path(argv[0]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
