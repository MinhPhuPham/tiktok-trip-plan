import { safeColor } from "../lib/color";
import type { TripModel } from "./model";
import {
  CENTER_KINDS,
  UNASSIGNED,
  type PlaceSlot,
  type Plan,
  type PlanDay,
  type PlanStop,
  type TripDay,
  type TripPlan,
  type TripStop,
} from "./types";

const MAX_WAYPOINTS = 9;
const DIR_URL = "https://www.google.com/maps/dir/?api=1";
const VISIT_KINDS = new Set(["place", "nearby"]);

const isVisit = (stop: Pick<PlanStop, "kind">): boolean => VISIT_KINDS.has(stop.kind);

const stopsSignature = (stops: readonly PlanStop[]): string => stops.map((s) => `${s.kind}:${s.ref ?? ""}`).join("|");

/** Where a stop is drawn: its place or spot, the center for start/end/rest, else its own point. */
function stopPoint(model: TripModel, stop: PlanStop): [number, number] | null {
  const ref = stop.ref ?? "";
  const target =
    stop.kind === "place"
      ? model.placeById.get(ref)
      : stop.kind === "nearby"
        ? model.nearbyById.get(ref)
        : CENTER_KINDS.has(stop.kind)
          ? model.data.center
          : null;
  if (target) return [target.lat, target.lng];
  return Number.isFinite(stop.lat) && Number.isFinite(stop.lng) ? [stop.lat as number, stop.lng as number] : null;
}

/** Google Maps directions from where the traveller is now. */
export const directionsTo = (lat: number, lng: number, travelmode: string): string =>
  `${DIR_URL}&destination=${lat.toFixed(6)},${lng.toFixed(6)}&travelmode=${travelmode}`;

/** Google Maps directions links, split into legs of at most 9 waypoints. */
export function directionsFor(points: readonly (readonly [number, number])[], travelmode: string): string[] {
  if (points.length < 2) return [];
  const at = (pt: readonly [number, number]) => `${pt[0].toFixed(6)},${pt[1].toFixed(6)}`;
  const urls: string[] = [];
  for (let i = 0; i < points.length - 1; i += MAX_WAYPOINTS + 1) {
    const leg = points.slice(i, i + MAX_WAYPOINTS + 2);
    const first = leg[0];
    const last = leg[leg.length - 1];
    if (!first || !last) continue;
    let url = `${DIR_URL}&origin=${at(first)}&destination=${at(last)}`;
    if (leg.length > 2) url += `&waypoints=${leg.slice(1, -1).map(at).join("|")}`;
    urls.push(`${url}&travelmode=${travelmode}`);
  }
  return urls;
}

/** "N, NE · Old Quarter, Lake": the sectors and zones a day's places are in. */
function areasFor(model: TripModel, stops: readonly PlanStop[]): string {
  const sectors: string[] = [];
  const zones: string[] = [];
  for (const stop of stops) {
    const place = stop.kind === "place" ? model.placeById.get(stop.ref ?? "") : undefined;
    if (!place) continue;
    if (place.sector && place.sector !== UNASSIGNED && !sectors.includes(place.sector)) sectors.push(place.sector);
    if (place.zone && !zones.includes(place.zone)) zones.push(place.zone);
  }
  return [sectors.join(", "), zones.join(", ")].filter(Boolean).join(" · ");
}

function normalizeDay(model: TripModel, raw: PlanDay, index: number, originals: ReadonlyMap<number, string>): TripDay {
  const day = Number(raw.day) || index + 1;
  const stops: TripStop[] = [];
  let visit = 0;
  for (const source of raw.stops) {
    const point = stopPoint(model, source);
    if (!point) continue;
    stops.push({ ...source, lat: point[0], lng: point[1], number: isVisit(source) ? ++visit : null });
  }
  const unchanged = originals.get(day) === stopsSignature(raw.stops);
  const color = safeColor(raw.color ?? model.defaultDayColor(day));
  return {
    day,
    color,
    ink: model.dayInk(color),
    stops,
    areas: unchanged && typeof raw.areas === "string" ? raw.areas : areasFor(model, stops),
    directions:
      unchanged && Array.isArray(raw.directions)
        ? raw.directions
        : directionsFor(stops.map((s) => [s.lat, s.lng] as const), model.data.config.travelmode),
    span: raw.span,
  };
}

/** Numbers the visits, fills areas and directions for edited days, and finds each place's day. */
export function normalizePlan(model: TripModel, plan: Plan): TripPlan {
  const originals = new Map(model.data.days.map((d) => [d.day, stopsSignature(d.stops)]));
  const days = plan.days.map((raw, index) => normalizeDay(model, raw, index, originals));
  const placeSlots = new Map<string, PlaceSlot>();
  let visitCount = 0;
  for (const day of days) {
    for (const stop of day.stops) {
      if (stop.number != null) visitCount += 1;
      if (stop.kind === "place" && stop.ref && model.placeById.has(stop.ref) && !placeSlots.has(stop.ref)) {
        placeSlots.set(stop.ref, { day: day.day, stop: stop.number });
      }
    }
  }
  return {
    days,
    dayByNumber: new Map(days.map((d) => [d.day, d])),
    unplaced: plan.unplaced,
    placeSlots,
    visitCount,
    edited: plan.edited,
  };
}

export function dayColorOf(model: TripModel, plan: TripPlan, day: number): string {
  return plan.dayByNumber.get(day)?.color ?? model.defaultDayColor(day);
}
