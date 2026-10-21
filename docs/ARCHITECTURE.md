# Architecture

Read `docs/PLAN.md` for the product plan. This file is the engineering contract: layout, data flow, and conventions every module follows.

## Layout

```
src/tiktok_trip/
  cli.py          typer app. `run`, `add`, `review`, `quota`, `serve`, plus one command per step.
  context.py      Context(config, secrets, paths, api_log, quota) handed to every step.
  config.py       AppConfig (config.yaml) + Secrets (.env / env vars).
  models.py       All pydantic models shared between steps. Single source of truth.
  paths.py        Every file location. Never build a data path anywhere else.
  storage.py      JSON/CSV IO (atomic writes), load/save pydantic lists, ApiLog.
  http.py         CachedClient: file cache + retry + rate limit + quota check + api_log. All HTTP goes through it.
  quota.py        QuotaGuard: per-sku call caps (config `quota`) counted from api_log; QuotaExceededError.
  geo.py          Pure geometry: haversine, bearing, sector names, ring, DBSCAN, coordinate maps link.
  clock.py        "HH:MM" <-> minutes since midnight (no wrap unless asked), shared en dash.
  matching.py     Name/address matching for resolve; `fold` is the one diacritic folder.
  tags.py         Pure place tags (vocabulary, keyword/hours/hint rules, heuristic windows per tag).
  priority.py     Pure place priority rule (high/medium/low/None + reason) from mentions and recommendations;
                  `must` (rank above high) only from preferences.
  preferences.py  input/preferences.yaml (must_go / removed by name or id) applied to places in resolve.
  clients/        One module per external service. Thin: build request, parse response into models.
  steps/          One module per pipeline step. Each exposes `run(ctx: Context) -> None`.
  planning/       Agent-mode route: inputs.py (nodes, weekdays), matrix.py (TravelMatrix, CSV), prompt.py +
                  prompt_template.md (plan prompt), schema.py (plan.json), timing.py (clock + rule checks),
                  collect.py (plan.json → Itinerary, validation.md).
  export/         media.py (output/media preview images + index.json; `build_media`, `media_index`),
                  map_data.py (MapData JSON: places, plan, compass, road legs, both languages pre-formatted),
                  roads.py (OSRM road geometry per planned leg, keyed "<from>><to>" with the travel matrix ids),
                  map_html.py (fills the React build in web_dist/: output/map.html from web_dist/single, and
                  output/app/ = copy of web_dist/app + trip.json, manifest.webmanifest, media/, offline.json,
                  og-image.png, robots.txt; title + SEO head filled in both builds),
                  site.py (SITE_NAME, description, Open Graph / Twitter / canonical tags), og_image.py
                  (1200x630 preview card, Pillow, offline); missing build -> UserFacingError naming `npm --prefix web ci && npm --prefix web run build`;
                  Google basemap key only when `export.google_map`), schema.py (JSON schema of MapData for
                  web/), web_dist/ (build artifact of web/, never hand-edited; the map app source is
                  web/, see docs/WEB.md),
                  serve.py (`tiktok-trip serve`: stdlib HTTP for output/app only; media lives inside it), mymaps.py, excel.py (trip.xlsx: Dashboard + Plan-to-go sheets),
                  excel_dashboard.py (compass + plan at a glance), excel_plan.py (Plan-to-go sheet),
                  excel_style.py, i18n.py (EN/VI labels incl. `map_ui`, sheet names, clocks) and `run(ctx)` in __init__.py.
tests/            pytest. conftest gives `project` (tmp Paths with config.yaml) and `ctx`.
```

## Data flow (files under data/, see `Paths`)

