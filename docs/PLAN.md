# TikTok Review → Trip Planner: Project Plan

Goal: give the pipeline a list of TikTok review links and a target city. It returns verified places, groups them by direction from a center point, adds nearby famous spots, builds time-saving routes, and exports a map and an Excel sheet.

Runs on: Claude Code (CLI) on your machine. Python scripts do the heavy work. Claude Code orchestrates the steps, reads frames, and handles the review steps.

---

## 1. What you get at the end

```
output/
  trip.xlsx        Dashboard (compass) + per-direction sheets + itinerary
  map.html         Interactive map: center, 8 direction rays, distance rings,
                   colored pins, route lines (opens offline in a browser)
  mymaps.csv       Import into Google My Maps to use on your phone
  places.json      Master data (source of truth)
  review.csv       Low-confidence matches to check by hand
```

---

## 2. Pipeline overview

```
links.txt + config.yaml (city, center, mode)
        │
        ▼
[1] FETCH ──────── yt-dlp → video.mp4, info.json (caption, tags, POI), comments
        │
        ▼
[2] EXTRACT MEDIA ─ ffmpeg → key frames
        │            faster-whisper → transcript (vi)
        ▼
[3] EXTRACT PLACES ─ LLM reads caption + comments + transcript + frames
        │             → candidates {name, address_text, evidence, confidence}
        ▼
[4] RESOLVE ─────── Google Places Text Search (bias to city) → place_id, lat/lng
        │            filter: inside target city? open? duplicate?
        │            low confidence → review.csv  ◄── HUMAN CHECK
        ▼
[5] ENRICH ──────── Place Details: hours, price range, rating, #ratings
        │            LLM: best hour/day/month from comments + category rules
        ▼
[6] SPATIAL ─────── center → bearing + distance → sector (N/NE/E…) + ring
        │            cluster nearby places inside each sector → "zones"
        ▼
[7] NEARBY ──────── famous spots near each zone (Overpass or Places Nearby)
        ▼
[8] ROUTE ───────── travel-time matrix (straight-line estimate) → OR-Tools with time windows
        │            → ordered stops per zone / per day
        ▼
[9] EXPORT ──────── map.html (Folium) + mymaps.csv/KML + trip.xlsx (openpyxl)
```

Every step reads the previous step's output from `data/` and caches its own. You can re-run any step without paying for API calls twice.

---

## 3. Map services: what is free (checked Oct 2026)

```
SERVICE                 USE FOR                 FREE LIMIT                     NOTES
----------------------  ----------------------  -----------------------------  -------------------------------
Google Places (New)     find place, verify,     Per-SKU monthly caps:          Needs billing account enabled.
  Text Search Pro       get place_id + lat/lng  5,000 / month                  Set a quota cap in Cloud
  Details Enterprise    hours, price, rating    1,000 / month                  Console to avoid surprise bills.
  Nearby Search         famous spots nearby     depends on fields (tier)
Nominatim (OSM)         backup geocoder         max 1 request/sec, no bulk     Needs User-Agent. Small runs OK.
Overpass (OSM)          attractions, temples,   free, fair use                 Good for "famous place" layer.
                        museums, viewpoints
Folium / Leaflet + OSM  map.html display        free                           Credit OSM on the map.
Google My Maps          phone-friendly map      2,000 rows per import file,    Manual import of CSV/KML.
                                                10 layers per map              One layer per direction works.
```

Why Google for the resolve step: Vietnamese shop names, branches, and street-food spots are much better covered in Google than in OSM. Use OSM tools for the free parts (routing, attractions, display).

Field masks decide the price. Rating, regular opening hours, and price range are Enterprise fields. Reviews are Enterprise + Atmosphere. So request only `id, displayName, location, formattedAddress` during resolve, and fetch the Enterprise fields once per *verified* place.

Not available from any official API: Google "Popular times" (busy hours). Best time to visit has to come from comments, captions, and category rules (see Phase 5).

