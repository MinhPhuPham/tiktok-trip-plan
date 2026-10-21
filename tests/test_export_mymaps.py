from __future__ import annotations

import csv
import logging
from pathlib import Path

import pytest
from fixtures.sample_dataset import build_dataset

from tiktok_trip.export import mymaps
from tiktok_trip.export.dataset import ExportData


@pytest.fixture
def data() -> ExportData:
    return build_dataset()


def read(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def test_one_file_per_sector_with_places(data: ExportData, tmp_path: Path) -> None:
    written = mymaps.write_mymaps(data, tmp_path)
    names = {path.name for path in written}
    assert names == {f"mymaps_{s}.csv" for s in ("N", "NE", "E", "SE", "S", "SW", "W")}
    assert not (tmp_path / "mymaps_NW.csv").exists()


def test_columns_bom_and_content(data: ExportData, tmp_path: Path) -> None:
    mymaps.write_mymaps(data, tmp_path)
    path = tmp_path / "mymaps_N.csv"
    assert path.read_bytes().startswith(b"\xef\xbb\xbf")
    rows = read(path)
    assert list(rows[0]) == list(mymaps.HEADER)
    assert len(rows) == 3
    first = rows[0]
    assert first["Name"] == "Phở Hòa Pasteur"
    assert float(first["Latitude"]) == pytest.approx(10.7721 + 1.2 / 111 * 0.996, abs=1e-3)
    assert first["Zone"] == "N-1"
    assert first["Category"] == "food"
    assert "heuristic" in first["Best time"]
    assert first["Maps link"].startswith("https://www.google.com/maps/search/?api=1&query=")
    assert first["Video"].startswith("https://www.tiktok.com/")


def test_stale_files_removed(data: ExportData, tmp_path: Path) -> None:
    stale = tmp_path / "mymaps_NW.csv"
    stale.write_text("old")
    mymaps.write_mymaps(data, tmp_path)
    assert not stale.exists()


def test_row_limit_warns(
    data: ExportData,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(mymaps, "MAX_ROWS_PER_FILE", 2)
    with caplog.at_level(logging.WARNING):
        mymaps.write_mymaps(data, tmp_path)
    assert any("at most 2 per file" in record.message for record in caplog.records)


def test_notes_include_must_try(data: ExportData) -> None:
    place = next(place for place in data.places if place.must_try)
    assert mymaps.notes_text(place).startswith("Must try: ")
