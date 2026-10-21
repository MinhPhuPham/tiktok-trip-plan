import { CENTER_KINDS, CENTER_REF, type PlanStop } from "../data/types";

export type LatLng = [number, number];

/** A stop as a leg end: its travel-matrix identity and where it is drawn. */
export type LegEnd = Pick<PlanStop, "kind" | "ref"> & { lat: number; lng: number };

/** Google encoded polyline (precision 5 by default) to [[lat, lng], …]. */
export function decodePolyline(text: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = text.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < text.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < text.length) {
    lat += next();
    lng += next();
    points.push([lat / factor, lng / factor]);
  }
  return points;
}

/** [[lat, lng], …] to a Google encoded polyline (the inverse of decodePolyline). */
export function encodePolyline(points: readonly LatLng[], precision = 5): string {
  const factor = 10 ** precision;
  let text = "";
  const push = (delta: number) => {
    let value = delta < 0 ? ~(delta << 1) : delta << 1;
    while (value >= 0x20) {
      text += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
      value >>>= 5;
    }
    text += String.fromCharCode(value + 63);
  };
  let lastLat = 0;
  let lastLng = 0;
  for (const [lat, lng] of points) {
    const y = Math.round(lat * factor);
    const x = Math.round(lng * factor);
    push(y - lastLat);
    push(x - lastLng);
    lastLat = y;
    lastLng = x;
  }
  return text;
}

/** The travel-matrix node of a stop: its place or spot id, "center" for start, end and rest. */
const legNode = (stop: Pick<PlanStop, "kind" | "ref">): string =>
  CENTER_KINDS.has(stop.kind) || !stop.ref ? CENTER_REF : stop.ref;

export const legKey = (from: Pick<PlanStop, "kind" | "ref">, to: Pick<PlanStop, "kind" | "ref">): string =>
  `${legNode(from)}>${legNode(to)}`;

/** The road between two stops; null while it is unknown (drawn straight and dashed). */
export type RoadLookup = (from: LegEnd, to: LegEnd) => readonly LatLng[] | null;

/** Road geometry per leg from data.roads ("<from>><to>" → encoded polyline), decoded once. */
export function createRoadLookup(roads: Readonly<Record<string, string>>): RoadLookup {
  const decoded = new Map<string, LatLng[]>();
  return (from, to) => {
    const key = legKey(from, to);
    const encoded = Object.hasOwn(roads, key) ? roads[key] : undefined;
    if (typeof encoded !== "string" || !encoded) return null;
    let points = decoded.get(key);
    if (!points) decoded.set(key, (points = decodePolyline(encoded)));
    return points;
  };
}

export interface DaySegments {
  /** Runs of consecutive legs with a known road, each touching its stops. */
  solid: LatLng[][];
  /** Straight stop-to-stop segments of the legs whose road is unknown. */
  approximate: LatLng[][];
}

/** A day's stops joined along each leg's road; a leg without one breaks the run into a straight segment. */
export function daySegments(stops: readonly LegEnd[], road: RoadLookup): DaySegments {
  const solid: LatLng[][] = [];
  const approximate: LatLng[][] = [];
  let run: LatLng[] = [];
  stops.forEach((stop, i) => {
    const point: LatLng = [stop.lat, stop.lng];
    const previous = stops[i - 1];
    if (previous) {
      const leg = road(previous, stop);
      if (leg) {
        run.push(...leg);
      } else {
        if (run.length > 1) solid.push(run);
        approximate.push([[previous.lat, previous.lng], point]);
        run = [];
      }
    }
    run.push(point);
  });
  if (run.length > 1) solid.push(run);
  return { solid, approximate };
}