---

## 4. Project structure

```
tiktok-trip/
├── CLAUDE.md                  rules for Claude Code (see Phase 8)
├── config.yaml                city, center, directions, travel mode, trip days
├── .env                       GOOGLE_MAPS_KEY
├── input/links.txt            one TikTok URL per line
├── src/
│   ├── s1_fetch.py
│   ├── s2_media.py
│   ├── s3_extract.py
│   ├── s4_resolve.py
│   ├── s5_enrich.py
│   ├── s6_spatial.py
│   ├── s7_nearby.py
│   ├── s8_route.py
│   ├── s9_export_map.py
│   ├── s10_export_excel.py
│   └── lib/ (geo.py, cache.py, schemas.py)
├── data/
│   ├── raw/<video_id>/        video.mp4, info.json, comments.json, frames/, transcript.txt
│   ├── candidates.json
│   ├── places.json
│   └── review.csv
├── output/
└── .claude/commands/
    ├── run.md                 /run   → full pipeline
    ├── review.md              /review → walk through review.csv with you
    └── add.md                 /add <url> → process one new link
```

---

## 5. Data model (one place)

Every field records where it came from, so you know what to trust.

```json
{
  "id": "gp:ChIJ...",
  "name": "Bánh Xèo ABC",
  "category": "food | cafe | attraction | other",
  "address": "123 Đường X, Phường Y, TP.HCM",
  "address_as_mentioned": "123 X, Quận 1",
  "lat": 10.77, "lng": 106.70,
  "business_status": "OPERATIONAL",
  "hours": { "value": "...", "source": "google" },
  "price_range": { "value": "50k–100k VND", "source": "google|comments" },
  "rating": 4.5, "rating_count": 1200,
  "best_time": {
    "hours": "17:00–20:00", "days": "weekday",
    "months": "Dec–Apr",
    "source": "comments|caption|heuristic", "evidence": "…short quote…"
  },
  "must_try": ["bánh xèo tôm"],
  "videos": ["https://tiktok.com/...", "..."],
  "mention_count": 2,
  "spatial": { "bearing_deg": 32, "sector": "NE", "distance_km": 4.1,
               "ring": "2–5km", "zone": "NE-1" },
  "confidence": 0.92,
  "status": "todo | visited | skip",
  "priority": "high | medium | low | null",
  "priority_reason": "recommended in 2 posts"
}
```

`mention_count` (how many videos mention the place) is a free popularity signal. `priority` comes
from it and from each candidate's `recommendation` (strong / normal / none, with a quote): high
for 2+ videos or a strong recommendation, medium for one praised or dedicated post, low for a
plain entry in a list post, null when the candidates predate the field.

---

## 6. Phases

### Phase 0: Spike to verify assumptions (half a day)

Do this before writing the real code. Test with 3–5 of your real links.

- [ ] `yt-dlp -U`, then download one video with `--write-info-json --write-comments`. Check that the caption, location/POI, and comments are in the JSON. If comments come back empty, fall back to Playwright: scroll the comment panel and save the text.
- [ ] faster-whisper `large-v3`, `language="vi"`, on one video. Check that street names come out right.
- [ ] Google Places Text Search on one name with `locationBias` set to the city. Confirm the free cap shows in Cloud Console.
- [ ] Decide the travel mode (walking, motorbike or car); travel times are a straight-line estimate at that mode's speed.

Exit check: the address appears in at least one source (caption, comments, audio, or frames) for most of your test videos.

### Phase 1: Fetch + media (1 day)

- `s1_fetch.py`: yt-dlp per URL, saved to `data/raw/<id>/`. Skip if already there. Retry once, then log the failure.
- `s2_media.py`:
  - Frames: scene changes plus a safety frame every ~3s (text overlays are often static):
    `ffmpeg -i video.mp4 -vf "select='gt(scene,0.3)+not(mod(n,90))'" -vsync vfr frames/%03d.jpg`
  - Drop near-duplicate frames (perceptual hash) to keep about 5–15 per video.
  - Audio → transcript with timestamps.

