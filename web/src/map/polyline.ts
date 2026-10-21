import { CENTER_KINDS, CENTER_REF, type PlanStop } from "../data/types";

export type LatLng = [number, number];

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

/** The travel-matrix node of a stop: its place or spot id, "center" for start, end and rest. */
const legNode = (stop: Pick<PlanStop, "kind" | "ref">): string =>
  CENTER_KINDS.has(stop.kind) || !stop.ref ? CENTER_REF : stop.ref;

export const legKey = (from: Pick<PlanStop, "kind" | "ref">, to: Pick<PlanStop, "kind" | "ref">): string =>
  `${legNode(from)}>${legNode(to)}`;

export type RoadLookup = (from: Pick<PlanStop, "kind" | "ref">, to: Pick<PlanStop, "kind" | "ref">) => readonly LatLng[];

/** Road geometry per leg from data.roads ("<from>><to>" → encoded polyline), decoded once. */
export function createRoadLookup(roads: Readonly<Record<string, string>>): RoadLookup {
  const decoded = new Map<string, LatLng[]>();
  return (from, to) => {
    const key = legKey(from, to);
    const encoded = Object.hasOwn(roads, key) ? roads[key] : undefined;
    if (typeof encoded !== "string" || !encoded) return [];
    let points = decoded.get(key);
    if (!points) decoded.set(key, (points = decodePolyline(encoded)));
    return points;
  };
}

/** The stops joined along each leg's road (straight when a leg has none); the line touches every stop. */
export function dayLine(stops: readonly (Pick<PlanStop, "kind" | "ref"> & { lat: number; lng: number })[], road: RoadLookup): LatLng[] {
  const points: LatLng[] = [];
  stops.forEach((stop, i) => {
    const previous = stops[i - 1];
    if (previous) points.push(...road(previous, stop));
    points.push([stop.lat, stop.lng]);
  });
  return points;
}
