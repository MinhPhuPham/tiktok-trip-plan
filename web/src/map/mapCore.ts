import { shallow } from "zustand/shallow";
import { placeDrawn } from "../data/filters";
import { getTripPlan } from "../data/hooks";
import type { TripModel } from "../data/model";
import type { TripState, TripStoreApi } from "../state/store";
import type { FingerReach } from "./fingerReach";
import type { Layer, Map as LeafletMap, Renderer } from "leaflet";

export const CLUSTER_OFF_ZOOM = 14;
export const FLY_ZOOM = 15;
export const MAX_ZOOM = 19;
export const MIN_ZOOM = 3;
/** At city zoom the hotel pin sits on the big cluster; below this zoom the cluster count wins. */
export const CENTER_ON_TOP_ZOOM = 14;
export const FALLBACK_VIEW: [number, number] = [10.78, 106.7];
/** Pins, dots and routes outside the focused day or the hovered row (map.css --map-dim matches). */
export const DIMMED_OPACITY = 0.25;
/** The open day's stop numbers: above every marker (Leaflet's marker pane is 600), under tooltips (650). */
export const STOP_CHIP_PANE = "stopChips";

export interface MapRenderers {
  compass: Renderer;
  routes: Renderer;
  nearby: Renderer;
}

export interface MapHandle {
  map: LeafletMap;
  renderers: MapRenderers;
  reach: FingerReach;
}

/**
 * Runs `run` now and whenever the selected slice changes (shallow compare, so tuples work),
 * without React: the Leaflet layers follow the store without re-rendering MapView.
 */
export function watch<T>(
  store: TripStoreApi,
  select: (state: TripState) => T,
  run: (value: T, previous: T | undefined) => void,
): () => void {
  let current = select(store.getState());
  run(current, undefined);
  return store.subscribe((state) => {
    const next = select(state);
    if (shallow(next, current)) return;
    const previous = current;
    current = next;
    run(next, previous);
  });
}

/** requestIdleCallback with a timeout, or a short timeout where it is missing; returns a cancel. */
export function whenIdle(run: () => void, timeout = 1500): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(run, 32);
  return () => window.clearTimeout(handle);
}

export function cssVar(name: string, fallback = "#ffffff"): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function setLayerOn(map: LeafletMap, layer: Layer | null, on: boolean): void {
  if (!layer) return;
  if (on && !map.hasLayer(layer)) layer.addTo(map);
  if (!on && map.hasLayer(layer)) map.removeLayer(layer);
}

/** The hovered row's place or nearby spot while the map draws it (a shown pin, or a dot with the overlay on). */
export function drawnHover(model: TripModel, s: TripState): string | null {
  const id = s.hovered;
  if (id == null) return null;
  const place = model.placeById.get(id);
  if (place) return placeDrawn(model, getTripPlan(model, s.plan), s, place) ? id : null;
  return s.overlays.nearby && model.nearbyById.has(id) ? id : null;
}
