# Web app (React PWA) contract

The trip map is a React + TypeScript app in `web/`; it replaced the earlier hand-written map app
(`export/map/`, now deleted) with feature parity. The Python export stays the only producer of trip data.

## Outputs

| Output | What | Built by |
|---|---|---|
| `output/app/` | Installable PWA, deploy this folder to any static HTTPS host (Netlify, Vercel, Cloudflare Pages, GitHub Pages; any sub-path) | `web` build `app` + Python export |
| `output/map.html` | One self-contained file (JS, CSS, data inlined), opens from file://, no service worker | `web` build `single` + Python export |

## Build

- `web/`: Vite + React 19 + TypeScript strict, ESLint (flat config, react-hooks), Vitest. npm, exact
  pinned versions (each at least two weeks old). Node 26 is installed.
- `npm --prefix web run build` runs both builds and writes into the Python package:
  - `src/tiktok_trip/export/web_dist/app/` (`base: "./"`): `index.html`, hashed `assets/`, `sw.js`,
    `manifest.webmanifest`, icons, `licenses.md` (licences of the bundled npm packages).
  - `src/tiktok_trip/export/web_dist/single/index.html`: everything inlined (vite-plugin-singlefile,
    dynamic imports inlined), no service worker registration.
  - `web_dist/` is a build artifact (pyproject `artifacts`), never hand-edited.
- `npm --prefix web run dev` serves the app with `output/app/` as the public dir, so `trip.json` and
  `media/` from the last export load in dev. What `output/app/` lacks is served from
  `web/.dev-data/` (`npm --prefix web run dev:data` writes `trip.json` from `data/`, roads from the
  OSRM cache only, no network), `web/public/` (icons) and `output/media/`.
- `npm --prefix web run check` = typecheck + lint + test.

## Data contract (Python → web)

- The data is `MapData` (`src/tiktok_trip/export/map_data.py`), serialised with
  `model_dump_json(by_alias=True)`.
- `uv run python -m tiktok_trip.export.schema web/src/data/trip.schema.json` writes its JSON schema;
  `npm --prefix web run gen:types` turns it into `web/src/data/trip.gen.ts` (json-schema-to-typescript,
  generated, committed). A Python test fails when the schema file is stale.
- Loading (`web/src/data/load.ts`): if `<script id="trip-data" type="application/json">` holds JSON
  (single file), use it; otherwise `fetch("trip.json")`.
- `schema_version` (`map_data.MAP_SCHEMA_VERSION`, mirrored by `TRIP_SCHEMA_VERSION` in `load.ts`, both
  start at 1). The app refuses any other version: newer data shows "A new version is ready" with a
  Reload button that activates a waiting service worker first; older data asks for a reload or a new
  export. Bump both constants together when a change would break an app that is already installed:
  a removed or renamed field, a changed type or meaning. Adding a field the app may ignore needs no bump.
- Map pins and clusters are coloured by place category (`category_colors`, `category_ink`, from
  `palette.CATEGORY_COLORS`); compass rays and labels keep the sector colours.
  Exports older than those fields use the copy in `web/src/data/palette.ts` (a test keeps it equal
  to the schema defaults).
- A render error inside the app shows the load-error screen (Reload) instead of a blank page.
- Both builds' `index.html` (`<html lang="vi">`) contain exactly one
  `<script id="trip-data" type="application/json">__TRIP_DATA__</script>`, one
  `<title>__TRIP_TITLE__</title>` and one `<!--__SEO_HEAD__-->` (right after the title).
  - Python fills the title with `SITE_NAME` ("TwLP-Trips", `export/site.py`) and the SEO block
    (`site.head_tags`) in both builds: description (Vietnamese), `apple-mobile-web-app-title`,
    Open Graph (`og:type`, `og:site_name`, `og:title` = the title, `og:description`, `og:locale` vi_VN +
    alternate en_US), `twitter:card`. The app build adds `og:image` (+ type, width, height, alt) and,
    with `export.site_url`, the canonical link, `og:url` and a JSON-LD `WebSite`; map.html gets no
    image or URL tags. Crawlers run no JavaScript, so these tags must be static.
  - single: Python also replaces `__TRIP_DATA__` (`</` escaped as `<\/`, `<!--` as `<\!--`).
  - app: `__TRIP_DATA__` stays, meaning "fetch trip.json". The app sets `document.title` from
    `data.site_name` (the same `SITE_NAME`; keeps `npm run dev` titled) and `<html lang>` from the language.
  - Service worker: index.html is precached by the revision computed at web build, and navigations
    are served from that precache. Workbox downloads the file from the host at install, so the shell
    holds the head of the export that was live then; a re-export without a web rebuild keeps the same
    revision, so installed apps keep the older meta tags (the title never changes, only description
    counts and the image version do). Crawlers do not run the service worker and always get the
    deployed file (`no-cache` on Vercel).
