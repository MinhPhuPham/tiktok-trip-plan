import { useEffect } from "react";
import { getTripPlan, useTripModel } from "../data/hooks";
import type { TripDay } from "../data/types";
import { getTranslator } from "../i18n/useT";
import { useTripStoreApi } from "../state/hooks";
import { selectMapFocusDay, type TripState } from "../state/store";
import L from "./leaflet";
import { cssVar, setLayerOn, watch, type MapHandle } from "./mapCore";
import { stopChipHtml } from "./markup";
import { createRoadLookup, dayLine } from "./polyline";

interface DayLayers {
  route: L.LayerGroup;
  line: L.Polyline;
  chips: L.LayerGroup;
}

const selectRouteInputs = (s: TripState) => [s.overlays.routes, selectMapFocusDay(s)] as const;

/**
 * One road-following line per plan day (casing under the day colour, tooltip, click opens the day
 * in the Plan tab). The Plan tab's open day keeps only its line and adds numbered stop chips.
 */
export function useRouteLayer(handle: MapHandle | null, scheme: "dark" | "light"): void {
  const model = useTripModel();
  const store = useTripStoreApi();

  useEffect(() => {
    if (!handle) return undefined;
    const { map, renderers } = handle;
    const road = createRoadLookup(model.data.roads);
    const routeLayer = L.layerGroup();
    let days = new Map<number, DayLayers>();
    const dayName = (day: number) => getTranslator(model, store.getState().lang).dayName(day);

    const build = (day: TripDay): DayLayers => {
      const points = dayLine(day.stops, road);
      const casing = L.polyline(points, {
        renderer: renderers.routes,
        color: cssVar("--casing"),
        weight: 5,
        opacity: 0.55,
        interactive: false,
      });
      const line = L.polyline(points, { renderer: renderers.routes, color: day.color, weight: 3, opacity: 0.95, lineJoin: "round", bubblingMouseEvents: false });
      line.bindTooltip(dayName(day.day), { sticky: true });
      line.on("click", () => {
        const { actions } = store.getState();
        actions.setTab("plan");
        actions.setFocusDay(day.day);
      });
      const chips = L.layerGroup();
      for (const stop of day.stops) {
        if (stop.number == null) continue;
        L.marker([stop.lat, stop.lng], {
          interactive: false,
          keyboard: false,
          zIndexOffset: 3000,
          icon: L.divIcon({
            className: "stop-chip-wrap",
            html: stopChipHtml(stop.number, day.color, day.ink),
            iconSize: [20, 20],
            iconAnchor: [-6, 24],
          }),
        }).addTo(chips);
      }
      return { route: L.layerGroup([casing, line]), line, chips };
    };

    const show = ([routesOn, focusDay]: ReturnType<typeof selectRouteInputs>) => {
      setLayerOn(map, routeLayer, routesOn);
      routeLayer.clearLayers();
      for (const [day, layers] of days) {
        if (focusDay == null || focusDay === day) routeLayer.addLayer(layers.route);
      }
      const focused = focusDay == null ? undefined : days.get(focusDay);
      if (focused) routeLayer.addLayer(focused.chips);
    };

    const stopPlan = watch(
      store,
      (s) => s.plan,
      (plan) => {
        days = new Map(getTripPlan(model, plan).days.map((day) => [day.day, build(day)]));
        show(selectRouteInputs(store.getState()));
      },
    );
    const stopShow = watch(store, selectRouteInputs, (inputs, previous) => {
      if (previous !== undefined) show(inputs);
    });
    const stopLang = watch(
      store,
      (s) => s.lang,
      (_, previous) => {
        if (previous === undefined) return;
        for (const [day, layers] of days) layers.line.setTooltipContent(dayName(day));
      },
    );
    return () => {
      stopPlan();
      stopShow();
      stopLang();
      map.removeLayer(routeLayer);
    };
  }, [handle, model, store, scheme]);
}
