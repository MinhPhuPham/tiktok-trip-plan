import { useEffect } from "react";
import { useTripModel } from "../data/hooks";
import { useTripStoreApi } from "../state/hooks";
import { compassShapes } from "./compass";
import L from "./leaflet";
import { cssVar, setLayerOn, watch, whenIdle, type MapHandle } from "./mapCore";
import { rayLabelHtml, ringLabelHtml } from "./markup";

const labelIcon = (className: string, html: string) => L.divIcon({ className, html, iconSize: [0, 0] });

/** Direction rays and distance rings around the center (overlay "compass"). */
export function useCompassLayer(handle: MapHandle | null, scheme: "dark" | "light"): void {
  const model = useTripModel();
  const store = useTripStoreApi();

  useEffect(() => {
    const { center, rings, rays } = model.data;
    const shapes = compassShapes(center, rings, rays, model.sectorInk);
    if (!handle || !shapes) return undefined;
    const { map, renderers } = handle;
    const layer = L.layerGroup();
    let stopWatch: (() => void) | null = null;
    const cancelIdle = whenIdle(() => {
      const ringColor = cssVar("--text-3", "#888888");
      const label = { pane: "compass", interactive: false, keyboard: false } as const;
      for (const ring of shapes.rings) {
        L.circle(ring.center, {
          radius: ring.radiusM,
          renderer: renderers.compass,
          color: ringColor,
          weight: 1,
          opacity: 0.6,
          dashArray: "4 6",
          fill: false,
          interactive: false,
        }).addTo(layer);
        L.marker(ring.labelAt, { ...label, icon: labelIcon("ring-label", ringLabelHtml(ring.label)) }).addTo(layer);
      }
      for (const ray of shapes.rays) {
        L.polyline(ray.line, { renderer: renderers.compass, color: ray.color, weight: 2, opacity: 0.6, interactive: false }).addTo(layer);
        L.marker(ray.line[1], { ...label, icon: labelIcon("ray-label", rayLabelHtml(ray.label, ray.color, ray.ink)) }).addTo(layer);
      }
      stopWatch = watch(
        store,
        (s) => s.overlays.compass,
        (on) => setLayerOn(map, layer, on),
      );
    });
    return () => {
      cancelIdle();
      stopWatch?.();
      map.removeLayer(layer);
    };
  }, [handle, model, store, scheme]);
}