- `manifest.webmanifest` in the app build holds `"__TRIP_NAME__"`, `"__TRIP_SHORT_NAME__"` and
  `"__TRIP_DESCRIPTION__"`; Python fills them (`TwLP-Trips – <city>`, `TwLP-Trips`, the meta
  description; `lang` is `vi`). The manifest is not precached; the SW warms it with `trip.json` and
  serves it network-first.
- Language: a first visit opens in Vietnamese (`DEFAULT_LANG` in `i18n/shellText.ts`) whatever the
  browser language; a language saved in the persisted prefs wins (also for the boot and load-error
  screens). The Excel workbooks are unaffected.

## Python export writes

`output/app/` = copy of `web_dist/app/` with `index.html` filled (title + SEO block) + `trip.json` +
filled `manifest.webmanifest` + `og-image.png` (1200×630 preview card, `export/og_image.py`, Pillow,
system font with Vietnamese diacritics or Pillow's default) + `robots.txt` + `media/` (copy of
`output/media/`) + `offline.json`:

```json
{"version": "<sha256[:16] of trip.json + media list>", "urls": ["trip.json", "media/<place>/frame-….jpg", "…"]}
```

`output/map.html` = `web_dist/single/index.html` with data and title filled; its media URLs
(`media/…`) resolve against `output/media/`. Missing `web_dist` → a `UserFacingError` naming
`npm --prefix web ci && npm --prefix web run build`. With `export.google_map` the Google key is in
`trip.json` and `map.html`: warn, as today, and never deploy those publicly.
`tiktok-trip serve` serves `output/app/` only (media now lives inside it).

## Offline (service worker, `web/src/sw.ts`, vite-plugin-pwa `injectManifest` + Workbox)

- Precache: the app shell from the Workbox manifest (index.html, assets, icons).
- On install and whenever the app sees a new `offline.json` version (app → SW `postMessage`, at every
  app start and when it comes back online): cache `trip.json` and every URL in `offline.json` (media,
  ~20 MB) in the background. The version is stored only when every download succeeded, so a partial
  warm-up retries later. On a new version the SW revalidates cached files (conditional GET with the
  cached ETag / Last-Modified: media keep their names across exports) and deletes media no longer
  listed and stray `trip.json` copies. A newly activated SW also re-checks for missing files.
- Runtime: `trip.json` and `manifest.webmanifest` network-first (3 s timeout, cache fallback); `media/` cache-first;
  basemap tiles, styles, glyphs, sprites stale-while-revalidate with an entry cap
  (hosts: `server.arcgisonline.com`, `tile.openstreetmap.org`, `tiles.openfreemap.org`; keep in sync with
  `map_data.TILE_HOSTS`); OSRM route answers (`routing.openstreetmap.de`, `map_data.ROUTING_HOSTS`)
  cache-first, 500 entries, 30 days; never cache Google Maps hosts. A Python test keeps both host
  lists in `pwa/constants.ts` equal to the Python ones.
- Updates: new SW waits; the app shows a toast "New version, Reload" (`registerType: "prompt"`).
- Tile preload (`map/useTilePreload.ts`) fills the tile cache for the trip area whenever the drawn
  basemap or the plan changes (online only, not on Save-Data / 2G, in the background, at most 400
  requests per run, each URL once): raster tiles and their labels overlay around the center and the
  planned stops; for the vector basemap the tiles of the style's TileJSON over the trip area, zoom 10–14.
- Install: manifest (`display: standalone`, theme colours light/dark, icons 192/512 + maskable,
  apple-touch-icon 180). "Install app" shows in the map tools whenever the page is not running
  installed: the browser's own prompt when `beforeinstallprompt` fired, else steps for this browser
  (`pwa/installOffer.ts` reads the user agent): in-app browsers (Zalo, Facebook, Messenger, Instagram,
  Line, TikTok…) → open in Safari/Chrome + copy link; iOS (Safari, any browser on 16.4+) → Share → Add
  to Home Screen; iOS < 16.4 outside Safari → Safari only; Android / desktop Chromium → browser menu;
  Safari 17+ on macOS → File → Add to Dock; desktop Firefox and older Safari → use Chrome or Edge.
  "Not now" shrinks the button to its icon for 14 days; the panel footer keeps the same steps.

