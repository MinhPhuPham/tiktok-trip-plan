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
const WEIGHT = 1.5;
/** The drawn dot, stroke included. */
export const NEARBY_DOT_SIZE = 2 * RADIUS + WEIGHT;

const nearbyInputs = (model: TripModel) => (s: TripState) =>
  [s.overlays.nearby, s.plan, selectMapFocusDay(s), s.selected, drawnHover(model, s)] as const;

/** Famous spots near the places: grey dots in their own pane, dimmed where mapEmphasis says so. */
export function useNearbyLayer(handle: MapHandle | null): void {
  const model = useTripModel();
  const store = useTripStoreApi();

  useEffect(() => {
    if (!handle || !model.data.nearby.length) return undefined;
    const { map, renderers, reach } = handle;
    let stopWatch: (() => void) | null = null;
    let dots: L.CircleMarker[] = [];
    const layer = L.layerGroup();
    const stopReach = reach.add(() => (map.hasLayer(layer) ? dots : []));
    const cancelIdle = whenIdle(() => {
      const spots = model.data.nearby.map((spot) => {
        const dot = L.circleMarker([spot.lat, spot.lng], {
          renderer: renderers.nearby,
          radius: RADIUS,
          color: STROKE,
          weight: WEIGHT,
          fillColor: FILL,
          fillOpacity: 0.95,
          bubblingMouseEvents: false,
        });
        dot.bindTooltip(spot.name, { direction: "top", offset: [0, -6] });
        dot.on("click", () => store.getState().actions.openCard(spot.id, { fly: false }));
        dot.addTo(layer);
        return { id: spot.id, dot };
      });
      dots = spots.map(({ dot }) => dot);
      stopWatch = watch(store, nearbyInputs(model), ([on, plan, focusDay, selected, hover]) => {
        setLayerOn(map, layer, on);
        const emphasis = mapEmphasis(getTripPlan(model, plan), focusDay, hover, selected);
        const ring = hover == null ? STROKE : cssVar("--text", STROKE);
        for (const { id, dot } of spots) {
          const hovered = id === hover;
          const lit = isLit(emphasis, id);
          dot.setStyle({
            opacity: lit ? 1 : DIMMED_OPACITY,
            fillOpacity: lit ? 0.95 : DIMMED_OPACITY,
            color: hovered ? ring : STROKE,
            weight: hovered ? 3 : WEIGHT,
          });
          dot.setRadius(hovered ? HOVER_RADIUS : RADIUS);
          if (hovered && on) dot.bringToFront();
        }
      });
    });
    return () => {
      cancelIdle();
      stopReach();
      stopWatch?.();
      map.removeLayer(layer);
    };
  }, [handle, model, store]);
}