| Step    | Reads                                   | Writes                                              |
|---------|-----------------------------------------|-----------------------------------------------------|
| fetch   | input/links.txt                         | raw/<video_id>/{video.mp4,info.json,comments.json}  |
|         | (yt-dlp; Playwright page scrape via clients/tiktok_comments.py when comments come back empty and `fetch.comments: playwright`) | raw/<id>/source.json (`comments_source`: yt-dlp, playwright or none; `has_video: false` for photo posts, which have no video.mp4) |
|         | photo posts: slide URLs from yt-dlp if listed, else the page's `imagePost` (Playwright, `/video/<id>` form of the link); clients/tiktok_images.py downloads them | raw/<id>/images/001.jpg… , raw/<id>/post.json (slide title, POI), source.json `image_count`, `images_source`; raw/<id>/audio.mp3 only when the sound is the creator's own |
| media   | raw/<id>/video.mp4, or a photo post's images/ and audio.* | raw/<id>/frames/*.jpg (photo posts: every slide, JPEG, long side <= 1920, no dedupe), raw/<id>/transcript.json (`reason` when final without audio) |
| extract | raw/<id>/*, extract/<id>/candidates.json | extract/<id>/prompt.md (for Claude Code), candidates.json (list[Candidate]; decorative symbols and emoji trimmed from `name` and `address_as_mentioned`) |
|         | input/places.yaml (extraction/manual.py) | candidates with video_id `manual:places.yaml`, video_url `input/places.yaml`, evidence source `manual`, recommendation strong; replaced as one set on every collect |
| resolve | candidates.json, review.json decisions  | places.json (list[Place]; `priority`/`priority_reason` recomputed each run; `candidate_keys` = the candidates merged in), review.json, review.csv, excluded.json (`other` candidates matching `resolve.exclude_keywords`, never sent to an API) |
|         | printed house number + street (`matching.house_address`: "21 X", "17/6 X", "3 Bis X", "Lô H19 X", "Số 1 X") | an option at exactly that number and street is accepted with name score >= `resolve.min_exact_address_name_score` (50) and a shared word (confidence <= 0.8, note "accepted on exact address, weak name"); the best plausible option on the same street at another number goes to review instead of being accepted |
|         | input/preferences.yaml                  | places.json `preference`: must_go → priority `must`; removed → status `skip` (spatial gives it no zone, route and export leave it out) |
| enrich  | places.json, raw caption/comments/transcript, candidates.json | places.json (hours, price, rating, tags, best_time with why/why_vi; every place gets one); raw/<id>/caption.txt cache. In a post naming several places, a place reads the caption plus only the comments/transcript lines that name it (a distinctive folded word of >= 4 letters or word pair from its name or its candidates' name/must_try); evidence says "comments about this place" |
| spatial | places.json, config.center              | places.json (spatial field), spatial.json (SpatialResult) |
|         | hotel/override text: Google first (biased to the city point), a hit counts only with name score >= 70 and <= 30 km from the city point, else the next provider; none → CenterNotFoundError ("lat,lng" needs no network) | spatial.json `center.place_id` when Google answered |
| nearby  | spatial.json                            | nearby.json (list[NearbySpot]; no city-named, 1-2 character or coordinate names, no bars/shops/offices without wiki tags) |
|         | Overpass: `nearby.overpass_endpoints` in order (mirrors; one 1 req/s limiter each, cache keyed on the canonical URL so any mirror's answer is reused) | a zone where every endpoint fails gets no spots, is not cached and is retried on the next run; the step never aborts the pipeline for it |
| route   | places.json, spatial.json, nearby.json  | `plan.mode: solver`: routes.json (Itinerary; `grouping` = trip.day_grouping: sector or nearest; `needed_days` when the places do not fit trip.days) |
|         | `plan.mode: agent` (default): plan/plan.json written by Claude Code | plan/prompt.md, plan/travel_minutes.csv (written only when the content changes), plan/validation.md; routes.json (`grouping` agent, stops carry `slot`, `reason` and `reason_vi`, `rest` stops, `unplaced` with `code`) only without hard violations, else exit code 2 |
| export  | all of the above, plan/travel_minutes.csv, input/preferences.yaml (map editor + preferences export) | output/trips/<lang: en, vi>/trip.xlsx (sheets Dashboard + Plan-to-go; VI: Tổng Hợp + Lịch Trình), output/map.html, output/app/ (web_dist/app with the head filled from `export.site_url` + trip.json, manifest.webmanifest, og-image.png, robots.txt, media/, offline.json; rebuilt from scratch), output/mymaps/mymaps_<sector>.csv, output/{places.json, review.csv}; deletes the old output/trip.xlsx, output/mymaps_*.csv and output/trips/<lang>/{dashboard,plan-to-go}.xlsx |
|         | OSRM (clients/osrm.py, `roads.endpoint`, 1 req/s, sku `osrm_route`) for each leg between consecutive stops of routes.json, skipped with `roads.enabled: false` | cache/osrm/ (Ok answers only); MapData `roads` {"<from>><to>": encoded polyline} (ids as in travel_minutes.csv: "center" for start/end/rest); a failed leg stays straight and is not cached, after the first failed request only cached legs are used, one warning per run, export never aborts for it; MapData `roads_enabled` / `roads_endpoint` / `roads_profile` let the web app fetch legs of edited plans itself (docs/WEB.md, routing/) |
|         | places.json, candidates.json (which post cited each frame), raw/<id>/frames (or images/); with `export.google_photos`: Google Place Details `photos` (sku place_details_essentials) + photo media (sku place_photos), image bytes over plain httpx | output/media/<place>/frame-<video>-<NNN>.jpg (cited frames, long side 640 px, menu-looking first, at most `export.max_frames_per_place`), google-<n>.jpg + google-<n>.json (attribution), output/media/index.json ({place_id: [MediaItem]}, read via `export.media.media_index`); runs before the map and workbook writers; stale frames removed, Google photos kept and never re-fetched |

Every step is idempotent and re-runnable: it must skip work whose output already exists and
must never re-download or re-call a paid API when the cache has the answer.

## Conventions

- Python 3.12, full type hints, pydantic v2 models for all persisted data.
- `ruff check` and `ruff format` clean (config in pyproject). `mypy` should pass on new modules.
- No comments that restate the code. A one-line docstring on a module or non-obvious function is fine.
- Small, pure functions for logic; IO at the edges (in `run`). Pure logic gets unit tests.
- Tests never hit the network: mock HTTP with `respx`, subprocesses with `monkeypatch`.
- Logging via `logging.getLogger(__name__)`, never `print`. CLI output uses `rich` console only in cli.py / review.
- External calls: build a `CachedClient` with `ctx.paths.cache`, `ctx.api_log`, the service name and
  `quota=ctx.quota` (`paid=True` for billed services). Pass `sku=` (required when paid; defaults to the
  service name), `units=` and a free-form `note=` so `data/api_log.csv` stays meaningful.
- `data/api_log.csv` columns: timestamp, service, sku, endpoint, units, cache_hit, note. Rows from
  before the sku column are still read (sku from a known note prefix such as `text_search_pro:`, else
  from the service) and the file is rewritten with the new header on the next write.
- Quotas: `QuotaGuard` (one per Context, log read once, then counted in memory) checks a sku before
  any uncached send. Real calls, failed ones included, count once each. Periods: UTC calendar month for `quota.monthly`, UTC day for
  `quota.daily`; skus without a cap are unlimited. A call that would pass `cap x safety_margin`
  raises `QuotaExceededError` (a `UserFacingError`, not an httpx error, so fallbacks do not swallow
  it) before anything is sent or logged; steps let it propagate and write nothing.
  An error status after retries raises `errors.ApiError` (a `UserFacingError` that is also an
  `httpx.HTTPStatusError`) with the service, URL and response body, and is logged as `error <status>`.
- Secrets: `ctx.secrets.require("google_maps_key")` raises a clear error. Steps that can work
  without a key (e.g. Overpass) must not require one. `GOOGLE_MAPS_KEY` (server, Places) is never
  written to output; only `GOOGLE_MAPS_BROWSER_KEY` may be embedded (map.html, output/app), and
  `export.secrets_guard` fails the export when the server key appears anywhere under `output/`.
- Weekday ints are Python convention: 0 = Monday … 6 = Sunday. Times are "HH:MM" strings.
- Place ids: `gp:<google_place_id>` or `osm:<type>/<id>`. Nearby spot ids likewise.
- Addresses are never invented. A Candidate keeps `address_as_mentioned` only when `evidence` is non-empty
  (enforced by the model). Resolve must not accept a match without name similarity and city check.