## Location ("My location")

- Button: icon-only, 44 px, accessible name "Vị trí của tôi" / "My location", a Leaflet control at the
  bottom right: above the zoom buttons on desktop, above the attribution and the sheet peek on phones
  (thumb reach, like Google Maps). It sits under an open phone sheet and is hidden while the phone card is
  open; on phones the toast leaves room for it. Where location cannot work (http page, no API) it still
  shows, struck through, and a tap explains why (open the https link / use Safari or Chrome).
- States (`location/locateMachine.ts`): off (crosshair) → tap → locating (spinner) → first fix →
  following (filled, blue tint: the map centres the dot, zoom 15 or closer, in the area clear of the card or
  the open sheet, and pans to later fixes at most once a second when the dot drifts more than 16 px). Any
  camera move the follow camera did not start (drag, pinch, wheel, keys, a fly to a place) → showing (filled,
  the dot stays, the map stays). Tap on showing → following again; tap on following → off (position
  forgotten). No compass mode.
- Permission: nothing calls geolocation on load except when the Permissions API already says `granted`:
  then the dot shows silently (showing, the map does not move). `denied` (on load, a refused prompt, or a
  revoke) → struck-through button; a tap opens a popover with the steps to allow location for this site
  (iOS Settings → Safari → Location, or the site settings beside the address; map.html from file:// says to
  open the https link; in Zalo / Facebook / other in-app browsers: open the page in a real browser) and a
  Try again; the browser is never prompted again by itself. A prompt refused right after a tap opens that
  popover at once. A permission reset to "ask" turns the button back to off. The Permissions API is only a
  hint: missing, throwing or rejecting, a tap still asks.
