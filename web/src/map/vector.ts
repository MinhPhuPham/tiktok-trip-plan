import "maplibre-gl/dist/maplibre-gl.css";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import type { Basemap } from "../data/types";

/** Loaded with import() only when a vector basemap is drawn: MapLibre is most of the map's weight. */
export function createVectorLayer(base: Basemap) {
  return maplibreGL({
    style: base.url,
    maxZoom: base.max_zoom,
    attributionControl: { customAttribution: base.attribution },
  });
}