### Phase 2: Extract place candidates (1 day)

- `s3_extract.py` bundles caption + top comments (creator replies first) + transcript + frames into one prompt file per video.
- Claude Code (on the user's subscription, no API key) reads each prompt and its frame images and writes `candidates.json`; re-running the step collects them.
- Prompt rules:
  - Return JSON only.
  - Every address needs an `evidence` field: the source plus a short quote or timestamp. No evidence means the address is dropped. This stops made-up addresses.
  - Keep `address_as_mentioned` exactly as heard or seen.
  - One video can contain several places (common in "top 5" videos).

### Phase 3: Resolve + verify (1 day). The most important step.

- Query = name + address text + city, using Text Search with `locationBias` on the city.
- Accept a match only if:
  1. it is inside the target city boundary (point-in-polygon, or a distance cap from the center),
  2. the name is similar enough (fuzzy score),
  3. `businessStatus` is not `CLOSED_PERMANENTLY`.
- **Chain/branch problem:** famous shops often have many branches. Use the evidence (street, ward, nearby landmark) to pick the right one. If two or more branches are plausible, send it to `review.csv`.
- **Vietnam address change:** since 1 July 2025 the district level is gone, and HCMC now includes the former Bình Dương and Bà Rịa–Vũng Tàu. Older videos say "Quận 1"; new addresses use wards. Match on street + coordinates, not on district names. Keep both `address` (new) and `address_as_mentioned` (old).
- Dedupe by `place_id`. Merge `videos[]`.
- Backup when Google finds nothing: Nominatim/Photon at 1 req/sec; the OSM point goes to review (`low_confidence`), never auto-accepted.

### Phase 4: Spatial analysis (1 day)

**Center point.** Rule: use the hotel if you give one, otherwise use the city center.

```yaml
# config.yaml
city: "Ho Chi Minh City"
center:
  hotel: ""            # e.g. "123 Lê Lợi, ..."  → used if filled
  override: ""         # optional: a landmark name or "lat,lng" to force a point
```

How `s6_spatial.py` picks the center:

```
hotel filled? ──yes──► geocode hotel ──► CENTER (source: hotel)
     │no
override filled? ─yes─► geocode / parse ──► CENTER (source: override)
     │no
city center (default):
  1. city_profile.center_landmark, e.g. "Chợ Đà Lạt" (the central market marks downtown in
     Vietnamese cities): Google Text Search first (place id → Maps link to the listing),
     else Photon/Nominatim; rejected if > 5 km from the city point
  2. fallback: OSM city point  (the city's place node / admin centre), label "Trung tâm <city>"
  3. fallback: geocoder's city result point
     ──► CENTER (source: city_default, label, label_en, place_id, maps_url)

sanity check: distance(CENTER, median of your places) > 10 km?
  → print a warning + suggest setting hotel or override
```

Why not the geometric middle of the city: after the July 2025 merger, HCMC covers the old city plus Bình Dương and Bà Rịa–Vũng Tàu, so its geometric middle is far from downtown. The OSM city point avoids this, and the sanity check catches any city where it doesn't.

- Changing the hotel later only re-runs Phase 4 onward. Nothing is downloaded or geocoded again (except the hotel).
- The center's source (`hotel`, `override`, `city_default`) is shown on the Excel Dashboard and the map, so you always know which point the directions are measured from.
- Phase 0 check: print the default center coordinates for your city and open them in a map to confirm they land downtown.

**Direction + distance.**
- Distance: haversine.
- Bearing: `θ = atan2(sin Δλ·cos φ2, cos φ1·sin φ2 − sin φ1·cos φ2·cos Δλ)`, converted to 0–360°.
- Sectors: 4 (90° each) or 8 (45° each). N = 337.5°–22.5°, NE = 22.5°–67.5°, and so on. Set in config.
- Rings: 0–2 km, 2–5 km, 5–10 km, 10 km+.

**Why direction alone is not enough.** Two places can both be "North" yet 6 km apart (one at 1 km, one at 7 km). So inside each sector, cluster with DBSCAN (haversine metric, eps ≈ 1.5 km walking / 3 km motorbike). Each cluster becomes a **zone**, roughly a half-day trip.

```
              N
        NW    |    NE
          \ N-1 /          ring 2–5km
   W ──────  ●  ────── E   ● = center
          / S-1 \
        SW    |    SE
              S
   zone = sector + nearby cluster (e.g. NE-1, NE-2)
```

### Phase 5: Enrich + best time (1 day)

- Place Details (Enterprise fields) only for verified places: hours, price range, rating, rating count.
- Best time comes from three sources, each labelled:
  1. **comments/caption** ("đi tối mới đông", "cuối tuần phải xếp hàng") → LLM extracts it with an evidence quote
  2. **opening hours**: the window must fall inside them
  3. **category rules** (marked `heuristic`): breakfast phở → morning; street food → evening; viewpoint → sunset; outdoor → avoid midday heat; months → the local dry season
- If the comments say the place sells out early, set an early deadline in the route constraints.

### Phase 6: Nearby famous places (half a day)

- For each zone centroid, search within ~1–1.5 km:
  - **Overpass (free):** `tourism=attraction|museum|viewpoint`, `historic=*`, notable `amenity=place_of_worship`
  - or **Google Nearby Search** with `includedTypes: tourist_attraction`, ranked by `userRatingCount` (better ranking, uses Enterprise quota)
- Keep the top N per zone. They become optional stops in routing.

### Phase 7: Route optimization (1–2 days)

- Matrix: straight-line estimate (haversine x detour factor at the mode's speed), no API call.
- Solver: OR-Tools routing with time windows (runs locally, free).
  - Nodes: start (center/hotel) + zone stops
  - Time windows: opening hours ∩ best-time window
  - Service time: food 45 min, cafe 45 min, attraction 60–90 min (configurable)
  - Optional nodes (nearby famous spots) get a drop penalty, so they are skipped if they don't fit
- Day planner: give each day 1–2 zones (e.g. one zone in the morning, a nearby zone in the evening). Lunch and dinner stops should fall near meal times.
- Output per day: ordered stops, arrive/leave times, travel minutes, and a Google Maps directions link. Maps URLs limit the number of waypoints, so split long days into legs.

### Phase 8: Exports (1–2 days)

**map.html (Folium):** center marker, sector rays, distance rings, pins colored by sector, icons by category, a popup with hours / best time / price / video links, and route polylines per day. Layer toggle per day/zone.

**mymaps.csv / KML:** one file per sector so each becomes a My Maps layer (≤ 10 layers, ≤ 2,000 rows each).

**trip.xlsx (openpyxl).** Sheets:

```
1. Dashboard   compass grid (below) + center info + totals
2. All Places  master table, filters on, header frozen
3. N, NE, E, SE, S, SW, W, NW   one sheet per sector, sorted by zone → route order
4. Itinerary   Day | Zone | # | Place | Arrive | Leave | Travel→next | Maps link
5. Nearby      famous spots per zone
6. Sources     video URL | evidence | timestamp | confidence  (audit trail)
7. Config      center, mode, date generated
```

Dashboard compass (merged cells, sector colors match the map):

```
┌──────────────┬──────────────┬──────────────┐
│ NW  (3)      │ N   (7)      │ NE  (5)      │
│ top 3 names  │ top 3 names  │ top 3 names  │
├──────────────┼──────────────┼──────────────┤
│ W   (2)      │  CENTER      │ E   (4)      │
│ top 3 names  │  hotel/addr  │ top 3 names  │
├──────────────┼──────────────┼──────────────┤
│ SW  (1)      │ S   (6)      │ SE  (2)      │
│ top 3 names  │ top 3 names  │ top 3 names  │
└──────────────┴──────────────┴──────────────┘
```

Columns in the place sheets:

```
Zone | Name | Category | Address | Distance km | Bearing° | Ring |
Open hours | Best hour | Best day | Best month | Price | Rating | #Ratings |
Mentions | Must try | Notes (from comments) | Maps link | Video link |
Confidence | Status (dropdown: todo/visited/skip)
```

Formatting: one fill color per sector, hyperlinks via `HYPERLINK()`, confidence < 0.7 highlighted, Status as a data-validation dropdown.

Maps link format: `https://www.google.com/maps/search/?api=1&query=<name>&query_place_id=<place_id>`

### Phase 9: Claude Code integration (half a day)

`CLAUDE.md` should tell Claude Code:
- Run steps in order. Never re-download if `data/raw/<id>` exists.
- Never invent an address. Every address needs evidence.
- Stop after Phase 3 if `review.csv` has rows, and walk through them with the user.
- Respect rate limits (Nominatim 1/s) and log every paid API call to `data/api_log.csv`.

Slash commands: `/run` (full pipeline), `/review` (resolve flagged rows), `/add <url>` (process one link and update the outputs).

---

## 7. Quota budget (example: 50 videos, ~80 places)

```
Text Search Pro        ~100–150 calls    free cap 5,000/mo    ✓
Place Details Ent.     ~80 calls         free cap 1,000/mo    ✓
Nearby Search Ent.     ~15 zones         free cap 1,000/mo    ✓
Claude Code (vision)   ~10 frames/video  runs in Claude Code, no API cost
```

Comfortably free for personal use. Set Google quota caps anyway.

---

## 8. Risks and how we handle them

```
RISK                                   MITIGATION
-------------------------------------  ---------------------------------------------
yt-dlp TikTok extractor breaks         yt-dlp -U first; Playwright fallback; manual
                                       screenshots as last resort
TikTok terms of service                personal use only, small batches, no product
LLM invents an address                 evidence required; drop if missing
Wrong branch of a chain                evidence + review.csv
Old district names (pre-July-2025)     match on street + coordinates, keep both
Place closed                           businessStatus filter
"Best time" is a guess                 every value labelled with source; heuristic
                                       shown differently in Excel
Whisper mishears street names          cross-check with frames/caption; geocode
                                       confirms
Motorbike travel times                 car profile as proxy; add a buffer (+20%)
```

---

## 9. Test plan

- **Golden set:** 10 videos where you already know the correct address by hand. Target: ≥ 8/10 resolved correctly, 0 wrong addresses accepted with high confidence.
- **Spatial check:** place a test point exactly north, east, etc. of the center and assert the sector. Check the 337.5°/22.5° boundary.
- **Route check:** no stop scheduled outside its opening hours; day total ≤ the configured hours.
- **Excel check:** open in Excel and Google Sheets; links work; colors match the map.

---

## 10. Milestones

```
M0  Spike done, assumptions confirmed               ~0.5 day
M1  links → verified address list (places.json)     ~3 days    ← useful on its own
M2  + map.html with sectors/rings + My Maps CSV     ~1.5 days
M3  + enrich + best time + nearby spots             ~1.5 days
M4  + routes + trip.xlsx                            ~3 days
```

Build M1 first and use it. Each milestone is usable without the next one.

---

## 11. Decisions needed before starting

1. Target city, and do you have a hotel address yet? (If not, the city center is used, and you can add the hotel later.)
2. 4 or 8 directions?
3. Travel mode: walking, motorbike, or car?
4. Trip length (days) and daily hours, e.g. 08:00–22:00?
5. OK to enable Google billing (with quota caps) for the free tier?
