import { useEffect } from "react";
import { useTripModel } from "../data/hooks";
import { CENTER_REF } from "../data/types";
import { getTranslator } from "../i18n/useT";
import { inkFor, safeColor } from "../lib/color";
import { useTripStoreApi } from "../state/hooks";
import L from "./leaflet";
import { CENTER_ON_TOP_ZOOM, watch, type MapHandle } from "./mapCore";
import { centerHtml } from "./markup";

const ON_TOP = 2000;
const UNDER_CLUSTERS = -1000;

/** The hotel / center pin with its permanent name label. */
export function useCenterMarker(handle: MapHandle | null): void {
  const model = useTripModel();
  const store = useTripStoreApi();

  useEffect(() => {
    const center = model.data.center;
    if (!handle || !center) return undefined;
    const { map } = handle;
    const centerColor = safeColor(model.data.center_color);
    const marker = L.marker([center.lat, center.lng], {
      keyboard: false,
      zIndexOffset: ON_TOP,
      icon: L.divIcon({
        className: "pin-wrap",
        html: centerHtml(centerColor, inkFor(centerColor), center.kind),
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      }),
    }).addTo(map);
    marker.on("click", () => store.getState().actions.openCard(CENTER_REF, { fly: false }));
    marker.bindTooltip("", { permanent: true, direction: "right", offset: [20, 0], className: "center-label" });

    /* At city zoom the clusters win: the pin goes under them and its label closes. */
    const onZoom = () => {
      const near = map.getZoom() >= CENTER_ON_TOP_ZOOM;
      marker.setZIndexOffset(near ? ON_TOP : UNDER_CLUSTERS);
      if (near) marker.openTooltip();
      else marker.closeTooltip();
    };
    onZoom();
    map.on("zoomend", onZoom);
    const stopLang = watch(
      store,
      (s) => s.lang,
      (lang) => marker.setTooltipContent(getTranslator(model, lang).loc(center.name)),
    );
    return () => {
      stopLang();
      map.off("zoomend", onZoom);
      map.removeLayer(marker);
    };
  }, [handle, model, store]);
}
