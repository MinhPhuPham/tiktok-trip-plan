import { useCallback, useState } from "react";
import { prefersReducedMotion } from "../app/viewport";
import type { TripModel } from "../data/model";
import { useTripModel } from "../data/hooks";
import { useTripStoreApi } from "../state/hooks";
import type { TripStoreApi } from "../state/store";
import L from "./leaflet";
import { FALLBACK_VIEW, MAX_ZOOM, MIN_ZOOM, type MapHandle } from "./mapCore";

const PANES: readonly [name: string, zIndex: number][] = [
  ["labels", 300],
  ["compass", 350],
  ["routes", 420],
  ["nearby", 590],
];

/** Every place not hidden, plus the center (the fit button and the first view). */
export function fitAll(map: L.Map, model: TripModel, store: TripStoreApi, animate: boolean): void {
  const { hidden, phone } = store.getState();
  const points: L.LatLngTuple[] = model.places.filter((p) => !hidden.has(p.id)).map((p) => [p.lat, p.lng]);
  const center = model.data.center;
  if (center) points.push([center.lat, center.lng]);
  if (!points.length) {
    map.setView(FALLBACK_VIEW, 12);
    return;
  }
  const pad = phone ? 20 : 40;
  map.fitBounds(L.latLngBounds(points), { padding: [pad, pad], maxZoom: 15, animate: animate && !prefersReducedMotion() });
}

/** Canvas draws hundreds of paths cheaply; SVG is the fallback where a 2D canvas is unavailable. */
function canvasWorks(): boolean {
  try {
    return Boolean(document.createElement("canvas").getContext("2d"));
  } catch {
    return false;
  }
}

function createMap(element: HTMLElement): MapHandle {
  const map = L.map(element, {
    zoomControl: false,
    worldCopyJump: false,
    wheelPxPerZoomLevel: 90,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
  });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
  for (const [name, zIndex] of PANES) map.createPane(name).style.zIndex = String(zIndex);
  const labels = map.getPane("labels");
  if (labels) labels.style.pointerEvents = "none";
  const attribution = element.querySelector<HTMLElement>(".leaflet-control-attribution");
  if (attribution) attribution.tabIndex = 0;
  const renderer = canvasWorks() ? L.canvas : L.svg;
  return {
    map,
    renderers: {
      compass: renderer({ pane: "compass", padding: 0.5 }),
      routes: renderer({ pane: "routes", padding: 0.5, tolerance: 6 }),
      /* SVG with a click-through root: a canvas here would cover the route canvas and swallow its hover and clicks. */
      nearby: L.svg({ pane: "nearby", padding: 0.5 }),
    },
  };
}

export interface LeafletMapState {
  /** Ref callback for the #map element; the map lives exactly as long as the element. */
  ref: (element: HTMLDivElement | null) => (() => void) | undefined;
  handle: MapHandle | null;
  failed: boolean;
}

/** Creates the Leaflet map (panes, canvas renderers, controls, first fit) on the #map element. */
export function useLeafletMap(): LeafletMapState {
  const model = useTripModel();
  const store = useTripStoreApi();
  const [handle, setHandle] = useState<MapHandle | null>(null);
  const [failed, setFailed] = useState(false);

  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return undefined;
      let created: MapHandle;
      try {
        created = createMap(element);
        fitAll(created.map, model, store, false);
      } catch (error) {
        console.error("[trip] the map could not start", error);
        setFailed(true);
        return undefined;
      }
      let frame = 0;
      const resize = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => created.map.invalidateSize({ pan: false }));
      });
      resize.observe(element);
      setHandle(created);
      return () => {
        resize.disconnect();
        cancelAnimationFrame(frame);
        setHandle(null);
        created.map.remove();
      };
    },
    [model, store],
  );

  return { ref, handle, failed };
}
