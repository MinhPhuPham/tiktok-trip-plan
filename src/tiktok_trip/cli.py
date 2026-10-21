from __future__ import annotations

import importlib
import logging
from enum import StrEnum
from typing import Annotated

import typer
from rich.console import Console
from rich.logging import RichHandler

from tiktok_trip.context import Context
from tiktok_trip.errors import GateError, UserFacingError
from tiktok_trip.storage import load_models

app = typer.Typer(
    help="TikTok review links in, verified and routed trip plan out.", no_args_is_help=True
)
console = Console()


class Step(StrEnum):
    FETCH = "fetch"
    MEDIA = "media"
    EXTRACT = "extract"
    RESOLVE = "resolve"
    ENRICH = "enrich"
    SPATIAL = "spatial"
    NEARBY = "nearby"
    ROUTE = "route"
    EXPORT = "export"


PIPELINE = list(Step)


@app.callback()
def _setup(verbose: Annotated[bool, typer.Option("--verbose", "-v")] = False) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(message)s",
        handlers=[RichHandler(console=console, show_path=False, rich_tracebacks=True)],
    )


def _run_step(ctx: Context, step: Step, *, collect_plan: bool = False) -> None:
    module_name = "tiktok_trip.export" if step is Step.EXPORT else f"tiktok_trip.steps.{step.value}"
    console.rule(f"[bold]{step.value}")
    module = importlib.import_module(module_name)
    try:
        if step is Step.ROUTE:
            module.run(ctx, collect=collect_plan)
        else:
            module.run(ctx)
    except GateError as exc:
        console.print(f"[yellow]{exc}[/]")
        raise typer.Exit(code=exc.exit_code) from None
    except UserFacingError as exc:
        console.print(f"[red]{exc}[/]")
        raise typer.Exit(code=exc.exit_code) from None


def _pending_review(ctx: Context) -> int:
    from tiktok_trip.models import ReviewRow

    return sum(1 for row in load_models(ctx.paths.review_file, ReviewRow) if row.decision is None)


def _run_from(
    ctx: Context, first: Step, last: Step = Step.EXPORT, *, stop_for_review: bool = True
) -> None:
    """Stops with exit code 2 at the review gate (after resolve) and at the plan gate (route in
    agent mode, while data/plan/plan.json is missing, stale or has hard violations)."""
    for step in PIPELINE[PIPELINE.index(first) : PIPELINE.index(last) + 1]:
        _run_step(ctx, step)
        if step is Step.RESOLVE and stop_for_review and (pending := _pending_review(ctx)):
            console.print(
                f"[yellow]{pending} candidate(s) need a human decision.[/] "
                "Run [bold]tiktok-trip review[/], then [bold]tiktok-trip run --from resolve[/] "
                "(re-applies every decision from the HTTP cache, no new API calls, and continues "
                "with enrich, spatial, nearby, route and export). Never run the later steps one "
                "by one without enrich."
            )
            raise typer.Exit(code=2)


@app.command()
def run(
    from_step: Annotated[Step, typer.Option("--from", help="First step to run")] = Step.FETCH,
    to_step: Annotated[Step, typer.Option("--to", help="Last step to run")] = Step.EXPORT,
    skip_review_gate: Annotated[
        bool, typer.Option(help="Continue even when review rows are pending")
    ] = False,
) -> None:
    """Run the pipeline, stopping after resolve when places need human review."""
    _run_from(Context.load(), from_step, to_step, stop_for_review=not skip_review_gate)


@app.command()
def add(urls: Annotated[list[str], typer.Argument(help="TikTok URLs to add")]) -> None:
    """Fetch new links, append them to input/links.txt and rebuild everything downstream."""
    from tiktok_trip.steps import fetch

    ctx = Context.load()
    fetch.add_links(ctx, urls)
    _run_from(ctx, Step.FETCH)


