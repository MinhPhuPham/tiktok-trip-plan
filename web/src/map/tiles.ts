import type { LatLng } from "./polyline";

export const PRELOAD_ZOOM = 15;
const PRELOAD_MAX = 240;
const MAX_LAT = 85.0511287798;
const PLACEHOLDER = /\{([srxyz])\}/g;
const ABSOLUTE = /^https?:\/\//;

export interface TileGrid {
  /** Leaflet's effective tile size (128 with detectRetina on a 256 layer). */
  tileSize: number;
  zoomOffset: number;
  subdomains: readonly string[];
}

/** The Web Mercator tile holding a point at a zoom, for tiles of `tileSize` px. */
export function tileAt([lat, lng]: LatLng, zoom: number, tileSize = 256): { x: number; y: number } {
  const scale = (256 * 2 ** zoom) / tileSize;
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  const x = ((lng + 180) / 360) * scale;
  const y = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * scale;
  return { x: Math.floor(x), y: Math.floor(y) };
}

/** A {s}/{x}/{y}/{z}/{r} tile URL template filled in; null when it has other placeholders. */
export function fillTileUrl(template: string, values: { s: string; x: number; y: number; z: number }): string | null {
  const url = template.replace(PLACEHOLDER, (_, key: string) =>
    key === "r" ? "" : String(values[key as "s" | "x" | "y" | "z"]),
  );
  return url.includes("{") ? null : url;
}

/** The 3×3 tiles around each point at each zoom, at most `max` distinct URLs, in point order. */
export function preloadTileUrls(
  template: string,
  points: readonly LatLng[],
  zooms: readonly number[],
  grid: TileGrid,
  max = PRELOAD_MAX,
): string[] {
  const urls = new Set<string>();
  for (const z of new Set(zooms)) {
    for (const point of points) {
      const tile = tileAt(point, z, grid.tileSize);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          if (urls.size >= max) return [...urls];
          const x = tile.x + dx;
          const y = tile.y + dy;
          const s = grid.subdomains.length ? (grid.subdomains[Math.abs(x + y) % grid.subdomains.length] ?? "") : "";
          const url = fillTileUrl(template, { s, x, y, z: z + grid.zoomOffset });
          if (url) urls.add(url);
        }
      }
    }
  }
  return [...urls];
}

/** Vector tile zooms warmed for the trip area: city to street level (MapLibre overzooms the last). */
const VECTOR_PRELOAD_ZOOMS = { min: 10, max: 14 } as const;
/** At most this many requests per warm-up (each vector tile is ~50 kB). */
export const PRELOAD_REQUEST_CAP = 400;

export interface VectorSource {
  tiles: string[];
  minzoom: number;
  maxzoom: number;
}

/**
 * Vector tile URLs over the trip area, zoom by zoom: the whole bounding box of the points while it
 * fits under `max`, else the 3×3 block around each point; at most `max` URLs.
 */
export function vectorTileUrls(
  source: VectorSource,
  points: readonly LatLng[],
  zooms: { min: number; max: number } = VECTOR_PRELOAD_ZOOMS,
  max = PRELOAD_REQUEST_CAP,
): string[] {
  const template = source.tiles[0];
  if (!template || !points.length) return [];
  const urls = new Set<string>();
  const add = (x: number, y: number, z: number) => {
    const chosen = source.tiles[Math.abs(x + y) % source.tiles.length] ?? template;
    const url = fillTileUrl(chosen, { s: "", x, y, z });
    if (url && urls.size < max) urls.add(url);
  };
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  const north: LatLng = [Math.max(...lats), Math.min(...lngs)];
  const south: LatLng = [Math.min(...lats), Math.max(...lngs)];
  for (let z = Math.max(zooms.min, source.minzoom); z <= Math.min(zooms.max, source.maxzoom); z += 1) {
    const a = tileAt(north, z);
    const b = tileAt(south, z);
    const box = (b.x - a.x + 1) * (b.y - a.y + 1);
    if (urls.size + box <= max) {
      for (let x = a.x; x <= b.x; x += 1) for (let y = a.y; y <= b.y; y += 1) add(x, y, z);
      continue;
    }
    for (const point of points) {
      const tile = tileAt(point, z);
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) add(tile.x + dx, tile.y + dy, z);
    }
  }
  return [...urls];
}

/** The vector source of a MapLibre style as TileJSON (inline `tiles`, or fetched from its `url`). */
export async function styleVectorSource(styleUrl: string, signal: AbortSignal): Promise<VectorSource | null> {
  const json = async (url: string): Promise<unknown> => {
    const response = await fetch(url, { signal, credentials: "omit" });
    return response.ok ? response.json() : null;
  };
  const style = (await json(styleUrl)) as { sources?: Record<string, unknown> } | null;
  const sources = Object.values(style?.sources ?? {}) as { type?: string; url?: string; tiles?: unknown }[];
  const vector = sources.find((source) => source.type === "vector");
  if (!vector) return null;
  const tileJson = (Array.isArray(vector.tiles) ? vector : vector.url ? await json(new URL(vector.url, styleUrl).href) : null) as {
    tiles?: unknown;
    minzoom?: unknown;
    maxzoom?: unknown;
  } | null;
  const tiles = Array.isArray(tileJson?.tiles) ? tileJson.tiles.filter((t): t is string => typeof t === "string") : [];
  if (!tiles.length) return null;
  return {
    tiles: tiles.map((t) => (ABSOLUTE.test(t) ? t : new URL(t, styleUrl).href.replace(/%7B/g, "{").replace(/%7D/g, "}"))),
    minzoom: typeof tileJson?.minzoom === "number" ? tileJson.minzoom : 0,
    maxzoom: typeof tileJson?.maxzoom === "number" ? tileJson.maxzoom : 14,
  };
}
