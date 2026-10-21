/// <reference lib="webworker" />
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";
import {
  CACHE_NAMES,
  LEGACY_CACHE_PREFIX,
  OFFLINE_MANIFEST_URL,
  ROUTE_MAX_AGE_S,
  ROUTE_MAX_ENTRIES,
  ROUTING_HOSTS,
  TILE_HOSTS,
  TILE_MAX_ENTRIES,
  TRIP_NETWORK_TIMEOUT_S,
  isNeverCached,
  isOfflineManifest,
  type OfflineManifest,
  type SwMessage,
} from "./pwa/constants";

declare const self: ServiceWorkerGlobalScope;

const OFFLINE_VERSION_KEY = "offline-version";
const WARM_CONCURRENCY = 4;
const scope = new URL(self.registration.scope);
const tripUrl = new URL("trip.json", scope).href;
/** Filled by the export, so not precached: warmed with the trip data, then network-first. */
const manifestUrl = new URL("manifest.webmanifest", scope).href;
const networkFirstUrls = new Set([tripUrl, manifestUrl]);
const mediaPrefix = new URL("media/", scope).pathname;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

registerRoute(
  ({ url }) => networkFirstUrls.has(url.href.split("?")[0] ?? ""),
  new NetworkFirst({ cacheName: CACHE_NAMES.trip, networkTimeoutSeconds: TRIP_NETWORK_TIMEOUT_S }),
);

registerRoute(
  ({ url }) => url.origin === scope.origin && url.pathname.startsWith(mediaPrefix),
  new CacheFirst({ cacheName: CACHE_NAMES.media, plugins: [new CacheableResponsePlugin({ statuses: [200] })] }),
);

registerRoute(
  ({ url }) => TILE_HOSTS.includes(url.hostname) && !isNeverCached(url.hostname),
  new StaleWhileRevalidate({
    cacheName: CACHE_NAMES.tiles,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: TILE_MAX_ENTRIES, purgeOnQuotaError: true }),
    ],
  }),
);

/** Road routes: the same waypoints give the same road, so the cached answer wins (fair use, offline). */
registerRoute(
  ({ url, request }) => request.method === "GET" && ROUTING_HOSTS.includes(url.hostname),
  new CacheFirst({
    cacheName: CACHE_NAMES.routes,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: ROUTE_MAX_ENTRIES, maxAgeSeconds: ROUTE_MAX_AGE_S, purgeOnQuotaError: true }),
    ],
  }),
);

/** A conditional GET built from the cached copy's validators; 304 keeps the cached copy. */
function revalidation(cached: Response): RequestInit | null {
  const headers = new Headers();
  const etag = cached.headers.get("ETag");
  const modified = cached.headers.get("Last-Modified");
  if (etag) headers.set("If-None-Match", etag);
  if (modified) headers.set("If-Modified-Since", modified);
  return etag || modified ? { cache: "no-store", headers } : null;
}

/**
 * Downloads the URLs the cache lacks; with `refresh`, cached ones are revalidated too (the export
 * keeps file names, so a re-export can change a photo behind the same URL). Returns how many failed.
 */
async function cacheUrls(cacheName: string, urls: readonly string[], refresh: boolean): Promise<number> {
  const cache = await caches.open(cacheName);
  const queue = [...urls];
  let failed = 0;
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const cached = await cache.match(url);
      if (cached && !refresh) continue;
      try {
        const response = await fetch(url, (cached && revalidation(cached)) ?? { cache: "no-cache" });
        if (response.status === 304) continue;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await cache.put(url, response);
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: WARM_CONCURRENCY }, worker));
  return failed;
}

/** Drops cached entries the current export no longer lists (renamed media, trip.json?query copies). */
async function prune(cacheName: string, keep: ReadonlySet<string>): Promise<void> {
  const cache = await caches.open(cacheName);
  const stale = (await cache.keys()).filter((request) => !keep.has(request.url));
  await Promise.all(stale.map((request) => cache.delete(request)));
}

async function storedVersion(): Promise<string | null> {
  const response = await (await caches.open(CACHE_NAMES.meta)).match(OFFLINE_VERSION_KEY);
  return response ? response.text() : null;
}

/**
 * Caches trip.json and every media file the export listed, once per offline.json version. The
 * version is stored only when every download worked, so a partial warm-up retries on the next app
 * start or when the app comes back online. A new version revalidates what is cached and drops what
 * the export no longer lists; `verify` (a new worker) also looks for missing files at the same version.
 */
async function warmOffline(manifest: OfflineManifest, verify: boolean): Promise<void> {
  const previous = await storedVersion();
  if (previous === manifest.version && !verify) return;
  const refresh = previous !== null && previous !== manifest.version;
  const absolute = [...new Set(manifest.urls.map((url) => new URL(url, scope).href))];
  const media = absolute.filter((url) => url !== tripUrl);
  if (refresh) {
    await prune(CACHE_NAMES.trip, networkFirstUrls);
    await prune(CACHE_NAMES.media, new Set(media));
  }
  const failed =
    (await cacheUrls(CACHE_NAMES.trip, [...networkFirstUrls], refresh)) +
    (await cacheUrls(CACHE_NAMES.media, media, refresh));
  if (failed) return;
  await (await caches.open(CACHE_NAMES.meta)).put(OFFLINE_VERSION_KEY, new Response(manifest.version));
}

let warming: { version: string; done: Promise<void> } | null = null;

/** One warm-up at a time: activation and the app's message often arrive together. */
function warmOnce(manifest: OfflineManifest, verify = false): Promise<void> {
  if (warming?.version === manifest.version) return warming.done;
  const done = (warming?.done ?? Promise.resolve()).then(() => warmOffline(manifest, verify)).catch(() => undefined);
  const current = { version: manifest.version, done };
  warming = current;
  void done.then(() => {
    if (warming === current) warming = null;
  });
  return done;
}

async function fetchOfflineManifest(): Promise<OfflineManifest | null> {
  try {
    const response = await fetch(new URL(OFFLINE_MANIFEST_URL, scope), { cache: "no-cache" });
    const body: unknown = response.ok ? await response.json() : null;
    return isOfflineManifest(body) ? body : null;
  } catch {
    return null;
  }
}

async function removeLegacyCaches(): Promise<void> {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith(LEGACY_CACHE_PREFIX)).map((name) => caches.delete(name)));
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    removeLegacyCaches().then(async () => {
      const manifest = await fetchOfflineManifest();
      if (manifest) await warmOnce(manifest, true);
    }),
  );
});

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  const message = event.data as SwMessage | null;
  if (message?.type === "SKIP_WAITING") void self.skipWaiting();
  if (message?.type === "WARM_OFFLINE" && isOfflineManifest(message)) event.waitUntil(warmOnce(message));
});

clientsClaim();
