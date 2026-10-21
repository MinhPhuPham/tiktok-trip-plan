from __future__ import annotations

import csv
import json
import logging
import os
import tempfile
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, TypeAdapter

from tiktok_trip.models import ApiCall

log = logging.getLogger(__name__)


def read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, default=str)
        os.replace(tmp_name, path)
    except BaseException:
        Path(tmp_name).unlink(missing_ok=True)
        raise


def load_model[ModelT: BaseModel](path: Path, model: type[ModelT]) -> ModelT:
    return model.model_validate(read_json(path))


def save_model(path: Path, item: BaseModel) -> None:
    write_json(path, item.model_dump(mode="json"))


def load_models[ModelT: BaseModel](path: Path, model: type[ModelT]) -> list[ModelT]:
    if not path.exists():
        return []
    return TypeAdapter(list[model]).validate_python(read_json(path))  # type: ignore[valid-type]


def save_models(path: Path, items: Sequence[BaseModel]) -> None:
    write_json(path, [item.model_dump(mode="json") for item in items])


def write_csv(path: Path, header: Sequence[str], rows: Iterable[Sequence[Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


LEGACY_NOTE_SKUS = {
    "text_search_pro": "text_search_pro",
    "details_pro": "place_details_pro",
    "details_enterprise": "place_details_enterprise",
    "place_details_pro": "place_details_pro",
    "place_details_enterprise": "place_details_enterprise",
}
LEGACY_SERVICE_SKUS = {"google_nearby": "nearby_search_enterprise"}


def legacy_sku(service: str, note: str) -> str:
    """The sku of a row logged before the sku column existed: a known note prefix, else service."""
    prefix, colon, _ = note.partition(":")
    if colon and prefix in LEGACY_NOTE_SKUS:
        return LEGACY_NOTE_SKUS[prefix]
    return LEGACY_SERVICE_SKUS.get(service, service)


class ApiLog:
    """Append-only record of every paid or rate-limited external call.

    Files written before the sku column existed are read as is and upgraded on the next write.
    """

    HEADER = ("timestamp", "service", "sku", "endpoint", "units", "cache_hit", "note")

    def __init__(self, path: Path) -> None:
        self.path = path
        self._header_checked = False

    def record(
        self,
        service: str,
        endpoint: str,
        *,
        sku: str = "",
        units: int = 1,
        cache_hit: bool = False,
        note: str = "",
    ) -> ApiCall:
        call = ApiCall(
            timestamp=datetime.now(UTC).replace(microsecond=0),
            service=service,
            sku=sku or service,
            endpoint=endpoint,
            units=units,
            cache_hit=cache_hit,
            note=note,
        )
        self._upgrade_header()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        is_new = not self.path.exists()
        with self.path.open("a", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            if is_new:
                writer.writerow(self.HEADER)
            writer.writerow(_row(call))
        return call

    def read(self) -> list[ApiCall]:
        if not self.path.exists():
            return []
        with self.path.open(newline="", encoding="utf-8-sig") as handle:
            return [call for row in csv.DictReader(handle) if (call := _parse(row)) is not None]

    def _upgrade_header(self) -> None:
        if self._header_checked:
            return
        self._header_checked = True
        if not self.path.exists():
            return
        with self.path.open(newline="", encoding="utf-8-sig") as handle:
            header = next(csv.reader(handle), None)
        if header is None or "sku" in header:
            return
        calls = self.read()
        fd, tmp_name = tempfile.mkstemp(
            dir=self.path.parent, prefix=f".{self.path.name}.", suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(self.HEADER)
                writer.writerows(_row(call) for call in calls)
            os.replace(tmp_name, self.path)
        except BaseException:
            Path(tmp_name).unlink(missing_ok=True)
            raise


def _row(call: ApiCall) -> list[Any]:
    return [
        call.timestamp.isoformat(timespec="seconds"),
        call.service,
        call.sku,
        call.endpoint,
        call.units,
        call.cache_hit,
        call.note,
    ]


def _parse(row: dict[str, str | None]) -> ApiCall | None:
    service, note = row.get("service") or "", row.get("note") or ""
    try:
        timestamp = datetime.fromisoformat(row.get("timestamp") or "")
        return ApiCall(
            timestamp=timestamp if timestamp.tzinfo else timestamp.replace(tzinfo=UTC),
            service=service,
            sku=row.get("sku") or legacy_sku(service, note),
            endpoint=row.get("endpoint") or "",
            units=int(row.get("units") or 0),
            cache_hit=(row.get("cache_hit") or "").strip().lower() == "true",
            note=note,
        )
    except ValueError:
        log.debug("Skipping unreadable api_log row: %s", row)
        return None