@app.command()
def review(
    key: Annotated[str | None, typer.Argument(help="Candidate key shown by the list")] = None,
    choice: Annotated[str | None, typer.Argument(help="place_id to accept, or 'skip'")] = None,
) -> None:
    """List pending review rows, or record a decision for one of them."""
    from tiktok_trip.steps import review as review_step

    ctx = Context.load()
    if key is None:
        review_step.show(ctx, console)
    elif choice is None:
        raise typer.BadParameter("Provide a place_id or 'skip' together with the key.")
    else:
        review_step.decide(ctx, key, choice)


@app.command()
def quota() -> None:
    """Show this period's API calls against the local free-tier caps (config.yaml `quota`)."""
    from rich.table import Table

    from tiktok_trip.quota import FREE_SERVICES

    guard = Context.load().quota
    table = Table(title=f"API quota (local limit = {guard.safety_margin:.0%} of each free cap)")
    table.add_column("SKU", no_wrap=True)
    table.add_column("Period")
    for name in ("Used", "Free cap", "Limit", "Remaining"):
        table.add_column(name, justify="right")
    table.add_column("Resets (UTC)")
    for status in guard.statuses():
        limit = status.limit
        style = "red" if status.remaining == 0 else None
        table.add_row(
            limit.sku,
            limit.period,
            str(status.used),
            str(limit.cap),
            str(limit.effective_cap),
            str(status.remaining),
            status.resets_at.strftime("%Y-%m-%d %H:%M"),
            style=style,
        )
    console.print(table)
    free = ", ".join(
        f"{sku} {guard.used(sku, 'day')} today / {guard.used(sku, 'month')} this month"
        for sku in FREE_SERVICES
    )
    console.print(f"Free services, no cap (real calls): {free}")


@app.command()
def serve(
    port: Annotated[int, typer.Option(help="TCP port")] = 8765,
    host: Annotated[
        str, typer.Option(help="Interface to bind; 0.0.0.0 lets a phone on the same Wi-Fi in")
    ] = "0.0.0.0",
) -> None:
    """Serve output/app (the map as an installable offline app) until Ctrl+C."""
    from tiktok_trip.export.serve import lan_address, make_server

    paths = Context.load().paths
    if not (paths.app_dir / "index.html").exists():
        console.print(f"[red]{paths.app_dir} is missing.[/] Run [bold]tiktok-trip export[/] first.")
        raise typer.Exit(code=1)
    server = make_server(paths.app_dir, host, port)
    bound = server.server_address[1]
    console.print(
        f"Trip map: [bold]http://localhost:{bound}/[/] (offline app: install it from there)"
    )
    if host in ("0.0.0.0", "") and (address := lan_address()):
        console.print(
            f"Phone on the same Wi-Fi: [bold]http://{address}:{bound}/[/] (plain http: it works "
            "online, but browsers allow offline caching and install only on https or localhost)"
        )
    console.print(
        "[dim]The page embeds your Google key when export.google_map is on. Ctrl+C stops.[/]"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        console.print("Stopped.")
    finally:
        server.server_close()


@app.command(name="route")
def route_command(
    collect: Annotated[
        bool,
        typer.Option(
            "--collect", help="Agent mode: validate data/plan/plan.json even if it is older"
        ),
    ] = False,
) -> None:
    """Run only the route step (agent mode: write the plan prompt or collect plan.json)."""
    _run_step(Context.load(), Step.ROUTE, collect_plan=collect)


for _step in (
    Step.FETCH,
    Step.MEDIA,
    Step.EXTRACT,
    Step.RESOLVE,
    Step.ENRICH,
    Step.SPATIAL,
    Step.NEARBY,
    Step.EXPORT,
):

    def _make(step: Step):  # type: ignore[no-untyped-def]
        def command() -> None:
            _run_step(Context.load(), step)

        command.__doc__ = f"Run only the {step.value} step."
        return command

    app.command(name=_step.value)(_make(_step))


if __name__ == "__main__":
    app()
