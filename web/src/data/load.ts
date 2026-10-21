import type { TripData } from "./types";

const TRIP_DATA_ELEMENT_ID = "trip-data";
const TRIP_JSON_URL = "trip.json";
/** MapData.schema_version this app reads (map_data.MAP_SCHEMA_VERSION); bump both together. */
export const TRIP_SCHEMA_VERSION = 1;

export type TripLoadError =
  | { kind: "missing"; source: string }
  | { kind: "http"; source: string; status: number }
  | { kind: "network"; source: string; message: string }
  | { kind: "invalid"; source: string; message: string }
  /** The data was written for another app version: `found` is null for exports older than the field. */
  | { kind: "version"; source: string; found: number | null; expected: number };

export type TripLoadResult = { ok: true; data: TripData; source: "inline" | "fetch" } | { ok: false; error: TripLoadError };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type TripShape = Partial<Record<keyof TripData, unknown>>;

function isTripShape(value: unknown): value is TripShape {
  if (!value || typeof value !== "object") return false;
  const data = value as TripShape;
  return typeof data.city === "string" && Array.isArray(data.places) && Boolean(data.labels) && typeof data.labels === "object";
}

const schemaVersionOf = (data: TripShape): number | null =>
  typeof data.schema_version === "number" ? data.schema_version : null;

function isTripData(value: TripShape): value is TripData {
  return schemaVersionOf(value) === TRIP_SCHEMA_VERSION;
}

function parse(text: string, source: string, origin: "inline" | "fetch"): TripLoadResult {
  try {
    const value: unknown = JSON.parse(text);
    if (!isTripShape(value)) {
      return { ok: false, error: { kind: "invalid", source, message: "not a trip export (city, places, labels)" } };
    }
    if (isTripData(value)) return { ok: true, data: value, source: origin };
    return {
      ok: false,
      error: { kind: "version", source, found: schemaVersionOf(value), expected: TRIP_SCHEMA_VERSION },
    };
  } catch (error) {
    return { ok: false, error: { kind: "invalid", source, message: messageOf(error) } };
  }
}

/**
 * The single-file build carries the data inline; until the export fills it, the script holds a
 * placeholder (not JSON), and the app build always does: then trip.json is fetched next to the page.
 */
export function readInlineTrip(doc: Document = document): TripLoadResult | null {
  const text = doc.getElementById(TRIP_DATA_ELEMENT_ID)?.textContent?.trim() ?? "";
  return text.startsWith("{") ? parse(text, `#${TRIP_DATA_ELEMENT_ID}`, "inline") : null;
}

export async function fetchTrip(url: string = TRIP_JSON_URL, fetcher: typeof fetch = fetch): Promise<TripLoadResult> {
  let response: Response;
  try {
    response = await fetcher(url, { cache: "no-cache" });
  } catch (error) {
    return { ok: false, error: { kind: "network", source: url, message: messageOf(error) } };
  }
  if (response.status === 404) return { ok: false, error: { kind: "missing", source: url } };
  if (!response.ok) return { ok: false, error: { kind: "http", source: url, status: response.status } };
  return parse(await response.text(), url, "fetch");
}

export function loadTrip(doc: Document = document, fetcher: typeof fetch = fetch): Promise<TripLoadResult> {
  const inline = readInlineTrip(doc);
  return inline ? Promise.resolve(inline) : fetchTrip(TRIP_JSON_URL, fetcher);
}
