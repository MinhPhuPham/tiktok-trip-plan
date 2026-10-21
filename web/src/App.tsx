import { DOM_IDS } from "./app/ids";
import { Panel } from "./app/Panel";
import { SkipLink } from "./app/SkipLink";
import { useDocumentChrome } from "./app/useDocumentChrome";
import { useGlobalKeys } from "./app/useGlobalKeys";
import { useViewport } from "./app/useViewport";
import { PlaceCard } from "./features/card/PlaceCard";
import { PlanDraftLoader } from "./features/editor/PlanDraftLoader";
import { MapView } from "./map/MapView";
import { useConnectivity } from "./pwa/useConnectivity";
import { usePwa } from "./pwa/usePwa";
import { useTripStore } from "./state/hooks";
import { selectMapFocusDay, type TripState } from "./state/store";
import { IconSprite } from "./ui/IconSprite";
import { StatusPill } from "./ui/StatusPill";
import { Toast } from "./ui/Toast";

const selectMapWrapClass = (s: TripState): string =>
  [
    "map-wrap",
    s.selected ? "has-card" : "",
    s.activeBasemap === "google" ? "is-google" : "",
    s.overlays.routes ? "" : "hide-routes",
    selectMapFocusDay(s) == null ? "" : "is-focus",
  ]
    .filter(Boolean)
    .join(" ");

function AppEffects() {
  useViewport();
  useDocumentChrome();
  useGlobalKeys();
  useConnectivity();
  usePwa();
  return null;
}

export default function App() {
  const mapWrapClass = useTripStore(selectMapWrapClass);
  return (
    <>
      <IconSprite />
      <AppEffects />
      <PlanDraftLoader />
      <SkipLink />
      <div className="app">
        <Panel />
        <main className={mapWrapClass} id={DOM_IDS.mapWrap}>
          <MapView />
          <PlaceCard />
          <StatusPill />
          <Toast />
        </main>
      </div>
    </>
  );
}
