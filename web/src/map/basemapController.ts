import type { Basemap, TripData } from "../data/types";
import { fallbackBasemap, findBasemap, GOOGLE_ID, nextWorkingBasemap } from "./basemapChoice";
import { loadGoogleMap, type GoogleMapLike } from "./google";
import L from "./leaflet";

const RASTER_FAIL_ERRORS = 4;

type Connection = { saveData?: boolean; effectiveType?: string };
export const connection = (): Connection | undefined => (navigator as Navigator & { connection?: Connection }).connection;

let webgl: boolean | null = null;
function hasWebGL(): boolean {
  if (webgl == null) {
    try {
      const canvas = document.createElement("canvas");
      webgl = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

/** What the map reports back: drawn basemap, Google pending/failed, status pill, toasts. */
export interface BasemapEvents {
  active: (id: string) => void;
  pending: (id: string | null) => void;
  googleFailed: () => void;
  status: (key: string | null) => void;
  /** A labels.ui key with its variables; basemap names are passed as ids, prefixed "basemap_". */
  toast: (key: string, vars?: Readonly<Record<string, string>>) => void;
}

export interface RasterNow {
  layer: L.TileLayer;
  base: Basemap;
}

export interface BasemapController {
  show: (id: string) => void;
  /** The raster layer drawn now (for the tile preload); null for vector and Google. */
  raster: () => RasterNow | null;
  googleFailed: () => boolean;
  redraw: () => void;
  destroy: () => void;
}

/**
 * Draws one basemap at a time under the overlays: raster tiles (+ labels overlay), a MapLibre style
 * (module loaded on first use) or Google under a transparent Leaflet. A basemap that fails to load
 * falls back to the next one with a toast.
 */
export function createBasemapController(
  map: L.Map,
  data: Pick<TripData, "basemaps" | "default_basemap" | "google">,
  googleElement: () => HTMLElement | null,
  on: BasemapEvents,
): BasemapController {
  const failed = new Set<string>();
  let googleState: "idle" | "loading" | "ready" | "failed" = "idle";
  let gmap: GoogleMapLike | null = null;
  let cancelGoogle: (() => void) | null = null;
  let tiles: L.Layer | null = null;
  let raster: RasterNow | null = null;
  let labels: L.TileLayer | null = null;
  let wanted = "";
  let active = "";
  let generation = 0;
  let destroyed = false;
  let frame = 0;
  let googleTimer = 0;
  const nextFrame = (run: () => void) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(run);
  };

  const syncGoogle = () => {
    if (!gmap || active !== GOOGLE_ID) return;
    const c = map.getCenter();
    gmap.moveCamera({ center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom() });
  };
  const onZoomAnim = (e: L.ZoomAnimEvent) => {
    if (gmap && active === GOOGLE_ID) gmap.moveCamera({ center: { lat: e.center.lat, lng: e.center.lng }, zoom: e.zoom });
  };

  const clear = () => {
    for (const layer of [tiles, labels]) if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    tiles = null;
    raster = null;
    labels = null;
  };

  const basemapFailed = (id: string) => {
    if (destroyed) return;
    failed.add(id);
    const next = nextWorkingBasemap(data, failed);
    if (!next) {
      on.toast("map_error");
      return;
    }
    on.toast("tiles_failed", { name: `basemap_${id}`, next: `basemap_${next.id}` });
    show(next.id);
  };

  const addRaster = (base: Basemap) => {
    const retina = window.devicePixelRatio >= 2 && !connection()?.saveData && base.retina;
    const layer = L.tileLayer(base.url, {
      attribution: base.attribution,
      maxZoom: base.max_zoom,
      subdomains: base.subdomains,
      crossOrigin: "anonymous",
      keepBuffer: 4,
      updateWhenIdle: true,
      updateWhenZooming: false,
      detectRetina: retina,
    });
    let loads = 0;
    let errors = 0;
    layer.on("tileload", () => (loads += 1));
    layer.on("tileerror", () => {
      errors += 1;
      if (errors >= RASTER_FAIL_ERRORS && loads === 0 && tiles === layer && navigator.onLine) basemapFailed(base.id);
    });
    tiles = layer.addTo(map);
    raster = { layer, base };
  };

  const addVector = (base: Basemap, token: number) => {
    if (!hasWebGL()) {
      basemapFailed(base.id);
      return;
    }
    void import("./vector")
      .then(({ createVectorLayer }) => {
        if (token !== generation || destroyed) return;
        const layer = createVectorLayer(base);
        try {
          tiles = layer.addTo(map);
        } catch (error) {
          console.warn("[trip] vector basemap failed to start", error);
          if (map.hasLayer(layer)) map.removeLayer(layer);
          tiles = null;
          basemapFailed(base.id);
          return;
        }
        const gl = layer.getMaplibreMap();
        let loaded = false;
        let gave = false;
        let errors = 0;
        gl.on("load", () => {
          loaded = true;
        });
        gl.on("error", (e: { tile?: unknown; sourceId?: unknown }) => {
          errors += 1;
          if (gave || loaded || tiles !== layer || !navigator.onLine) return;
          const styleFailed = !(e.tile || e.sourceId);
          if (!styleFailed && errors < RASTER_FAIL_ERRORS) return;
          gave = true;
          window.setTimeout(() => {
            if (tiles === layer) basemapFailed(base.id);
          }, 0);
        });
      })
      .catch((error: unknown) => {
        console.warn("[trip] vector basemap module failed to load", error);
        if (token === generation) basemapFailed(base.id);
      });
  };

  const loadGoogle = () => {
    const element = googleElement();
    if (destroyed || googleState === "loading" || googleState === "ready" || !data.google || !element) return;
    googleState = "loading";
    cancelGoogle = loadGoogleMap({
      src: data.google.src,
      element,
      camera: () => {
        const c = map.getCenter();
        return { center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom() };
      },
      onReady: (created) => {
        if (destroyed) return;
        gmap = created;
        googleState = "ready";
        map.on("move zoom", syncGoogle);
        map.on("zoomanim", onZoomAnim);
        if (wanted === GOOGLE_ID) show(GOOGLE_ID);
      },
      onFail: googleFailed,
    });
  };

  function googleFailed() {
    if (googleState === "failed" || destroyed) return;
    googleState = "failed";
    on.googleFailed();
    const next = fallbackBasemap(data, failed);
    on.toast("google_error", { next: `basemap_${next?.id ?? ""}` });
    if (wanted === GOOGLE_ID || active === GOOGLE_ID) {
      active = "";
      show(next?.id ?? data.default_basemap);
    }
  }

  function show(requested: string) {
    if (destroyed) return;
    let id = requested;
    wanted = id;
    if (id === GOOGLE_ID) {
      if (!data.google || googleState === "failed") {
        id = fallbackBasemap(data, failed)?.id ?? "";
      } else if (googleState !== "ready") {
        on.pending(GOOGLE_ID);
        on.status("loading_google");
        nextFrame(() => {
          window.clearTimeout(googleTimer);
          googleTimer = window.setTimeout(loadGoogle, 0);
        });
        return;
      }
    }
    generation += 1;
    clear();
    on.pending(null);
    on.status(null);
    if (id === GOOGLE_ID) {
      active = GOOGLE_ID;
      on.active(GOOGLE_ID);
      nextFrame(syncGoogle);
      return;
    }
    const base = findBasemap(data, id) ?? data.basemaps[0];
    if (!base) return;
    active = base.id;
    on.active(base.id);
    if (base.kind === "vector") addVector(base, generation);
    else addRaster(base);
    if (base.labels_url) {
      labels = L.tileLayer(base.labels_url, {
        pane: "labels",
        maxZoom: base.max_zoom,
        crossOrigin: "anonymous",
        keepBuffer: 4,
        updateWhenIdle: true,
        updateWhenZooming: false,
      }).addTo(map);
    }
  }

  return {
    show,
    raster: () => raster,
    googleFailed: () => googleState === "failed",
    redraw: () => {
      raster?.layer.redraw();
      labels?.redraw();
    },
    destroy: () => {
      destroyed = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(googleTimer);
      cancelGoogle?.();
      map.off("move zoom", syncGoogle);
      map.off("zoomanim", onZoomAnim);
      clear();
    },
  };
}
