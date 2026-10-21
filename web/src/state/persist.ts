import type { TripData } from "../data/types";
import { storage } from "../lib/storage";

/**
 * What the app remembers per browser, versioned: preferences across trips, hidden places per trip.
 * v1 is the old hand-written app's unversioned keys (tripmap:lang, tripmap:<city>:hidden, …),
 * read once as a fallback so an upgrade keeps the user's choices. Keys a newer app dropped
 * (v2 `filtersOpen`, the old filters disclosure) are ignored when read and gone after the next save.
 */
const PERSIST_VERSION = 2;
const PREFIX = "tripmap:";
export const prefsKey = `${PREFIX}v${PERSIST_VERSION}:prefs`;
/** The per-trip storage id (hidden places here, the plan editor's draft): the city, or "trip". */
export const tripStorageId = (data: Pick<TripData, "city">): string => data.city || "trip";
export const tripKey = (id: string) => `${PREFIX}v${PERSIST_VERSION}:trip:${id}`;

export type OverlayKey = "compass" | "nearby" | "routes";
export type Overlays = Readonly<Record<OverlayKey, boolean>>;

export interface StoredPrefs {
  lang: string | null;
  basemap: string | null;
  overlays: Partial<Overlays>;
}

export interface StoredTrip {
  hidden: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object";
const stringOrNull = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

function parseOverlays(value: unknown): Partial<Overlays> {
  if (!isRecord(value)) return {};
  const out: Partial<Record<OverlayKey, boolean>> = {};
  for (const key of ["compass", "nearby", "routes"] as const) {
    if (typeof value[key] === "boolean") out[key] = value[key];
  }
  return out;
}

function parsePrefs(raw: unknown): StoredPrefs | null {
  if (!isRecord(raw) || raw.v !== PERSIST_VERSION) return null;
  return {
    lang: stringOrNull(raw.lang),
    basemap: stringOrNull(raw.basemap),
    overlays: parseOverlays(raw.overlays),
  };
}

function parseTrip(raw: unknown): StoredTrip | null {
  return isRecord(raw) && raw.v === PERSIST_VERSION ? { hidden: strings(raw.hidden) } : null;
}

function legacyPrefs(): StoredPrefs {
  const flag = (key: string): boolean | undefined => {
    const value = storage.readText(`${PREFIX}${key}`);
    return value == null ? undefined : value !== "0";
  };
  const overlays: Partial<Record<OverlayKey, boolean>> = {};
  for (const key of ["compass", "nearby", "routes"] as const) {
    const on = flag(`ov-${key}`);
    if (on !== undefined) overlays[key] = on;
  }
  return {
    lang: stringOrNull(storage.readText(`${PREFIX}lang`)),
    basemap: stringOrNull(storage.readText(`${PREFIX}basemap`)),
    overlays,
  };
}

export function loadPrefs(): StoredPrefs {
  return storage.read(prefsKey, parsePrefs) ?? legacyPrefs();
}

export function loadTrip(id: string): StoredTrip {
  return storage.read(tripKey(id), parseTrip) ?? { hidden: storage.read(`${PREFIX}${id}:hidden`, strings) ?? [] };
}

export function savePrefs(prefs: StoredPrefs): void {
  storage.write(prefsKey, { v: PERSIST_VERSION, ...prefs });
}

export function saveTrip(id: string, trip: StoredTrip): void {
  storage.write(tripKey(id), { v: PERSIST_VERSION, ...trip });
}

/** Calls `onChange` when another tab changes this trip's stored state. */
export function watchTrip(id: string, onChange: (trip: StoredTrip) => void): () => void {
  const key = tripKey(id);
  const listener = (event: StorageEvent) => {
    if (event.key === key || event.key === null) onChange(loadTrip(id));
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
