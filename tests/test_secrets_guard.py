from __future__ import annotations

import dataclasses
from pathlib import Path

import pytest

from tiktok_trip.config import Secrets
from tiktok_trip.context import Context
from tiktok_trip.errors import UserFacingError
from tiktok_trip.export.secrets_guard import assert_no_server_key, find_secret

KEY = "AIzaSERVER-secret-0123456789"


def test_find_secret_hits_and_misses(tmp_path: Path) -> None:
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "a.json").write_text(f'{{"k": "{KEY}"}}', encoding="utf-8")
    (tmp_path / "b.bin").write_bytes(b"\x00\x01" + KEY.encode() + b"\xff")
    (tmp_path / "clean.txt").write_text("nothing here")
    assert find_secret(tmp_path, KEY) == [tmp_path / "b.bin", tmp_path / "sub" / "a.json"]
    assert find_secret(tmp_path, "other") == []
    assert find_secret(tmp_path / "missing", KEY) == []


def test_find_secret_skips_deploy_state_dirs(tmp_path: Path) -> None:
    for name in (".vercel", ".netlify", "node_modules"):
        (tmp_path / name).mkdir()
        (tmp_path / name / "x.txt").write_text(KEY)
    assert find_secret(tmp_path, KEY) == []
    assert find_secret(tmp_path, KEY, skip=frozenset()) != []


def test_assert_no_server_key_raises_with_paths(ctx: Context, tmp_path: Path) -> None:
    keyed = dataclasses.replace(ctx, secrets=Secrets(google_maps_key=KEY))
    (tmp_path / "app").mkdir()
    (tmp_path / "app" / "trip.json").write_text(KEY)
    with pytest.raises(
        UserFacingError, match=r"GOOGLE_MAPS_KEY \(server key\) found in app/trip.json"
    ):
        assert_no_server_key(keyed, tmp_path)


def test_assert_no_server_key_passes(
    ctx: Context, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    keyed = dataclasses.replace(ctx, secrets=Secrets(google_maps_key=KEY))
    (tmp_path / "ok.txt").write_text("fine")
    with caplog.at_level("INFO"):
        assert_no_server_key(keyed, tmp_path)
    assert any("No server key" in r.getMessage() for r in caplog.records)
    (tmp_path / "leak.txt").write_text(KEY)
    assert_no_server_key(dataclasses.replace(ctx, secrets=Secrets()), tmp_path)
