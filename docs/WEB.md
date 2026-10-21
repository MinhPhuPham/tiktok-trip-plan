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
  `palette.CATEGORY_COLORS`); compass rays, labels and the direction filter keep the sector colours.
  Exports older than those fields use the copy in `web/src/data/palette.ts` (a test keeps it equal
  to the schema defaults).
- A render error inside the app shows the load-error screen (Reload) instead of a blank page.
- Both builds' `index.html` contain exactly one
  `<script id="trip-data" type="application/json">__TRIP_DATA__</script>` and `<title>__TRIP_TITLE__</title>`.
  - single: Python replaces both (`</` escaped as `<\/`, `<!--` as `<\!--`).
  - app: Python leaves `index.html` untouched (it is precached by revision); the app sets
    `document.title` from the data, and an unreplaced `__TRIP_DATA__` means "fetch trip.json".
- `manifest.webmanifest` in the app build holds `"__TRIP_NAME__"` and `"__TRIP_SHORT_NAME__"`;
  Python fills them (city). The manifest is not precached; the SW warms it with `trip.json` and serves it network-first.

## Python export writes

`output/app/` = copy of `web_dist/app/` + `trip.json` + filled `manifest.webmanifest` + `media/`
(copy of `output/media/`) + `offline.json`:

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
  `map_data.TILE_HOSTS`); never cache Google Maps hosts.
- Updates: new SW waits; the app shows a toast "New version, Reload" (`registerType: "prompt"`).
- Tile preload (`map/useTilePreload.ts`) fills the tile cache for the trip area whenever the drawn
  basemap or the plan changes (online only, not on Save-Data / 2G, in the background, at most 400
  requests per run, each URL once): raster tiles and their labels overlay around the center and the
  planned stops; for the vector basemap the tiles of the style's TileJSON over the trip area, zoom 10–14.
- Install: manifest (`display: standalone`, theme colours light/dark, icons 192/512 + maskable,
  apple-touch-icon 180). An install button appears when `beforeinstallprompt` fires; iOS gets a one-line
  "Share → Add to Home Screen" hint.

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
                             markercluster, routes (road polylines from data.roads), compass, focus;
                             map/emphasis.ts decides what stays lit: the open day's stops plus the
                             hovered marker, or with no day open the hovered marker alone (spotlight)
features/plan/               Plan tab (days, stops, directions links, peek next stop)
features/places/             Places tab (search, filters, list, hide, export preferences)
features/card/               place card (media, hours, best time, links)
features/editor/             plan editor: logic/ (pure TS: clock, checks, plan.json; Vitest cases
                             mirror tests/test_plan_agent.py) and UI; lazy loaded (React.lazy)
pwa/                         SW registration, update toast, install button, offline status
ui/                          small shared components (Button, Segmented, Toast, Sheet, Icon, PlaceStars)
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
