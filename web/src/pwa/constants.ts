/** Shared by the app and the service worker. Keep TILE_HOSTS in sync with map_data.TILE_HOSTS. */
export const TILE_HOSTS: readonly string[] = ["tiles.openfreemap.org", "server.arcgisonline.com", "tile.openstreetmap.org"];
/** Google Maps is never cached (terms of service); these hosts get no service worker route. */
const NEVER_CACHE_HOST_SUFFIXES: readonly string[] = ["google.com", "googleapis.com", "gstatic.com"];

export const CACHE_NAMES = {
  trip: "trip-data-v1",
  media: "trip-media-v1",
  tiles: "trip-tiles-v1",
  meta: "trip-meta-v1",
} as const;
/** The old hand-written app's shell caches, removed on activation. */
export const LEGACY_CACHE_PREFIX = "trip-app-";

export const TILE_MAX_ENTRIES = 12000;
export const TRIP_NETWORK_TIMEOUT_S = 3;
export const OFFLINE_MANIFEST_URL = "offline.json";

export interface OfflineManifest {
  version: string;
  urls: string[];
}

export type SwMessage = { type: "SKIP_WAITING" } | ({ type: "WARM_OFFLINE" } & OfflineManifest);

export function isOfflineManifest(value: unknown): value is OfflineManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<Record<keyof OfflineManifest, unknown>>;
  return (
    typeof manifest.version === "string" &&
    Array.isArray(manifest.urls) &&
    manifest.urls.every((url) => typeof url === "string")
  );
}

export function isNeverCached(hostname: string): boolean {
  return NEVER_CACHE_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}
