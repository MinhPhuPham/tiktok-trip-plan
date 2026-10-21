import { decodePolyline, encodePolyline, legKey, type LatLng, type LegEnd } from "../map/polyline";
import { samePoint } from "./legCache";
import { isAbortError } from "./throttle";

/** Waypoints per request; longer days go out in chunks that share their end points. */
export const MAX_WAYPOINTS = 100;
const ROUTE_QUERY = "overview=false&steps=true&geometries=polyline";
/** OSRM answers these (HTTP 400) when a waypoint cannot be reached or snapped to a road. */
const NO_ROUTE_CODES: ReadonlySet<string> = new Set(["NoRoute", "NoSegment"]);

export interface LegGeometry {
  /** Encoded polyline, precision 5. */
  points: string;
  durationS: number | null;
  distanceM: number | null;
}

export type RouteAnswer = { kind: "ok"; legs: LegGeometry[] } | { kind: "no-route" } | { kind: "invalid"; message: string };

export interface RoutedLeg extends LegGeometry {
  from: LatLng;
  to: LatLng;
  /** OSRM found no road between the two stops: drawn straight, never asked again. */
  noRoute: boolean;
}

export class RoutingError extends Error {
  override name = "RoutingError";
}

/** `<endpoint>/<profile>` without stray slashes; an empty profile is left out (map_data / osrm.route_url). */
export const routeBase = (endpoint: string, profile: string): string =>
  [endpoint, profile]
    .map((part) => part.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");

export function routeUrl(base: string, points: readonly LatLng[]): string {
  const coordinates = points.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
  return `${base}/route/v1/driving/${coordinates}?${ROUTE_QUERY}`;
}

/** The step geometries of one leg as one line, without the repeated point where two steps meet. */
export function mergeSteps(geometries: readonly string[]): LatLng[] {
  const points: LatLng[] = [];
  for (const geometry of geometries) {
    for (const point of decodePolyline(geometry)) {
      const last = points[points.length - 1];
      if (!last || last[0] !== point[0] || last[1] !== point[1]) points.push(point);
    }
  }
  return points;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function parseLeg(leg: unknown): LegGeometry | null {
  if (!isRecord(leg) || !Array.isArray(leg.steps)) return null;
  const geometries: string[] = [];
  for (const step of leg.steps as unknown[]) {
    if (!isRecord(step) || typeof step.geometry !== "string") return null;
    geometries.push(step.geometry);
  }
  const points = mergeSteps(geometries);
  if (points.length < 2) return null;
  return { points: encodePolyline(points), durationS: finite(leg.duration), distanceM: finite(leg.distance) };
}

/** An OSRM route answer (steps=true) split into one geometry per leg, in waypoint order. */
export function parseRoute(payload: unknown, legCount: number): RouteAnswer {
  if (!isRecord(payload)) return { kind: "invalid", message: "not a JSON object" };
  const { code } = payload;
  if (typeof code === "string" && NO_ROUTE_CODES.has(code)) return { kind: "no-route" };
  if (code !== "Ok") return { kind: "invalid", message: `code ${String(code)}` };
  const route: unknown = Array.isArray(payload.routes) ? payload.routes[0] : undefined;
  const legs: unknown = isRecord(route) ? route.legs : undefined;
  if (!Array.isArray(legs) || legs.length !== legCount) return { kind: "invalid", message: "unexpected legs" };
  const parsed: LegGeometry[] = [];
  for (const leg of legs as unknown[]) {
    const geometry = parseLeg(leg);
    if (!geometry) return { kind: "invalid", message: "a leg without geometry" };
    parsed.push(geometry);
  }
  return { kind: "ok", legs: parsed };
}

/** [start, end] waypoint indexes of each request: at most MAX_WAYPOINTS each, neighbours share one. */
export function chunkSpans(waypointCount: number, max = MAX_WAYPOINTS): [number, number][] {
  const spans: [number, number][] = [];
  for (let start = 0; start < waypointCount - 1; ) {
    const end = Math.min(start + max - 1, waypointCount - 1);
    spans.push([start, end]);
    start = end;
  }
  return spans;
}

export interface RouteRequestOptions {
  /** routeBase(endpoint, profile). */
  base: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  /** Resolves when the next request may go out (the public server's fair-use rate). */
  throttle?: (signal?: AbortSignal) => Promise<void>;
}


async function requestRoute(points: readonly LatLng[], options: RouteRequestOptions): Promise<RouteAnswer> {
  const { signal, fetcher = fetch, throttle } = options;
  await throttle?.(signal);
  let response: Response;
  try {
    response = await fetcher(routeUrl(options.base, points), { signal, credentials: "omit" });
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error;
    throw new RoutingError(error instanceof Error ? error.message : String(error));
  }
  if (!response.ok && response.status !== 400) throw new RoutingError(`HTTP ${response.status}`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error;
    throw new RoutingError(`HTTP ${response.status}: not JSON`);
  }
  return parseRoute(payload, points.length - 1);
}

/**
 * One request for the waypoints; a "no route" answer is narrowed down by halves until the legs
 * that have no road are known, so one unreachable stop does not straighten the whole day.
 */
async function routeSpan(points: readonly LatLng[], options: RouteRequestOptions): Promise<(LegGeometry | null)[]> {
  const answer = await requestRoute(points, options);
  if (answer.kind === "ok") return answer.legs;
  if (answer.kind === "invalid") throw new RoutingError(answer.message);
  if (points.length === 2) return [null];
  const middle = Math.floor((points.length - 1) / 2);
  const head = await routeSpan(points.slice(0, middle + 1), options);
  const tail = await routeSpan(points.slice(middle), options);
  return [...head, ...tail];
}

/**
 * The road of every leg between the stops, keyed like data.roads (legKey). Usually one request:
 * consecutive stops at the same point need no road, more than MAX_WAYPOINTS waypoints are chunked.
 * Throws RoutingError when the server fails and the signal's AbortError when aborted.
 */
export async function fetchDayRoute(stops: readonly LegEnd[], options: RouteRequestOptions): Promise<Map<string, RoutedLeg>> {
  const waypoints: LatLng[] = [];
  const legWaypoint: (number | null)[] = [];
  stops.forEach((stop, i) => {
    const previous = stops[i - 1];
    const point: LatLng = [stop.lat, stop.lng];
    if (previous && samePoint(previous, stop)) {
      legWaypoint.push(null);
      return;
    }
    if (previous) legWaypoint.push(waypoints.length - 1);
    waypoints.push(point);
  });
  const legs: (LegGeometry | null)[] = [];
  for (const [start, end] of chunkSpans(waypoints.length)) {
    legs.push(...(await routeSpan(waypoints.slice(start, end + 1), options)));
  }
  const routed = new Map<string, RoutedLeg>();
  legWaypoint.forEach((index, i) => {
    const from = stops[i];
    const to = stops[i + 1];
    if (index == null || !from || !to) return;
    const leg = legs[index] ?? null;
    routed.set(legKey(from, to), {
      from: [from.lat, from.lng],
      to: [to.lat, to.lng],
      points: leg?.points ?? "",
      durationS: leg?.durationS ?? null,
      distanceM: leg?.distanceM ?? null,
      noRoute: leg === null,
    });
  });
  return routed;
}
