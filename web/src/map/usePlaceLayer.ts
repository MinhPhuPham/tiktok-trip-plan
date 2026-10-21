import { useEffect } from "react";
import { prefersReducedMotion } from "../app/viewport";
import { visiblePlaceIds } from "../data/filters";
import { getTripPlan, useTripModel } from "../data/hooks";
import type { TripModel } from "../data/model";
import { pinSize, priorityRank } from "../data/priority";
import type { MapPlace, TripPlan } from "../data/types";
import { getTranslator } from "../i18n/useT";
import { useTripStoreApi } from "../state/hooks";
import { selectMapFocusDay, type TripState } from "../state/store";
import { clusterMix, type ClusterMember } from "./clusterMix";
import L from "./leaflet";
import { mapEmphasis, pinOpacity } from "./emphasis";
import { CLUSTER_OFF_ZOOM, drawnHover, watch, type MapHandle } from "./mapCore";
import { clusterHtml, pinHtml, type PinLook } from "./markup";

const HOVER_Z = 5000;

type Where = "cluster" | "focus" | null;

interface PlacePin {
  place: MapPlace;
  marker: L.Marker;
  where: Where;
  iconKey: string;
}

function pinLook(model: TripModel, plan: TripPlan, place: MapPlace, selected: boolean, hovered: boolean): PinLook {
  const slot = plan.placeSlots.get(place.id);
  const day = slot ? plan.dayByNumber.get(slot.day) : undefined;
  return {
    category: place.category,
    priority: place.priority,
    color: model.categoryColor(place.category),
    ink: model.categoryInk(place.category),
    selected,
    hovered: hovered && !selected,
    day: slot && day ? { n: slot.day, color: day.color, ink: day.ink } : null,
  };
}

function pinIcon(look: PinLook): L.DivIcon {
  const size = pinSize(look.priority);
  return L.divIcon({
    className: "pin-wrap",
    html: pinHtml(look),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -size / 2 - 2],
  });
}

const pinInputs = (model: TripModel) => (s: TripState) =>
  [s.tab, s.filters, s.hidden, s.showHidden, s.plan, selectMapFocusDay(s), s.selected, drawnHover(model, s)] as const;

const baseZ = (place: MapPlace): number => (4 - priorityRank(place.priority)) * 100;

/**
 * Place pins (fill = category) in a marker cluster (ring = category mix); the focused day's pins leave the cluster.
 * A hovered list row lights its pin (or the cluster holding it); what else stays lit is mapEmphasis.
 * Follows the store, never React renders.
 */
