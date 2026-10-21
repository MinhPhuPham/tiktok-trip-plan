"""Human review of resolve results: list pending rows and record decisions."""

from __future__ import annotations

import difflib
import logging
import re

import httpx
import typer
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from tiktok_trip.config import MissingSecretError
from tiktok_trip.context import Context
from tiktok_trip.errors import UserFacingError
from tiktok_trip.models import ReviewOption, ReviewRow
from tiktok_trip.steps import resolve
from tiktok_trip.steps.resolve import SKIP, save_review
from tiktok_trip.storage import load_models

log = logging.getLogger(__name__)

_GOOGLE_RAW_ID = re.compile(r"^[A-Za-z0-9_-]{16,}$")


def shell_quote(text: str) -> str:
    escaped = re.sub(r'(["\\$`])', r"\\\1", text)
    return f'"{escaped}"'


def decide_command(key: str, choice: str = "<option#|place_id|skip>") -> str:
    return f"tiktok-trip review {shell_quote(key)} {choice}"


def _option_line(number: int, option: ReviewOption) -> str:
    facts = []
    if option.distance_km is not None:
        facts.append(f"{option.distance_km:.1f} km")
    if option.name_score is not None:
        facts.append(f"name {option.name_score:.0f}")
    detail = f" ({', '.join(facts)})" if facts else ""
    return f"{number}. {option.name} — {option.address}{detail}\n   {option.place_id}"


def pending(rows: list[ReviewRow]) -> list[ReviewRow]:
    return [row for row in rows if row.decision is None]


def show(ctx: Context, console: Console) -> None:
    rows = pending(load_models(ctx.paths.review_file, ReviewRow))
    if not rows:
        console.print("[green]No pending review rows.[/]")
        return
    table = Table(title=f"{len(rows)} candidate(s) need a decision", show_lines=True)
    for column in ("Key", "Name", "Address as mentioned", "Reason", "Options"):
        table.add_column(column, overflow="fold")
    for row in rows:
        options = "\n".join(_option_line(i, o) for i, o in enumerate(row.options, start=1))
        table.add_row(
            escape(row.key),
            escape(row.candidate.name),
            escape(row.candidate.address_as_mentioned or "—"),
            row.reason,
            escape(options or "no options"),
        )
    console.print(table)
    console.print("Decide with an option number, a place id, or skip:")
    for row in rows:
        example = row.options[0].place_id if row.options else SKIP
        console.print(f"  {escape(decide_command(row.key, example))}", soft_wrap=True)


def normalize_choice(row: ReviewRow, choice: str) -> str:
    """Map a 1-based option number, a place id, a bare Google id, or "skip" to a decision."""
    value = choice.strip()
    if value.lower() == SKIP:
        return SKIP
    if value.isdigit():
        index = int(value)
        if not 1 <= index <= len(row.options):
            raise typer.BadParameter(
                f"Option {index} does not exist; {row.key!r} has {len(row.options)} option(s)."
            )
        return row.options[index - 1].place_id
    if any(o.place_id == value for o in row.options):
        return value
    if value.startswith("gp:") and len(value) > 3:
        return value
    if _GOOGLE_RAW_ID.match(value):
        return f"gp:{value}"
    raise typer.BadParameter(
        f"{choice!r} is not an option number, one of the listed place ids, a gp:<id>, or 'skip'."
    )


def decide(ctx: Context, key: str, choice: str) -> None:
    rows = load_models(ctx.paths.review_file, ReviewRow)
    index = next((i for i, row in enumerate(rows) if row.key == key), None)
    if index is None:
        close = difflib.get_close_matches(key, [r.key for r in rows], n=3)
        hint = f" Did you mean: {', '.join(repr(k) for k in close)}?" if close else ""
        raise typer.BadParameter(f"No review row with key {key!r}.{hint}")
    decision = normalize_choice(rows[index], choice)
    rows[index] = rows[index].model_copy(update={"decision": decision})
    save_review(ctx, rows)
    log.info("Recorded %s for %s", decision, key)
    try:
        resolve.run(ctx)
    except (httpx.HTTPError, MissingSecretError, UserFacingError, ValueError) as exc:
        log.warning(
            "Decision saved, but places.json was not rebuilt (%s). "
            "Run `tiktok-trip run --from resolve`.",
            exc,
        )
