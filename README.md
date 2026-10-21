# tiktok-trip

Give it a list of TikTok review links and a target city. It finds the places mentioned, verifies them
on Google Places, groups them by compass direction from a center point (your hotel or the city
center), adds famous spots nearby, builds time-saving day routes, and exports an Excel workbook, an
interactive map and Google My Maps files.

It is built to run inside [Claude Code](https://claude.com/claude-code): Python does the heavy work,
Claude Code reads each video's prompt and frames, writes the place candidates, and walks you through
uncertain matches. Extraction runs inside your Claude Code session, so no extra key is needed for it.

## Prerequisites

- [uv](https://docs.astral.sh/uv/) and Python 3.12
- `brew install ffmpeg` (key frames and audio)
- Speech transcripts use faster-whisper, installed by default by `uv sync` and `uv run` (dependency
  group `whisper`; `uv sync --no-group whisper` leaves it out, and the media step then writes empty
  transcripts)
- For TikTok comments: Google Chrome, or `uv run playwright install chromium`. yt-dlp often returns
  no TikTok comments, so fetch opens the video page in a browser and reads them there
  (`fetch.comments`; never logs in)
- API keys:
  - `GOOGLE_MAPS_BROWSER_KEY` (optional) only for the Google basemap (`export.google_map`); the only key ever embedded in `map.html` / `output/app`.
  - `GOOGLE_MAPS_KEY` (required, server key) for Google Places: verifies addresses in resolve, fills hours/price/rating in enrich. Free monthly caps apply; see [Google Cloud setup](#google-cloud-setup).
  - Travel times in route are always estimated from straight-line distance, so the itinerary is approximate.
  - No Claude API key: extraction happens inside your Claude Code session.

## Setup

```bash
uv sync
cp .env.example .env        # then fill in the keys
```

Edit `config.yaml`. The decisions that matter:

| Key | Meaning |
|-----|---------|
| `city` | Target city, e.g. `Ho Chi Minh City` |
| `city_profile` | `aliases` (city/province names stripped when comparing addresses), `best_months` + `best_months_note` (months for the best-time heuristic), `viewpoints` (famous viewpoints, suggested at sunset). Defaults describe Ho Chi Minh City |
| `city_profile.center_landmark` | Default center when no hotel/override: a landmark that marks downtown (in Vietnamese cities, the central market), e.g. `Chợ Đà Lạt`; `center_landmark_en` is its English name. Geocoded with Google Text Search when a key is set (the Maps link opens the exact listing), else Photon/Nominatim; ignored if more than 5 km from the city point. Defaults `Chợ Bến Thành` / `Ben Thanh Market`; `""` uses the city point |
| `center.hotel` | Hotel address. If filled it is the center of all directions |
| `center.override` | Landmark name or `lat,lng` to force a center (used when no hotel) |
| `spatial.sectors` | `4` or `8` directions; `spatial.rings_km` sets the distance rings |
| `travel.mode` | `walking`, `motorbike` or `car` |
| `trip.days`, `trip.day_start`, `trip.day_end` | Trip length and daily hours (the solver's day window) |
| `plan.mode` | `agent` (default): Claude Code builds the day-by-day plan from `data/plan/prompt.md` and the code computes every time; `solver`: the OR-Tools route. See [Plan to go](#plan-to-go-agent-mode) |
| `plan.day_start`, `plan.day_end` | Agent plan window, default `04:00` to `22:00` |
| `plan.rhythm` | Slots of the day in order, each `{id, name_en, name_vi, start, end, categories, hint}`. Defaults: sunrise 04:30–07:00, breakfast 07:00–08:30, morning 08:30–11:30, lunch 11:30–13:00, rest 13:00–14:30 (hotel/center, no place), cafe 14:30–17:30, dinner 17:30–19:30, evening 19:30–22:00. Guidance, not hard windows; the slot name is the Activity column of the Plan-to-go sheet and of the Dashboard's plan at a glance |
| `plan.target_places_per_day` | Places a day the plan prompt aims for, default `8`: the target is the smallest of this, `trip.max_places_per_day` and ceil(places / days). Places that do not fit go under `unplaced`, high priority first |
| `plan.rest_at_center` | `true`: long days get a `rest` stop at the hotel/center in the rest slot |
| `fetch.comments` | `playwright` (default): when yt-dlp saves no comments but the video has some, read them from the web page in Chrome/Chromium. `none` turns this off. `fetch.headless`: TikTok shows headless Chrome a captcha, so config.yaml ships with `false` and a Chrome window opens briefly; if TikTok shows a captcha there too, solve it in the window. Scraped only when `comments.json` is empty, so later runs reuse the result |
| `resolve.exclude_keywords` | Words that mark lodging, transport and rental services (default `homestay`, `hotel`, `khách sạn`, `villa`, `resort`, `glamping`, `nhà xe`, `thuê xe`, `thuê đồ`, `rental`, `motor`, `head spa`, `tiệm gội`, `bus`). A candidate of category `other` whose name or notes contain one as a whole word (case and diacritics ignored) is skipped before any Google call, counted as `excluded` and listed in `data/excluded.json` (`key`, `name`, `reason`). Food, café and attraction candidates are never excluded; `[]` turns it off |
| `export.google_map` | `false` (default). `true` adds a Google Maps basemap to `map.html`: the file then embeds `GOOGLE_MAPS_BROWSER_KEY` (never the server key `GOOGLE_MAPS_KEY`; export logs a warning to referrer-restrict it before deploying), see [Google Cloud setup](#google-cloud-setup). Without a browser key the option is left out |
| `export.basemaps` | Basemaps offered in `map.html`, in order. Default `[google, openfreemap, esri_streets, esri_satellite]`; `osm` adds OpenStreetMap raster tiles. See the Layers button under [Outputs](#outputs) |
| `roads` | Day routes on the map follow real roads: the export step asks an OSRM server for each leg between consecutive stops. `roads.enabled` (default `true`; `false` sends no request and draws straight lines), `roads.endpoint` (default the FOSSGIS server `https://routing.openstreetmap.de`, free fair use, 1 request/second), `roads.profiles` (path segment per `travel.mode`, default motorbike and car `routed-car`, walking `routed-foot`; `routed-bike` also exists there) |
| `quota` | Local call caps per SKU so a run never leaves the free tiers; see [Local quota guard](#local-quota-guard) |
| `export.max_frames_per_place` | Video frames cited as evidence that export copies to `output/media` per place, default `4`, menu-looking frames first (the evidence quote has a price such as `45.000` or `30k`, or says menu / thực đơn / bảng giá). No API call |
| `export.google_photos`, `export.max_photos_per_place` | `false` (default). `true` also downloads up to `max_photos_per_place` (default `1`) Google Maps photos per Google-matched place into `output/media`: one Place Details call with only the `photos` field (SKU `place_details_essentials`) and one Place Photos call per photo (SKU `place_photos`), both capped under `quota`; the image download itself is not billed. A photo already in `output/media` is never fetched again. Needs `GOOGLE_MAPS_KEY`; see [Preview images](#preview-images) for the attribution rule |
| `media.whisper_model`, `media.whisper_compute_type` | faster-whisper model (default `large-v3`) and its CTranslate2 compute type (default `int8`: about half the memory of `float32` on CPU and 2-3x faster, with negligible accuracy loss; `float16` suits a GPU, `default` keeps the model's stored type) |
| `extract.max_comments` | How many comments go into each extraction prompt. Every frame the media step kept (at most `media.max_frames`) is listed |

With no hotel and no override, the center is `city_profile.center_landmark` (the central market), or
the OSM city point labelled "Trung tâm <city>" when the landmark is not found, and the outputs say
so (`city_default`). Every center carries a Google Maps link (`maps_url` in spatial.json). Set a hotel later and re-run `uv run tiktok-trip run --from spatial`.

## Google Cloud setup

1. In [Google Cloud Console](https://console.cloud.google.com/) create or pick a project and link a
   billing account. Places API (New) needs billing even when every call stays inside the free caps.
2. APIs & Services, Library: enable **Places API (New)** (`places.googleapis.com`). The legacy
   Places API and Geocoding API are not used. Only with `export.google_map: true` also enable
   **Maps JavaScript API** (the Google basemap in `map.html`; 10,000 free map loads a month, one load
   each time you pick the Google basemap after opening the file).
3. APIs & Services, Credentials: create two API keys and edit each.
   - Server key, `GOOGLE_MAPS_KEY` in `.env` (Places, never written to `output/`): API restrictions:
     Restrict key, Places API (New) only. Application restrictions: None, or IP addresses (your
     public IP). HTTP referrer restrictions do not work for a command-line tool.
   - Browser key, `GOOGLE_MAPS_BROWSER_KEY` in `.env` (only with `export.google_map: true`; the only key
     embedded in `map.html` and `output/app`): Application restrictions: Websites (HTTP referrers),
     `https://<your-site>/*`. API restrictions: Maps JavaScript API only. A local `map.html` sends no
     referrer, so the Google basemap only loads from your deployed site.
4. Second line of defence: APIs & Services, Places API (New), Quotas & System Limits. Lower the
   request quotas of the methods this tool calls (Text Search, Get Place, Nearby Search) so a runaway
   loop stops at Google too. Where a per-day quota is offered, about 150/day for Text Search, 60/day
   for Get Place and 30/day for Nearby Search keeps a runaway day far below the monthly free caps
   (5,000 Text Search Pro, 1,000 Place Details Enterprise, 1,000 Nearby Search Enterprise); otherwise
   lower the per-minute quota. Cloud quotas are per method, not per SKU (Get Place serves both Place
   Details Pro and Enterprise), so the local guard below is the precise limit. A billing budget
   alert is a sensible extra.

### Local quota guard

Every external call is logged to `data/api_log.csv` with its SKU (the billing unit the field mask
selects). Before sending a call that is not cached, the tool counts this period's real calls for that
SKU (failed ones included, cache hits not) and refuses the call when it would pass
`cap x safety_margin`. The step then stops with a one-line error and leaves `places.json` as it was;
nothing is sent. Re-running after the reset costs nothing for the work already done, because answers
are cached.

```yaml
quota:
  safety_margin: 0.9        # stop at 90% of each free cap
  monthly:                  # Google: per SKU per calendar month (UTC)
    text_search_pro: 5000
    place_details_pro: 5000
    place_details_enterprise: 1000
    nearby_search_enterprise: 1000
    place_details_essentials: 10000   # export.google_photos: photo names per place
    place_photos: 1000                # export.google_photos: one call per photo
```

These numbers are also the built-in defaults; a SKU you leave out keeps its default, and a SKU with no
cap anywhere (Photon, Overpass, Nominatim) is unlimited. A warning is logged once per SKU when usage
passes 80% of its limit. `uv run tiktok-trip quota` shows used, cap, limit, remaining and the reset
time for every capped SKU, plus today's and this month's calls to the free services.

## Quick start

1. Put one TikTok URL per line in `input/links.txt`.
2. In Claude Code, run `/run`. Or from a shell: `uv run tiktok-trip run`.
3. Extraction loop: `uv run tiktok-trip extract` writes `data/extract/<id>/prompt.md` for every video
   without candidates. Claude Code reads each prompt and the frame images it lists, writes
   `data/extract/<id>/candidates.json`, then re-runs `uv run tiktok-trip extract` to collect them into
   `data/candidates.json`. Continue with `uv run tiktok-trip run --from resolve`. (`/run` does this
   loop for you.)
4. If resolve flags uncertain matches the run stops with exit code 2. Use `/review`
   (or `uv run tiktok-trip review`, then `uv run tiktok-trip review "<key>" <place_id|skip>`), then
   `uv run tiktok-trip run --from resolve` (re-applies every decision from the cache, no new API calls).
5. Add links later with `/add <url>` or `uv run tiktok-trip add <url>`.
6. Plan gate (agent mode, the default): `route` writes `data/plan/prompt.md` and stops with exit
   code 2 until Claude Code writes a valid `data/plan/plan.json` (`/plan`, or `/run` does it), then
   `uv run tiktok-trip run --from route`.

Single steps: `uv run tiktok-trip fetch|media|extract|resolve|enrich|spatial|nearby|route|export`.
API usage against the free caps: `uv run tiktok-trip quota`.
Use `run --from <step> --to <step>` for ranges.

## Outputs

```
output/
  trips/en/trip.xlsx         Dashboard (compass + plan at a glance) and Plan-to-go (day summary + every stop)
  trips/vi/trip.xlsx         The same in Vietnamese, 24-hour clock: sheets Tổng Hợp and Lịch Trình
  map.html                   Single-page map app: plan and places side panel, filters, basemaps, EN/VI (see below)
  app/                       The same app as an installable PWA (trip.json, media/, offline.json, service worker); deploy this folder
  mymaps/mymaps_<SECTOR>.csv One file per direction for Google My Maps (one layer each)
  media/<place>/              Preview images per place (JPEG, long side 640 px): frame-<video>-<NNN>.jpg, google-<n>.jpg
  media/index.json           {place_id: [{src, kind, caption, source_url, attributions}]} for the map and workbook
  places.json                Master data (source of truth, including the evidence for every place)
  review.csv                 Matches that still need a human decision
```

Each export removes files from older layouts (`output/trip.xlsx`, `output/mymaps_*.csv`,
`output/trips/<lang>/dashboard.xlsx` and `plan-to-go.xlsx`).

`trip.xlsx` has two sheets:

- Dashboard (Tổng Hợp): title, totals (including the high-priority count), and the 3×3 compass.
  Each compass block lists a place as two cells, its name (Google Maps link, prefixed ★★★ / ★★ / ★
  for high / medium / low priority) and `6:30 AM–3:00 PM (best: 7:00–9:00 AM)` with the place's tags
  on a second line (`breakfast · view`; an estimated best time says `estimate` / `ước tính`), high priority and
  most mentioned first; a legend line sits under the compass; sector colors match the map. To its right, the plan at a glance: one block per day, headed
  `Day 1 · <areas> · 8:00 AM–8:05 PM` in the day's color, then one row per stop: Activity (the
  rhythm slot, rest rows included), Place (Google Maps link; the center for start, end and rest),
  Time (`8:12–8:57 AM`, `8:12–8:57` in Vietnamese) and Note (the planner's reason, cut at 60
  characters). Before the route step has run it shows `Plan not generated yet: run tiktok-trip route`.
- Plan-to-go (Lịch Trình): the day-by-day plan (agent mode, see below) or the optimised route
  (solver). A summary at the top gives one row per day: areas, stop count, start/end, total and
  travel minutes and Google Maps directions links (several when a day has more than 9 waypoints).
  Below it every day in order under a colored heading, one row per stop with activity, place
  (Google Maps link), priority (High / Medium / Low; Cao / Vừa / Thấp), type, area, arrive/leave times, minutes there, travel to the next stop, open
  hours, best time (with `(estimate)` / `(ước tính)` when heuristic, and its reason on a second line),
  tags (translated: `breakfast · view`, `ăn sáng · view đẹp`), price and a note (reason + the first
  sentence of the place's notes). The header
  of that table is frozen and filterable; places the plan left out are listed at the bottom with
  their reasons.

The full per-place detail (address, rating, evidence, confidence, ...) lives in `places.json`.

### Preview images

Export copies, per place, the video frames and photo-post slides its evidence cites (the frames
Claude Code read the name, address, menu or dish from) into `output/media/<place>/`, resized to a
640 px long side, at most `export.max_frames_per_place`, menu-looking frames first. A frame is
taken from the post whose candidate cited it, so a place mentioned in several posts never gets
another post's frame. Frames no longer cited are removed on the next export; nothing under `data/`
changes.

With `export.google_photos: true` the Google Maps photo(s) of each `gp:` place are added after the
frames (`kind: photo`). Google's terms require showing the photo's author with it: each photo's
`attributions` (author display names and profile links) and its `caption`
(`Google Maps photo by <names>`) are in `index.json` and must be shown wherever the photo is shown.
Downloaded photos stay in `output/media` (they are not removed with stale frames) and are not
fetched again; the API answers are also cached under `data/cache`.

`output/media/index.json`, one entry per place that has at least one image:

```json
{"gp:ChIJ...": [{"src": "media/gp_ChIJ.../frame-7690...-005.jpg", "kind": "frame",
  "caption": "MENU bún bò 45.000", "source_url": "https://www.tiktok.com/@.../video/7690...",
  "attributions": []}]}
```

`src` is relative to `output/`, so `map.html` can use it as is.

### Place priority

Extraction records per candidate how strongly the post recommends the place: `recommendation`
(`strong`: singled out, "phải thử", "ngon nhất", "top 1", a review of only this place, the
creator's own strong praise; `normal`: praised among others; `none`: only listed) with the
verbatim `recommendation_quote` and its `recommendation_source`. A strong or normal claim without
a quote counts as `none`. Resolve recomputes `priority` and `priority_reason` on every place each
run from all of its candidates (`src/tiktok_trip/priority.py`):

| Signal | priority | priority_reason |
|--------|----------|-----------------|
| mentioned in 2+ videos, or any post says `strong` | high | `recommended in 3 posts`, `strong: 'phải thử…' (caption)` |
| one video, `normal`, or the only place in its post | medium | `recommended: '…' (transcript)`, `dedicated post (the only place in it)` |
| one video, `none`, in a multi-place list/slideshow | low | `listed in a 29-place post` |
| one video, extracted before the field existed | empty | empty |
| listed under `must_go` in `input/preferences.yaml` | must (★★★★, "Must go" / "Phải đi") | `must-go (input/preferences.yaml)` |

The plan prompt lists must-go places first, then high priority, and asks the planner to place
every must-go and high-priority place, prefer medium over low, and leave low-priority places under
`unplaced` ("low priority, out of time") when time is short.

### Tags and best time

Enrich gives every place `tags` (what it is good for) and a `best_time` with a short reason
(`best_time.why`, Vietnamese in `best_time.why_vi`). Tags come from the table-driven rules in
`src/tiktok_trip/tags.py` over the name, must-try dishes and notes (Vietnamese, or plain ASCII
matched without diacritics), the opening hours, a best time the posts give, and a `meal:` hint in
the notes (`meal: breakfast`, `meal: lunch, dinner`):

| Tag | From (examples) | Heuristic best time |
|-----|-----------------|---------------------|
| breakfast | food: bún, phở, bánh mì, xôi, cháo, bánh căn, bánh cuốn; "ăn sáng"; opens ≤ 7:00 and closes ≤ 12:00 | 06:30–09:00 |
| lunch | food: cơm, bún chả; "ăn trưa"; else open over lunch | 11:30–13:00 |
| dinner | food: lẩu, nướng, BBQ, buffet, nhà hàng, ốc, nhậu; "ăn tối"; opens ≥ 16:00 | 17:30–20:00 |
| snack / dessert | bánh tráng, ăn vặt; kem, sữa chua, chè, bánh su, flan, bánh ngọt | 15:00–17:00, else 18:00–21:00 |
| late_night | "ăn khuya", "ăn đêm", 24/7; opens ≥ 21:00 or closes ≥ 23:30 | 21:00–23:30 |
| view / sunset | view, ngắm, rooftop, đồi, rừng thông, thung lũng / hoàng hôn, sunset | 15:00–17:30 / 16:30–18:00 |
| sunrise / cloud_hunting | bình minh, sunrise / săn mây, biển mây | 04:30–07:00 |
| photo_spot | check-in, sống ảo, chụp ảnh (cafés, sights) | 08:00–10:00, else 15:30–17:30 |
| garden, nature, family | vườn, farm, dâu tây / thác, hồ, rừng, núi, đèo / công viên, khu du lịch | 08:00–11:00 |
| work_friendly | workspace, laptop, ổ cắm, wifi (cafés) | 09:00–11:30 |
| history | dinh, chùa, nhà thờ, bảo tàng, di tích (sights) | 08:30–11:00 |
| shopping, service | chợ, chợ đêm, đặc sản (other, sights) / spa, homestay, thuê xe (other) | 18:00–21:00 / 14:00–17:00 |

Strength decides which tag sets the best time: a `meal:` hint, then hours, meal phrases and a
post's best time, then keywords; meal tags that never meet the opening hours are dropped (a phở
place opening at 17:00 is not breakfast). What posts say about the time always wins; the tag
window is the fallback (`source: heuristic`, evidence `tag rule: <tag> (<why>)`), clamped into the
opening hours, and places with no tag fall back to a category window, so every place has one.
- Day grouping (`trip.day_grouping` in config.yaml): both modes balance real places, not zones: each
  day aims at ceil(places / days) places. `sector` (default) starts from the busiest compass direction
  and tops the day up with zones of the same and then the neighbouring directions while they fit;
  `nearest` takes the biggest zone and adds the nearest zones that fit. Zones from opposite sides of
  the center (directions more than 90° apart) never share a day when another day can take them;
  leftover zones go to a neighbouring day with room, else to the day with the fewest places, and a
  final pass moves or swaps zones to even the days out. A zone bigger than a day gets its own day.
  `max_zones_per_day` is a soft cap while building days. When places still do not fit, the route
  solver drops the least confident ones and the route step warns how many days the places need
  (`needed_days` in `data/routes.json`).

  | config.yaml key | Default | Meaning |
  |-----------------|---------|---------|
  | `trip.max_places_per_day` | empty | Hard cap on real places per day; empty balances at ceil(places / days). Zones that fit no day are left out (logged). |
  | `trip.max_nearby_per_day` | 3 | Nearby spots added to a day as optional fillers, nearest to the route first, only when every place of the day fits. |
  | `nearby.service_minutes` | 45 | Minutes planned at a nearby spot (places use `trip.service_minutes`). |

- Nearby spots skip OSM objects named after the city or one of `city_profile.aliases` (a sign or
  sculpture called "Đà Lạt"), names shorter than 3 characters or that are a bare coordinate, and bars,
  pubs, nightclubs, shops and offices unless they carry a wikipedia/wikidata tag.
- Google My Maps: create a map, then Add layer, Import, and pick one `mymaps/mymaps_<SECTOR>.csv` per layer
  (use Latitude/Longitude as the position columns and Name as the title). Limits: 2,000 rows per file,
  10 layers per map.
- The map is a React app in `web/`. Build it once (needs Node), then export:
  `npm --prefix web ci && npm --prefix web run build && uv run tiktok-trip export`. The build writes
  `src/tiktok_trip/export/web_dist/`; without it export stops and prints that command.
  `map.html` opens in any browser, on a laptop or a phone (copy the file over): one file with the app and
  data inlined, so it works from `file://`; only the map tiles need a network. `output/app/` is the same
  app as an installable PWA with a service worker (see Offline and phone and Deploy).
  - Side panel (a bottom sheet on phones; tap the handle or a tab to open it): **Plan** lists the days
    as an accordion (Day 1 open at start, one day open at a time); opening a day draws only its route
    with numbered stops and dims the rest, closing it shows every day again. An open day shows its
    Google Maps directions links and its stops in order with activity, time and the planner's reason;
    a stop flies the map to its pin and opens its card; places left out of the plan are listed with
    their reasons. The pencil on a day header (**Edit plan**) opens the plan editor at that day
    (reorder, move, add or remove stops; it recomputes the times from the travel matrix and exports a
    `plan.json` for `route --collect`).
    **Places** pins the must-go places at the top, has a search box (name, address, dish or tag; `/`
    jumps there), filters by day (planned or not), direction (a 3×3 compass, the middle cell clears
    it), priority, category and tag ("Good for"); the filters also hide pins on the map while the tab
    is open.
  - Map: the center (house icon for a hotel) with its name, 8 (or 4) direction rays and distance
    rings, pins colored by direction, sized by priority (★★★★ must-go largest, with an accent ring)
    with a category glyph and a day badge, nearby spots as small grey dots, one route line per day in
    the day colors, drawn along the roads (OSRM, see `roads`; a leg without road geometry, or a new
    leg made in the plan editor, is a straight line). Below zoom 14 pins close to each other group into clusters; a cluster's ring shows the mix of
    directions inside it and its core the dominant one (a dot marks a must-go inside).
  - Place card: priority stars and a Must go badge, category, direction and distance, plan day and
    stop, tags, preview images (evidence frames and Google photos with their authors; a click opens
    the post or the photo), address, hours, best time with its reason ("estimate" when heuristic),
    price, rating, must-try dishes, Open in Google Maps, the video links and **Hide**.
  - Hide removes a place from the map and the lists in this browser only (the plan marks it hidden);
    "n hidden · show" brings them back. **Export preferences.yaml** (panel footer) downloads your
    `must_go` plus `removed:` = the file's removed entries and every hidden place id; save it as
    `input/preferences.yaml` and run `uv run tiktok-trip run --from resolve` to make it permanent.
  - Layers button: basemap, toggles for rays and rings, nearby spots and routes, and the legend.
    Basemaps come from `export.basemaps` (default `[google, openfreemap, esri_streets,
    esri_satellite]`; add `osm` to offer OpenStreetMap). Google counts only with
    `export.google_map: true` and a key with the Maps JavaScript API enabled; it is then the default
    view (loaded after the first paint) and the Leaflet pins, routes and rings stay on top of it.
    Without it OpenFreeMap (vector tiles drawn with MapLibre GL, no key) is the default, then Esri
    Streets. A basemap whose tiles or style fail to load, OpenFreeMap without WebGL, or Google failing
    to load, switches to the next one with a note. EN/VI switches the interface language (default from the browser); place data stays as
    extracted. Choices are remembered in the browser. Light and dark follow the system setting
    (tiles are dimmed a little in dark mode).

### Offline and phone

- **map.html from `file://`** (copied to a phone, AirDropped, opened from Files): the whole app, the
  plan, the cards and the lists work offline. Map tiles and preview images do not: tiles need the
  network, and the images are files next to it in `output/media/` (copy the `output/` folder, not only
  `map.html`, to keep them). There is no service worker on `file://`.
- **`output/app/`** is the installable app. On first visit the service worker caches the app, `trip.json`
  and every image listed in `offline.json` (about 20 MB, in the background), and keeps map tiles
  stale-while-revalidate in a capped cache (OpenFreeMap, Esri and OSM tile hosts only). After that the
  plan, cards, images and the areas you viewed work without a network. A new export changes
  `offline.json`'s version; the app then refreshes its cache and offers "Reload" for new code. Google
  Maps JavaScript API responses are never cached (their terms); the Google basemap needs the network.
- **Install on a phone**: open the deployed https URL once while online. Android Chrome: install banner or
  menu, Install app. iPhone Safari: Share, Add to Home Screen.
- **Local check**: `uv run tiktok-trip serve [--port 8765]` serves `output/app/` on
  `http://localhost:8765/`. Over plain LAN http a phone gets no service worker or install (browsers
  require https or localhost); use a deployed URL or a tunnel you trust (for example `tailscale serve 8765`).

### Deploy the app

`output/app/` is a static folder (any host, any sub-path, https required for install and offline).
After each export, publish it again:

```bash
npx netlify deploy --dir output/app --prod          # Netlify
npx vercel deploy output/app --prod                 # Vercel
npx wrangler pages deploy output/app                # Cloudflare Pages
npx gh-pages -d output/app                          # GitHub Pages (pushes to the gh-pages branch)
```

One command does it all for Vercel (build if `web/` changed, export, safety checks, deploy):
`scripts/deploy-vercel.sh` (`--preview` for a preview URL, `--dry-run` to check without uploading,
`--skip-export` to publish `output/app` as it is).

Vercel by hand: `npx vercel login` once, then `npx vercel deploy output/app --prod`. The first
run asks to set up a project (accept the defaults: no build command, output directory `./`); later
runs reuse it, because the export keeps `output/app/.vercel` (and `.netlify`) across rebuilds.
`web/public/vercel.json` ships the cache headers (hashed `assets/` immutable, `sw.js`, `trip.json`
and friends `no-cache`), so an update is picked up on the next visit.

The server key `GOOGLE_MAPS_KEY` is never written to `output/`; the export fails if it finds it there. With `export.google_map: true` your browser key `GOOGLE_MAPS_BROWSER_KEY` is inside `trip.json` and `map.html`:
restrict it to your site's HTTP referrer (`https://<your-site>/*`) and the Maps JavaScript API before deploying, or leave the option off.

## Your own list and preferences

- `input/places.yaml`: places you already know, next to the TikTok links. Sections map to a
  category and a meal hint (Ăn sáng / Ăn trưa / Ăn tối / Ăn vặt → food with `meal: breakfast`,
  `lunch`, `dinner`, `snack` in the notes; Cà phê → cafe; Đi chơi / Tham quan → attraction;
  English names work too). Each entry is `"name | address | remark"`; address and remark are
  optional. `uv run tiktok-trip extract` turns every entry into a candidate (source `manual`, the
  line as evidence, recommended `strong`, so priority high) and merges it into
  `data/candidates.json`; editing the file and re-running `extract` replaces the whole manual set.
  Then `uv run tiktok-trip run --from resolve`.

  ```yaml
  - section: "Ăn sáng"
    places:
      - "Bún bò bốc khói | 29 Trần Phú"
      - "Quán nướng Mậu Dịch | 28B Trần Hưng Đạo, p10 | đặt bàn trước"
  ```

- `input/preferences.yaml`: `must_go` and `removed`, each a list of place names or ids (`gp:…`,
  see `output/places.json`). A name matches a place's Google name or a name a video used for it
  (name score >= 85 or contained as whole words, diacritics ignored; "A (B)" also tries A and B).
  Applied by `resolve` on every run (`run --from resolve`): `must_go` → priority `must` and the
  planner must place it; `removed` → status `skip`, kept in `places.json` for the audit trail but
  left out of zones, nearby spots, the plan and every export. Removing an entry undoes it. Names
  that match no place (misspelt, or still waiting in review) are logged as warnings.

## Plan to go (agent mode)

With `plan.mode: agent` the route step does not optimise on its own. It writes
`data/plan/prompt.md` (trip, day rhythm, every place with hours, best time and its reason,
deadline, price, tags, the nearby spots and the rules) and `data/plan/travel_minutes.csv` (one travel-minute
matrix over the center, the places and the nearby spots, from the
straight-line estimate). Claude Code answers with `data/plan/plan.json`: for each day the
stops in order as `{ref, slot, reason}` (`ref` is a place id, a nearby spot id or `rest`) and the
places it leaves out under `unplaced` with a reason. It never writes times.

The next `uv run tiktok-trip route` computes the clock in code: each day leaves the center as late
as the first stop allows (never before `plan.day_start`); every stop starts at
max(previous leave + travel, slot start, opening time), stays `trip.service_minutes` (nearby spots
`nearby.service_minutes`; a rest lasts until its slot ends) and the day returns to the center. It
then checks the rules and writes `data/plan/validation.md`:

- Hard violations (closed or no time before closing, deadline missed, past `plan.day_end`, a place
  used twice or missing, unknown id or slot, more days than `trip.days`, over the per-day caps):
  `routes.json` is left as it was and the step exits with code 2, like the review gate.
- Warnings (slot order broken, a leg over 40 minutes, a long wait, a category in the wrong slot,
  opposite directions in one day, back after the day ends) are listed but do not block.

When places change the prompt is rewritten, the old plan.json counts as stale and the step waits
for a new one. In Claude Code, `/plan` runs this loop. `uv run tiktok-trip route --collect`
validates plan.json even when it is older than the prompt. The Plan-to-go sheet shows the slot as
"Activity", rest rows as "Rest at hotel" (or "Rest at center"), the stop's reason in the Note and
"planned by Claude Code" in its title; places left out are listed at the bottom.

## Free tier and quotas (checked Oct 2026)

| Service | Used for | Free limit |
|---------|----------|------------|
| Google Text Search Pro (`text_search_pro`) | resolve | 5,000 / month |
| Google Place Details Pro (`place_details_pro`) | review decisions given as a `gp:` place id | 5,000 / month |
| Google Place Details Enterprise (`place_details_enterprise`) | enrich (once per verified place) | 1,000 / month |
| Google Nearby Search Enterprise (`nearby_search_enterprise`) | nearby, only with `nearby.provider: google` | 1,000 / month |
| Nominatim | backup geocoder, center | 1 request/second, no bulk |
| Photon (komoot) | geocoder when Nominatim is unreachable or empty; Google Text Search is the last resort | fair use |
| Overpass | nearby famous spots | fair use |
| OSRM (FOSSGIS, routing.openstreetmap.de; `osrm_route`) | export: road geometry of each planned leg for the map | fair use, 1 request/second, every answer cached |
| OpenFreeMap (tiles.openfreemap.org) | default map basemap (vector tiles, loaded by the browser) | free, no key |

50 videos and about 80 places fit comfortably inside the free caps. The local quota guard stops at
90% of each cap; set Cloud Console quotas as well (see [Google Cloud setup](#google-cloud-setup)).
Every external call (cache hits too) is recorded in `data/api_log.csv`; `uv run tiktok-trip quota`
shows where each SKU stands.

## Caching and re-runs

- Every step is idempotent. Downloaded videos stay in `data/raw/<video_id>/` and are never fetched again.
- HTTP responses are cached in `data/cache/`, so re-running a step costs no API quota.
- Changing the hotel, sectors or trip length only re-runs from `spatial` onward.
- Review decisions are stored in `data/review.json` and survive re-runs of resolve.
- `data/` and `output/` are gitignored; delete a file under `data/` to force that step to redo its work.

## Project layout

See `docs/ARCHITECTURE.md` for the module layout and conventions and `docs/PLAN.md` for the product plan.
Claude Code rules for this repo are in `CLAUDE.md`; slash commands are in `.claude/commands/`.

```bash
uv run pytest -q
uv run ruff format src tests && uv run ruff check src tests
uv run mypy src/tiktok_trip
```

Personal use only. Respect TikTok's terms of service and keep batches small.