export function usePlaceLayer(handle: MapHandle | null): void {
  const model = useTripModel();
  const store = useTripStoreApi();

  useEffect(() => {
    if (!handle) return undefined;
    const { map } = handle;
    const members = new WeakMap<L.Marker, ClusterMember>();
    const translator = () => getTranslator(model, store.getState().lang);

    const cluster = L.markerClusterGroup({
      disableClusteringAtZoom: CLUSTER_OFF_ZOOM,
      maxClusterRadius: 52,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: false,
      chunkedLoading: true,
      animate: !prefersReducedMotion(),
      iconCreateFunction: (group) => {
        const kids = group.getAllChildMarkers().flatMap((m) => {
          const member = members.get(m);
          return member ? [member] : [];
        });
        const mix = clusterMix(kids, model.categoryColor);
        return L.divIcon({
          className: "cluster-wrap",
          html: clusterHtml(mix, translator().t("cluster", { n: mix.total })),
          iconSize: [mix.size, mix.size],
        });
      },
    }).addTo(map);
    const focusLayer = L.layerGroup().addTo(map);

    const pins = new Map<string, PlacePin>();
    for (const place of model.places) {
      const marker = L.marker([place.lat, place.lng], {
        keyboard: false,
        riseOnHover: true,
        zIndexOffset: baseZ(place),
      });
      marker.bindTooltip(place.name, { direction: "top" });
      marker.on("click", () => store.getState().actions.openCard(place.id, { fly: false }));
      members.set(marker, { category: place.category, priority: place.priority });
      pins.set(place.id, { place, marker, where: null, iconKey: "" });
    }

    /* The cluster holding the hovered pin; markercluster redraws cluster icons (and resets their
       classes) on zoom, pan and regrouping, so the mark is put back after each. */
    let litCluster: HTMLElement | null = null;
    const markCluster = () => {
      const hover = drawnHover(model, store.getState());
      const pin = hover == null ? undefined : pins.get(hover);
      const parent = pin?.where === "cluster" ? cluster.getVisibleParent(pin.marker) : null;
      const element = parent && parent !== pin?.marker ? (parent.getElement() ?? null) : null;
      if (litCluster && litCluster !== element) litCluster.classList.remove("is-hover");
      element?.classList.add("is-hover");
      litCluster = element;
    };
    map.on("zoomend moveend", markCluster);
    cluster.on("animationend", markCluster);

    /* What a finger can reach: each shown pin, or the cluster drawn in its place. */
    const stopReach = handle.reach.add(() => {
      const drawn = new Set<L.Marker>();
      for (const pin of pins.values()) {
        const shown = pin.where === "cluster" ? cluster.getVisibleParent(pin.marker) : pin.where === "focus" ? pin.marker : null;
        if (shown?.getElement()) drawn.add(shown);
      }
      return drawn;
    });

    const selectPinInputs = pinInputs(model);
    const sync = ([tab, filters, hidden, showHidden, rawPlan, focusDay, selected, hover]: ReturnType<typeof selectPinInputs>) => {
      const plan = getTripPlan(model, rawPlan);
      const visible = visiblePlaceIds(model, plan, { tab, filters, hidden, showHidden });
      const emphasis = mapEmphasis(plan, focusDay, hover, selected);
      const toCluster: L.Marker[] = [];
      const fromCluster: L.Marker[] = [];
      const toFocus: L.Marker[] = [];
      for (const [id, pin] of pins) {
        const look = pinLook(model, plan, pin.place, selected === id, id === hover);
        const iconKey = JSON.stringify(look);
        if (iconKey !== pin.iconKey) {
          pin.iconKey = iconKey;
          pin.marker.setIcon(pinIcon(look));
        }
        const opacity = pinOpacity(emphasis, id, hidden);
        if (pin.marker.options.opacity !== opacity) pin.marker.setOpacity(opacity);
        const z = baseZ(pin.place) + (id === hover ? HOVER_Z : 0);
        if (pin.marker.options.zIndexOffset !== z) pin.marker.setZIndexOffset(z);
        const want: Where = visible.has(id) ? (emphasis.focus.has(id) ? "focus" : "cluster") : null;
        if (want === pin.where) continue;
        if (pin.where === "cluster") fromCluster.push(pin.marker);
        else if (pin.where === "focus") focusLayer.removeLayer(pin.marker);
        if (want === "cluster") toCluster.push(pin.marker);
        else if (want === "focus") toFocus.push(pin.marker);
        pin.where = want;
      }
      /* The cluster group takes a marker off the map when it leaves the group: do that before the
         focus layer adds it, or a zoomed-in (unclustered) marker vanishes. */
      if (fromCluster.length) cluster.removeLayers(fromCluster);
      for (const marker of toFocus) focusLayer.addLayer(marker);
      if (toCluster.length) cluster.addLayers(toCluster);
      map.getContainer().classList.toggle("is-spotlight", emphasis.spotlight);
      markCluster();
    };

    const stopPins = watch(store, selectPinInputs, sync);
    const stopLang = watch(
      store,
      (s) => s.lang,
      (_, previous) => {
        if (previous !== undefined) cluster.refreshClusters();
      },
    );
    return () => {
      stopReach();
      stopPins();
      stopLang();
      map.off("zoomend moveend", markCluster);
      map.getContainer().classList.remove("is-spotlight");
      map.removeLayer(cluster);
      map.removeLayer(focusLayer);
    };
  }, [handle, model, store]);
}
