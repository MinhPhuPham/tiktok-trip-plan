import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./ui/ui.css";
import "./app/shell.css";
import { Boot } from "./app/Boot";
import { loadTrip } from "./data/load";
import { findBasemap, resolveBasemap } from "./map/basemapChoice";
import { loadPrefs } from "./state/persist";

const trip = loadTrip();

/** MapLibre is most of the map's weight: start downloading it with the data when it will be drawn. */
void trip.then((result) => {
  if (!result.ok) return;
  const shown = resolveBasemap(result.data, loadPrefs().basemap, false);
  if (findBasemap(result.data, shown)?.kind === "vector") void import("./map/vector").catch(() => undefined);
});

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Boot trip={trip} />
    </StrictMode>,
  );
}
