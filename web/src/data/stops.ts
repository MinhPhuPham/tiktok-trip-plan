import type { Translator } from "../i18n/translator";
import { fold, localDate, toMin } from "../lib/format";
import type { TripModel } from "./model";
import {
  CENTER_REF,
  type MapNearby,
  type MapPlace,
  type PlanStop,
  type TripData,
  type TripDay,
  type TripPlan,
  type TripStop,
} from "./types";

export const stopPlace = (model: TripModel, stop: PlanStop): MapPlace | null =>
  stop.kind === "place" ? (model.placeById.get(stop.ref ?? "") ?? null) : null;

const stopSpot = (model: TripModel, stop: PlanStop): MapNearby | null =>
  stop.kind === "nearby" ? (model.nearbyById.get(stop.ref ?? "") ?? null) : null;

export const arriveMin = (stop: PlanStop): number | null =>
  Number.isFinite(stop.arrive_min) ? (stop.arrive_min as number) : toMin(stop.arrive);

const departMin = (stop: PlanStop): number | null =>
  Number.isFinite(stop.depart_min) ? (stop.depart_min as number) : toMin(stop.depart);

/** The card/target id a stop opens: the place or spot id, else "center". */
export function stopTargetId(model: TripModel, stop: PlanStop): string {
  const place = stopPlace(model, stop);
  if (place) return place.id;
  return stop.kind === "nearby" && stop.ref ? stop.ref : CENTER_REF;
}

export function stopName(model: TripModel, t: Translator, stop: PlanStop): string {
  const named = stopPlace(model, stop) ?? stopSpot(model, stop);
  if (named) return named.name;
  if (stop.kind === "rest") return t.loc(model.data.rest_name) || t.loc(stop.name);
  return (model.data.center ? t.loc(model.data.center.name) : "") || t.loc(stop.name);
}

/** The rhythm slot name, plus what the stop is when the slot accepts several categories. */
export function stopActivity(model: TripModel, t: Translator, stop: PlanStop): string {
  const spot = stopSpot(model, stop);
  if (spot) return t.kindName(spot.kind);
  const place = stopPlace(model, stop);
  const slot = stop.slot ? model.rhythm.get(stop.slot) : undefined;
  if (slot) {
    const name = t.lang === "vi" ? slot.name_vi : slot.name_en;
    const what = place ? t.category(place.category) : "";
    const generic = slot.categories.length !== 1;
    return what && generic && fold(what) !== fold(name) ? `${name} · ${what}` : name;
  }
  if (stop.slot) return stop.slot;
  if (stop.activity) return t.loc(stop.activity);
  if (place) return t.category(place.category);
  return t.labels.stop_kinds[stop.kind] ?? stop.kind;
}

export function stopTime(t: Translator, stop: PlanStop): string {
  const arrive = arriveMin(stop);
  const depart = departMin(stop);
  if (stop.kind === "start") return depart != null ? t.time(depart) : t.loc(stop.time);
  if (stop.kind === "end") return arrive != null ? t.time(arrive) : t.loc(stop.time);
  return arrive != null && depart != null ? t.range(arrive, depart) : t.loc(stop.time);
}

export function daySpan(t: Translator, day: TripDay): string {
  const first = day.stops[0];
  const last = day.stops[day.stops.length - 1];
  if (!first || !last) return "";
  const start = departMin(first);
  const end = arriveMin(last);
  return start != null && end != null ? t.range(start, end) : t.loc(day.span);
}

/** The day's visits (places and nearby spots), without start, end and rest. */
export const dayVisits = (day: TripDay): TripStop[] => day.stops.filter((s) => s.number != null);

/** Travel minutes to `stop` from the stop before it, when known. */
export function legMinutesTo(day: TripDay, stop: TripStop): number | null {
  const leg = day.stops[day.stops.indexOf(stop) - 1]?.travel_min_to_next;
  return typeof leg === "number" && Number.isFinite(leg) ? leg : null;
}

/** The trip day dated today (Day n for tripDates[n - 1]), or null on an undated trip or outside its dates. */
export function todayTripDay(data: TripData, now: Date = new Date()): number | null {
  const index = data.tripDates.indexOf(localDate(now));
  return index < 0 ? null : index + 1;
}

export interface PeekStart {
  day: TripDay;
  stop: TripStop;
  /** The next stop by the clock on a trip day of a dated trip; otherwise stop #1 of the open day. */
  live: boolean;
}

const hasVisits = (day: TripDay | undefined): day is TripDay => day != null && dayVisits(day).length > 0;

function liveStart(plan: TripPlan, today: number, now: Date): PeekStart | null {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const day of plan.days) {
    if (day.day < today) continue;
    const visits = dayVisits(day);
    const stop = day.day === today ? visits.find((s) => (departMin(s) ?? arriveMin(s) ?? -1) > nowMin) : visits[0];
    if (stop) return { day, stop, live: true };
  }
  return null;
}

/**
 * Where the phone peek row starts. On a trip day of a dated trip, with that day open (or none): the
 * next stop by the clock, into the following days once today is done. Otherwise stop #1 of the open
 * day, else of the first day with visits.
 */
export function peekStart(model: TripModel, plan: TripPlan, openDay: number | null, now: Date = new Date()): PeekStart | null {
  const today = todayTripDay(model.data, now);
  const live = today != null && (openDay == null || openDay === today) ? liveStart(plan, today, now) : null;
  if (live) return live;
  const open = openDay == null ? undefined : plan.dayByNumber.get(openDay);
  const day = hasVisits(open) ? open : plan.days.find(hasVisits);
  const stop = day ? dayVisits(day)[0] : undefined;
  return day && stop ? { day, stop, live: false } : null;
}