- The tap asks first and synchronously: the click sets the store, whose change starts watchPosition in the
  same task (user gesture kept); the iOS compass permission is requested after it, in the same tap, and
  location never waits for or depends on it. Until the first fix a low-accuracy getCurrentPosition
  (network/Wi-Fi, maximumAge 60 s) runs beside the precise watch (30 s first-fix timeout; iOS indoors can
  take 10 to 20 s), so the dot shows early and sharpens; a coarse fix never replaces a precise one. Both
  giving up → "failed" (struck-through, tap retries) and a toast with Try again (in-app browsers: "open in
  Safari or Chrome"); after a fix, errors keep the dot.
- watchPosition runs only while locating / showing / following and the page is visible (stopped on
  `visibilitychange` hidden, resumed on return, cleared on unmount).
- Dot: blue with a white ring and a pulsing halo (static with reduced motion), an accuracy circle (hidden
  above 2 km or when it would cover the whole view), a heading cone from the GPS course while moving, else
  the compass (`deviceorientationabsolute`, or iOS `webkitCompassHeading` after
  `DeviceOrientationEvent.requestPermission()`, asked only from the locate tap). Its pane is click-through,
  so pins under it stay tappable.
- Privacy: the position lives in memory only (store `userFix`, never persisted, logged or sent; cleared when
  location turns off). Only the browser's permission state is read. Exports never mention it.
- The place card meta adds "1.2 km từ bạn" (straight line) while the dot shows.

## App structure (`web/src/`)

```
main.tsx, App.tsx            boot: load data, providers, lazy editor
app/                         shell (panel, tabs, global keys), DOM ids, hooks shared by features
data/                        trip.gen.ts (generated), load.ts, selectors and domain rules (priority,
                             plan, stops, unplaced reasons; pure, memo-friendly)
lib/                         pure helpers every feature imports (css, color, format, dom, download,
                             storage, safe URLs); one copy each, no feature imports another's helpers
state/store.ts               zustand store: lang, tab, focusDay, selected place, hovered row, filters,
                             overlays, basemap, hidden places, plan (days as edited), sheet state;
                             persisted slices via a versioned localStorage schema. The map focuses
                             focusDay only while the Plan tab shows (selectMapFocusDay); list rows
                             report hover through state/useRowHover (debounced, never on touch);
                             the pin highlights after 120 ms and map/useMapIntents centres it in the
                             map area clear of the card or open sheet after 250 ms, same zoom
i18n/                        labels come from data.labels[lang]; a `useT()` hook
map/                         imperative Leaflet wrapped in hooks: MapView, basemaps (raster, vector
                             via maplibre-gl-leaflet loaded with dynamic import, Google), markers +
                             markercluster, routes (road polylines; legs without a known road are
                             drawn straight and dashed until routing/ finds one), compass, focus;
                             map/emphasis.ts decides what stays lit: the open day's stops plus the
                             hovered marker, or with no day open the hovered marker alone (spotlight);
                             map/fingerReach.ts: a finger tap that misses every pin, cluster and spot
                             (empty map or a route line) opens the nearest one within 22 px (44 px
                             target); drawn shapes keep first claim, mouse clicks are untouched;
                             map/stopChip.ts: the open day's stop numbers live in their own
                             click-through pane (620: above markers 600, under tooltips 650), so no
                             pin or cluster covers them, each at its own marker's top-right
                             map/userLayer.ts: the user's blue dot in its own click-through pane (640:
                             above pins and stop chips, under tooltips, never dimmed) and the follow camera;
                             map/LocateControl.tsx: the "My location" button as a Leaflet control
location/                    "My location" (see Location below): locateMachine.ts (pure state machine),
                             locator.ts (watchPosition / Permissions API driver), heading.ts (compass),
                             position.ts (UserFix, straight-line distance), useDistanceFromUser (card meta)
routing/                     live road geometry for edited plans: legs come from data.roads, then
                             an IndexedDB cache (`trip-roads-v1`, keyed by OSRM base URL + both
                             ends at 5 decimals, LRU-pruned at 2,000 legs), then one OSRM request
                             per changed day (only the stretch with unknown legs, chunked above
                             100 waypoints, "no route" narrowed by halves). 700 ms debounce after
                             edits, a newer edit aborts the request of a day it changed, 1 request/s
                             for the page, nothing offline, 2 s → 60 s backoff after failures.
                             Uses data.roads_enabled / roads_endpoint / roads_profile; exports
                             without them get no live routing. The status pill says "Some routes
                             are approximate" while legs stay straight offline or after failures
features/plan/               Plan tab (days, stops, directions links); the phone peek row starts at
                             the next stop by the clock on a dated trip's day ("Next"), otherwise at
                             #1 of the open Plan day ("Day 1 · #1"), and steps ‹ › (or swipes)
                             through that day's visits, flying the map to each and lighting its pin;
                             back to its start after 2 idle min. A dated trip opens on today's day
features/places/             Places tab (search, filters, list, hide, export preferences). Filters are one
                             grid of dropdowns: day (with place counts), "Good for" (multi-select of the
                             traveller intents in data/intents.ts, matching any; popover, a bottom panel on
                             phones), priority, category. They also hide pins on the map while the tab shows,
                             and a chosen day draws only that day's route and stop chips (selectRouteDays)
features/card/               place card (media, hours, best time, links)
features/editor/             plan editor: logic/ (pure TS: clock, checks, plan.json; Vitest cases
                             mirror tests/test_plan_agent.py) and UI; lazy loaded (React.lazy).
                             Every edit autosaves a draft in this browser. Stops show only an icon
                             for their checks; the words are in the place card ("Plan notes").
                             data/planIssues.ts runs the same checks on the plan as shown (generated
                             or edited) from a lazy chunk (editor/planNotes.ts, loaded when idle),
                             once per plan and language, for the Plan tab icons and the card
pwa/                         SW registration, update toast, offline status; install: "Install app"
                             in the map tools (popover: the browser's prompt or this browser's steps,
                             "Not now" leaves an icon-only button for 14 days) plus the panel footer
                             entry; "Installed" toast
ui/                          small shared components (Button, Segmented, Toast, Sheet, Icon, PlaceStars)
                             BottomSheet + sheetDrag: phone sheet with detents peek / half / full
                             (store `sheet`); pointer drag on the compositor, velocity-projected snap
                             (pure rules in lib/sheetSnap.ts), list hand-off at its top; map tap lowers it
styles/                      tokens.css (light + dark) + per-feature CSS
test/                        Vitest setup, fixtures, renderTrip
```

## Rules

- Keep the visual design (tokens, layout, phone bottom sheet); improve only where cheap and clearly
  better (ui-craft: focus-visible, reduced motion, tabular-nums).
- Plain CSS with the existing tokens (no Tailwind, no CSS-in-JS). Icons: the existing Lucide symbols.
- React: follow the `vercel-react-best-practices` skill (no inline components, derived state during
  render, functional setState, primitive effect deps, lazy-load editor and MapLibre, passive listeners,
  Set/Map lookups). Leaflet stays imperative inside hooks; React never re-renders per marker.
- TypeScript strict, no `any` except at the Leaflet plugin boundary. Minimal comments.
- Tests: pure logic in Vitest; Python side in pytest; nothing touches the network.
