import { DOM_IDS } from "../app/ids";
import { useTripModel } from "../data/hooks";
import { useT } from "../i18n/useT";
import { useRoadGeometry } from "../routing/useRoadGeometry";
import { useTripStore } from "../state/hooks";
import type { TripState } from "../state/store";
import { Icon } from "../ui/Icon";
import { GOOGLE_ID } from "./basemapChoice";
import { LayersPopover } from "./LayersPopover";
import { MapTools } from "./MapTools";
import { useBasemap } from "./useBasemap";
import { useCardDismiss } from "./useCardDismiss";
import { useCenterMarker } from "./useCenterMarker";
import { useColorScheme } from "./useColorScheme";
import { useCompassLayer } from "./useCompassLayer";
import { useLeafletMap } from "./useLeafletMap";
import { useMapIntents } from "./useMapIntents";
import { useNearbyLayer } from "./useNearbyLayer";
import { usePlaceLayer } from "./usePlaceLayer";
import { useRouteLayer } from "./useRouteLayer";
import { useTilePreload } from "./useTilePreload";
import "./map.css";

const selectGoogleShown = (s: TripState) => s.activeBasemap === GOOGLE_ID;

/**
 * The Leaflet map and its tools. Layers are imperative hooks that follow the store directly, so
 * this component renders again only for the map handle, colour scheme, language and basemap state.
 */
export function MapView() {
  const t = useT();
  const { data } = useTripModel();
  const scheme = useColorScheme();
  const googleShown = useTripStore(selectGoogleShown);
  const { ref, handle, failed } = useLeafletMap();
  const basemap = useBasemap(handle);
  const roads = useRoadGeometry();
  usePlaceLayer(handle);
  useCenterMarker(handle);
  useNearbyLayer(handle);
  useCompassLayer(handle, scheme);
  useRouteLayer(handle, scheme, roads);
  useMapIntents(handle);
  useCardDismiss(handle);
  useTilePreload(handle, basemap.raster);

  return (
    <>
      {data.google ? <div id={DOM_IDS.googleMap} aria-hidden="true" hidden={!googleShown} /> : null}
      <div ref={ref} id={DOM_IDS.map} role="region" tabIndex={-1} aria-label={t.t("map_label", { city: data.city })} />
      <MapTools />
      <LayersPopover basemapIds={basemap.ids} pending={basemap.pending} onChoose={basemap.choose} />
      {failed ? (
        <div className="map-error">
          <div>
            <Icon name="offline" />
            <p>{t.t("map_error")}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
