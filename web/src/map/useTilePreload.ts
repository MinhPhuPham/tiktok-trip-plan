import { useEffect } from "react";
import { getTripPlan, useTripModel } from "../data/hooks";
import type { TripModel } from "../data/model";
import type { Basemap, Plan } from "../data/types";
import { useTripStoreApi } from "../state/hooks";
import type { TripState } from "../state/store";
import { findBasemap } from "./basemapChoice";
import { connection, type RasterNow } from "./basemapController";
import { watch, whenIdle, type MapHandle } from "./mapCore";
import type { LatLng } from "./polyline";
import { PRELOAD_REQUEST_CAP, PRELOAD_ZOOM, preloadTileUrls, styleVectorSource, vectorTileUrls } from "./tiles";

const START_DELAY_MS = 1500;
const PARALLEL = 4;
const SLOW_NETWORK = /(^|-)2g$/;
/** Leaflet's default subdomains: the labels overlay is created without its own. */
const LEAFLET_SUBDOMAINS = ["a", "b", "c"];

const selectPreloadInputs = (s: TripState) => [s.activeBasemap, s.plan] as const;

function tripPoints(model: TripModel, plan: Plan): LatLng[] {
  const points: LatLng[] = [];
  const center = model.data.center;
  if (center) points.push([center.lat, center.lng]);
  for (const day of getTripPlan(model, plan).days) {
    for (const stop of day.stops) if (stop.number != null) points.push([stop.lat, stop.lng]);
  }
  return points;
}

function rasterUrls(now: RasterNow, points: readonly LatLng[], zoom: number): string[] {
  const { layer, base } = now;
  const subdomains = layer.options.subdomains;
  const zooms = [zoom, PRELOAD_ZOOM];
  const urls = preloadTileUrls(base.url, points, zooms, {
    tileSize: layer.getTileSize().x,
    zoomOffset: layer.options.zoomOffset ?? 0,
    subdomains: typeof subdomains === "string" ? subdomains.split("") : (subdomains ?? []),
  });
  if (!base.labels_url) return urls;
  const labels = preloadTileUrls(base.labels_url, points, zooms, { tileSize: 256, zoomOffset: 0, subdomains: LEAFLET_SUBDOMAINS });
  return [...urls, ...labels];
}

async function vectorUrls(base: Basemap, points: readonly LatLng[], signal: AbortSignal): Promise<string[]> {
  const source = await styleVectorSource(base.url, signal);
  return source ? vectorTileUrls(source, points) : [];
}

const usable = (): boolean => {
  const net = connection();
  return navigator.onLine && !net?.saveData && !SLOW_NETWORK.test(net?.effectiveType ?? "");
};

/**
 * Warms the browser and service-worker tile cache for the trip area so it works offline: raster
 * basemaps (and their labels) around the center and every planned stop, the vector basemap's tiles
 * over the trip area at city to street zoom. Runs again when the drawn basemap or the plan changes,
 * in the background, online only, at most PRELOAD_REQUEST_CAP requests per run, never a URL twice.
 */
export function useTilePreload(handle: MapHandle | null, raster: () => RasterNow | null): void {
  const model = useTripModel();
  const store = useTripStoreApi();

  useEffect(() => {
    if (!handle) return undefined;
    const { map } = handle;
    const warmed = new Set<string>();
    let run: AbortController | null = null;
    let timer = 0;
    let cancelIdle: (() => void) | null = null;

    const fetchAll = async (urls: readonly string[], signal: AbortSignal) => {
      const queue = urls.filter((url) => !warmed.has(url)).slice(0, PRELOAD_REQUEST_CAP);
      const worker = async () => {
        for (let url = queue.shift(); url && !signal.aborted; url = queue.shift()) {
          warmed.add(url);
          try {
            const response = await fetch(url, { mode: "cors", credentials: "omit", signal });
            await response.arrayBuffer();
          } catch {
            if (!signal.aborted) warmed.delete(url);
          }
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
    };

    const preload = async (signal: AbortSignal) => {
      const { activeBasemap, plan } = store.getState();
      const base = activeBasemap ? findBasemap(model.data, activeBasemap) : undefined;
      if (!base || !usable()) return;
      const points = tripPoints(model, plan);
      if (!points.length) return;
      if (base.kind === "vector") {
        await fetchAll(await vectorUrls(base, points, signal), signal);
        return;
      }
      const now = raster();
      if (now?.base.id === base.id) await fetchAll(rasterUrls(now, points, map.getZoom()), signal);
    };

    const schedule = () => {
      run?.abort();
      window.clearTimeout(timer);
      cancelIdle?.();
      const current = new AbortController();
      run = current;
      timer = window.setTimeout(() => {
        cancelIdle = whenIdle(() => void preload(current.signal).catch(() => undefined), 4000);
      }, START_DELAY_MS);
    };

    const stop = watch(store, selectPreloadInputs, schedule);
    const onOnline = () => schedule();
    window.addEventListener("online", onOnline);
    return () => {
      stop();
      window.removeEventListener("online", onOnline);
      run?.abort();
      window.clearTimeout(timer);
      cancelIdle?.();
    };
  }, [handle, model, store, raster]);
}
