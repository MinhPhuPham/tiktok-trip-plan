# tiktok-trip

Python 3.12 CLI that turns TikTok food/place review links plus a target city into verified places,
grouped by compass direction from a center point, with nearby famous spots, day routes, and exports
(`output/trips/<en|vi>/trip.xlsx` with a Dashboard and a Plan-to-go sheet, `output/map.html`,
`output/mymaps/mymaps_<SECTOR>.csv`).
Product plan: `docs/PLAN.md`. Engineering contract and data-flow table: `docs/ARCHITECTURE.md`.

## Commands

```bash
npm --prefix web ci && npm --prefix web run build   # once (and after web/ changes): map app into export/web_dist
uv run tiktok-trip run                  # full pipeline; stops after resolve if review rows are pending
uv run tiktok-trip run --from resolve   # resume after review decisions (--to <step> to stop early)
uv run tiktok-trip add <url> [<url>...] # append links, fetch them, rebuild everything downstream
uv run tiktok-trip review               # list pending review rows
uv run tiktok-trip review "<key>" <place_id|skip>   # record one decision
uv run tiktok-trip <step>               # fetch media extract resolve enrich spatial nearby route export
uv run tiktok-trip route --collect      # agent mode: validate data/plan/plan.json even if older than the prompt
uv run tiktok-trip quota                # API calls this period vs the free-tier caps (config `quota`)
```

Step order: fetch, media, extract, resolve, enrich, spatial, nearby, route, export.
Config lives in `config.yaml` (city, center.hotel/override, sectors, travel mode, trip days), keys in `.env`.

## Rules

- Run steps in order. Every step is idempotent; re-running must not redo finished work.
- Never re-download a video if `data/raw/<id>` exists. Never re-call a paid API when `data/cache` has the answer.
- Never invent an address. Every address needs evidence (source plus short quote or timestamp); drop it otherwise.
- After `resolve`, if `data/review.json` has rows without a decision, stop and walk through them
  with the user (`/review`). Do not pass `--skip-review-gate` unless the user asks.
- Respect rate limits (Nominatim: 1 request/second). Every paid or rate-limited call is logged to
  `data/api_log.csv`; mention the Google call counts to the user when they are large.
- Changing the hotel or center only needs `run --from spatial`; nothing is re-downloaded.
- `data/` and `output/` are generated and gitignored. Never hand-edit `data/places.json` to fix a
  match; use `review` decisions instead.

## Own list and preferences

- `input/places.yaml`: the user's own places, `- section: "Ăn sáng"` with `places:` entries
  `"name | address | remark"`. `extract` collects them as candidates (video id `manual:places.yaml`,
  evidence source `manual`, recommendation strong); edit the file, then `extract` and
  `run --from resolve`.
- `input/preferences.yaml`: `must_go` / `removed` lists of names or place ids. Applied by `resolve`:
  must_go → priority `must` (the plan must include it); removed → status `skip` (out of zones, plan
  and exports). Resolve warns about names that match no place; fix the spelling or use the id.

## Extraction (done by Claude Code in this session)

1. Run `uv run tiktok-trip extract`. It writes `data/extract/<id>/prompt.md` for every video that
   has no `data/extract/<id>/candidates.json` yet and reports how many prompts are waiting.
2. For each reported `<id>`: read `data/extract/<id>/prompt.md` and view every frame image it lists
   (under `data/raw/<id>/frames/`).
3. Write `data/extract/<id>/candidates.json` following the JSON schema given in the prompt. Every
   address must carry `evidence`; keep `address_as_mentioned` exactly as seen or heard. Always set
   `recommendation` (strong / normal / none) as the prompt defines it, with the verbatim
   `recommendation_quote` and `recommendation_source` for strong and normal; it drives the place
   priority (high / medium / low).
4. Re-run `uv run tiktok-trip extract` to collect all candidates into `data/candidates.json`,
   then continue with `uv run tiktok-trip run --from resolve`.

## Day plan (done by Claude Code in this session, `plan.mode: agent`)

1. `uv run tiktok-trip route` writes `data/plan/prompt.md` and `data/plan/travel_minutes.csv` and
   exits with code 2 ("plan prompt waiting for Claude Code") while `data/plan/plan.json` is missing
   or older than the prompt (places or config changed).
2. Read the prompt and the matrix CSV, then write `data/plan/plan.json` exactly as the prompt's
   schema says: per day the stops in order as `{ref, slot, reason, reason_vi}` (short traveller
   notes in English and Vietnamese), places left out under `unplaced` with a `code`
   (out_of_days, too_far, low_priority, closed, out_of_window, other) and an optional `reason`.
   Follow the rhythm and the rules in the prompt.
3. Never invent times; the code computes them. Never invent ids: use the ids in the prompt or `rest`.
4. Run `uv run tiktok-trip route` again. On exit code 2 read `data/plan/validation.md`, fix every
   hard violation in plan.json (warnings when that breaks no hard rule) and repeat until it passes,
   then `uv run tiktok-trip run --from export`. `/plan` does this loop.

## Code conventions

Follow `docs/ARCHITECTURE.md`: full type hints, pydantic v2 models in `models.py`, every path from
`paths.py`, all HTTP through `CachedClient`, logging instead of `print`, no comments that restate code.
Tests never touch the network (`respx` for HTTP, `monkeypatch` for subprocesses).

```bash
uv run pytest -q
uv run ruff format src tests && uv run ruff check src tests
uv run mypy src/tiktok_trip
```
