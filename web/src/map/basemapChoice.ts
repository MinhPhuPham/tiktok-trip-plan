import type { Basemap, TripData } from "../data/types";

export const GOOGLE_ID = "google";
const PREFERRED_FALLBACK = "esri_streets";

type BasemapData = Pick<TripData, "basemaps" | "default_basemap" | "google">;

/** The layers popover's choices: Google first when configured and not failed, then the tile basemaps. */
export function basemapIds(data: BasemapData, googleFailed: boolean): string[] {
  const ids = data.basemaps.map((b) => b.id as string);
  if (data.google && !googleFailed) ids.unshift(GOOGLE_ID);
  return ids;
}

/** The basemap to draw for a stored choice: the choice when offered, else the export's default. */
export function resolveBasemap(data: BasemapData, chosen: string | null, googleFailed: boolean): string {
  return chosen && basemapIds(data, googleFailed).includes(chosen) ? chosen : data.default_basemap;
}

/** Where Google (or an unknown id) falls back to: Esri streets when it works, else the first working one. */
export function fallbackBasemap(data: BasemapData, failed: ReadonlySet<string>): Basemap | undefined {
  return (
    data.basemaps.find((b) => b.id === PREFERRED_FALLBACK && !failed.has(b.id)) ??
    data.basemaps.find((b) => !failed.has(b.id)) ??
    data.basemaps[0]
  );
}

/** After a tile basemap fails: the first one that has not failed, or undefined when all have. */
export function nextWorkingBasemap(data: BasemapData, failed: ReadonlySet<string>): Basemap | undefined {
  return data.basemaps.find((b) => !failed.has(b.id));
}

export function findBasemap(data: BasemapData, id: string): Basemap | undefined {
  return data.basemaps.find((b) => b.id === id);
}
