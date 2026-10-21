import { useEffect } from "react";
import { getTripPlan, useTripModel } from "../data/hooks";
import type { TripDay } from "../data/types";
import { getTranslator } from "../i18n/useT";
import type { RoadRouter } from "../routing/router";
import { useTripStoreApi } from "../state/hooks";
import { selectRouteDays, type TripState } from "../state/store";
import L from "./leaflet";
import { cssVar, setLayerOn, watch, type MapHandle } from "./mapCore";
import { daySegments, type DaySegments, type RoadLookup } from "./polyline";
import { stopChipLayer } from "./stopChip";

interface DayLayers {
  route: L.LayerGroup;
  /** The road line and the dashed approximate line: both carry the tooltip and the click. */
  lines: L.Polyline[];
  chips: L.LayerGroup;
  /** Reshapes the day's lines when a leg's road arrived; layers stay as they are. */
  refresh: () => void;
}

/** Legs whose road is not known yet: dashes read as "approximate", casing and line dash in step. */
const APPROXIMATE_DASH = "6 7";

const selectRouteInputs = (s: TripState) => [s.overlays.routes, selectRouteDays(s)] as const;

const shapeOf = ({ solid, approximate }: DaySegments): string =>
  `${solid.map((run) => run.length).join(",")}|${approximate.length}`;

/**
 * One road-following line per plan day (casing under the day colour, tooltip, click opens the day
 * in the Plan tab; a finger tap beside a stop opens the stop instead). Legs whose road is still unknown are drawn straight and dashed until it
 * arrives; then only that day's lines change shape. One day (the Plan tab's open day or the Places
 * tab's day filter, see selectRouteDays) is drawn alone with its numbered chips.
 */
export function useRouteLayer(handle: MapHandle | null, scheme: "dark" | "light", roads: RoadRouter): void {
  const model = useTripModel();
  const store = useTripStoreApi();

  useEffect(() => {
    if (!handle) return undefined;
    const { map, renderers, reach } = handle;
    const road: RoadLookup = roads.live ? roads.lookup : (from, to) => roads.lookup(from, to) ?? [];
    const routeLayer = L.layerGroup();
    let days = new Map<number, DayLayers>();
    const dayName = (day: number) => getTranslator(model, store.getState().lang).dayName(day);

    const build = (day: TripDay): DayLayers => {
      const segments = daySegments(day.stops, road);
      let shape = shapeOf(segments);
      const casingStyle: L.PolylineOptions = { renderer: renderers.routes, color: cssVar("--casing"), weight: 5, opacity: 0.55, interactive: false };
      const lineStyle: L.PolylineOptions = { renderer: renderers.routes, color: day.color, weight: 3, opacity: 0.95, lineJoin: "round", bubblingMouseEvents: false };
      const casing = L.polyline(segments.solid, casingStyle);
      const line = L.polyline(segments.solid, lineStyle);
      const dashedCasing = L.polyline(segments.approximate, { ...casingStyle, dashArray: APPROXIMATE_DASH });
      const dashed = L.polyline(segments.approximate, { ...lineStyle, opacity: 0.85, dashArray: APPROXIMATE_DASH });
      const lines = [line, dashed];
      for (const path of lines) {
        path.bindTooltip(dayName(day.day), { sticky: true });
        path.on("click", (event) => {
          if (reach.claim(event)) return;
          const { actions } = store.getState();
          actions.setTab("plan");
          actions.setFocusDay(day.day);
        });
      }
      const chips = stopChipLayer(model, day);
      const refresh = () => {
        const segments = daySegments(day.stops, road);
        const next = shapeOf(segments);
        if (next === shape) return;
        shape = next;
        casing.setLatLngs(segments.solid);
        line.setLatLngs(segments.solid);
        dashedCasing.setLatLngs(segments.approximate);
        dashed.setLatLngs(segments.approximate);
      };
      return { route: L.layerGroup([casing, dashedCasing, line, dashed]), lines, chips, refresh };
    };

    const show = ([routesOn, shown]: ReturnType<typeof selectRouteInputs>) => {
      setLayerOn(map, routeLayer, routesOn);
      routeLayer.clearLayers();
      for (const [day, layers] of days) {
        if (shown === "all" || shown === day) routeLayer.addLayer(layers.route);
      }
      const single = typeof shown === "number" ? days.get(shown) : undefined;
      if (single) routeLayer.addLayer(single.chips);
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
        for (const [day, layers] of days) for (const path of layers.lines) path.setTooltipContent(dayName(day));
      },
    );
    const stopRoads = roads.subscribe(() => {
      for (const layers of days.values()) layers.refresh();
    });
    return () => {
      stopPlan();
      stopShow();
      stopLang();
      stopRoads();
      map.removeLayer(routeLayer);
    };
  }, [handle, model, store, scheme, roads]);
}
