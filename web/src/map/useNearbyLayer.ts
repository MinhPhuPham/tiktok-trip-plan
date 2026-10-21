import { useEffect } from "react";
import { getTripPlan, useTripModel } from "../data/hooks";
import type { TripModel } from "../data/model";
import { useTripStoreApi } from "../state/hooks";
import { selectMapFocusDay, type TripState } from "../state/store";
import L from "./leaflet";
import { isLit, mapEmphasis } from "./emphasis";
import { cssVar, DIMMED_OPACITY, drawnHover, setLayerOn, watch, whenIdle, type MapHandle } from "./mapCore";

const STROKE = "#5f6670";
const FILL = "#d4d7dc";
const RADIUS = 6;
const HOVER_RADIUS = 8;

const nearbyInputs = (model: TripModel) => (s: TripState) =>
  [s.overlays.nearby, s.plan, selectMapFocusDay(s), s.selected, drawnHover(model, s)] as const;

/** Famous spots near the places: grey dots in their own pane, dimmed where mapEmphasis says so. */
export function useNearbyLayer(handle: MapHandle | null): void {
  const model = useTripModel();
  const store = useTripStoreApi();

  useEffect(() => {
    if (!handle || !model.data.nearby.length) return undefined;
    const { map, renderers } = handle;
    let stopWatch: (() => void) | null = null;
    const layer = L.layerGroup();
    const cancelIdle = whenIdle(() => {
      const dots = model.data.nearby.map((spot) => {
        const dot = L.circleMarker([spot.lat, spot.lng], {
          renderer: renderers.nearby,
          radius: RADIUS,
          color: STROKE,
          weight: 1.5,
          fillColor: FILL,
          fillOpacity: 0.95,
          bubblingMouseEvents: false,
        });
        dot.bindTooltip(spot.name, { direction: "top", offset: [0, -6] });
        dot.on("click", () => store.getState().actions.openCard(spot.id, { fly: false }));
        dot.addTo(layer);
        return { id: spot.id, dot };
      });
      stopWatch = watch(store, nearbyInputs(model), ([on, plan, focusDay, selected, hover]) => {
        setLayerOn(map, layer, on);
        const emphasis = mapEmphasis(getTripPlan(model, plan), focusDay, hover, selected);
        const ring = hover == null ? STROKE : cssVar("--text", STROKE);
        for (const { id, dot } of dots) {
          const hovered = id === hover;
          const lit = isLit(emphasis, id);
          dot.setStyle({
            opacity: lit ? 1 : DIMMED_OPACITY,
            fillOpacity: lit ? 0.95 : DIMMED_OPACITY,
            color: hovered ? ring : STROKE,
            weight: hovered ? 3 : 1.5,
          });
          dot.setRadius(hovered ? HOVER_RADIUS : RADIUS);
          if (hovered && on) dot.bringToFront();
        }
      });
    });
    return () => {
      cancelIdle();
      stopWatch?.();
      map.removeLayer(layer);
    };
  }, [handle, model, store]);
}
