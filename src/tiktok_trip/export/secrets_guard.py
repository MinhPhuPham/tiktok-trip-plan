"""Fails the export when the server-side Google key ended up in a deployable output."""

from __future__ import annotations

import logging
from pathlib import Path

from tiktok_trip.context import Context
from tiktok_trip.errors import UserFacingError

logger = logging.getLogger(__name__)

SKIP_DIRS = frozenset({".vercel", ".netlify", "node_modules"})


def find_secret(root: Path, secret: str, *, skip: frozenset[str] = SKIP_DIRS) -> list[Path]:
    """Files under root (sorted) whose bytes contain the UTF-8 encoded secret."""
    needle = secret.encode("utf-8")
    if not needle or not root.is_dir():
        return []
    hits: list[Path] = []
    for path in sorted(root.rglob("*")):
        if skip.intersection(path.relative_to(root).parts) or not path.is_file():
            continue
        try:
            if needle in path.read_bytes():
                hits.append(path)
        except OSError as exc:
            logger.warning("Cannot scan %s for the server key: %s", path, exc)
    return hits


def assert_no_server_key(ctx: Context, root: Path) -> None:
    key = ctx.secrets.google_maps_key
    if not key:
        return
    hits = find_secret(root, key)
    if hits:
        names = ", ".join(path.relative_to(root).as_posix() for path in hits)
        raise UserFacingError(
            f"GOOGLE_MAPS_KEY (server key) found in {names}. Nothing was deleted; fix the export "
            "and run it again. Never deploy output/ with that key."
        )
    logger.info("No server key in %s/", root.name)
