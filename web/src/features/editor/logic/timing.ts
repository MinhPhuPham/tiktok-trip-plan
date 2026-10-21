/** One day's clock and checks: port of planning/timing.py time_day. */
import { CENTER_REF, REST_REF } from "../../../data/types";
import { hoursPeriods, openingFit, parseHourRange, sectorGap, toHHMM, toMinutes } from "./clock";
import { LONG_LEG_MIN, LONG_WAIT_MIN, MAX_SECTOR_GAP_DEG, MIN_REST_MIN } from "./constants";
import { slotById, slotIndex, travelBetween, weekdayOf, type EditorContext } from "./context";
import type {
  BestTimeLike,
  EditorNode,
  EditorPlace,
  EditStop,
  Issue,
  IssueLevel,
  IssueParams,
  RhythmSlot,
  TimedDay,
  TimedStop,
} from "./types";

type AddIssue = (level: IssueLevel, rule: string, params?: IssueParams, index?: number | null, ref?: string | null) => void;

interface Resolved {
  stop: EditStop;
  node: EditorNode;
  slot: RhythmSlot | null;
  index: number;
}

function visitService(ctx: EditorContext, node: EditorNode, slot: RhythmSlot | null, arrive: number): number {
  if (node.kind !== "rest") return node.service;
  if (!slot) return ctx.restMinutes;
  return Math.max(toMinutes(slot.end) - arrive, MIN_REST_MIN);
}

const bestTimeOf = (place: EditorPlace): BestTimeLike | null => place.best_time ?? place.bestTime ?? null;

const bestSource = (place: EditorPlace): string | null => bestTimeOf(place)?.source || place.best_source || null;

function centerStop(ctx: EditorContext, kind: "start" | "end", at: number): TimedStop {
  const rest = ctx.nodes.get(REST_REF);
  return {
    kind,
    ref: null,
    name: rest?.name ?? "",
    lat: rest?.lat ?? null,
    lng: rest?.lng ?? null,
    arrive: toHHMM(at),
    depart: toHHMM(at),
    arrive_min: at,
    depart_min: at,
    travel_min_to_next: null,
    slot: null,
    reason: null,
    index: null,
  };
}

function visitStop(node: EditorNode, stop: EditStop, arrive: number, depart: number, index: number): TimedStop {
  return {
    kind: node.kind,
    ref: node.kind === "rest" ? null : node.ref,
    name: node.name,
    lat: node.lat,
    lng: node.lng,
    arrive: toHHMM(arrive),
    depart: toHHMM(depart),
    arrive_min: arrive,
    depart_min: depart,
    travel_min_to_next: null,
    slot: stop.slot || null,
    reason: stop.reason || null,
    reason_vi: stop.reason_vi || null,
    index,
  };
}

function checkVisit(add: AddIssue, node: EditorNode, slot: RhythmSlot | null, arrive: number, index: number): void {
  const place = node.place;
  if (!place) return;
  const best = bestTimeOf(place);
  if (best?.deadline && arrive > toMinutes(best.deadline)) {
    add("error", "deadline", { time: arrive, deadline: toMinutes(best.deadline) }, index, node.ref);
  }
  const categories = slot ? (slot.categories ?? []) : [];
  if (slot && categories.length && !categories.includes(node.category ?? "")) {
    add("warning", "slot_category", { category: node.category, slot: slot.id }, index, node.ref);
  }
  const window = best && bestSource(place) !== "heuristic" ? parseHourRange(best.hours) : null;
  if (window && !(window[0] <= arrive && arrive <= window[1])) {
    add("warning", "best_time", { time: arrive, lo: window[0], hi: window[1] }, index, node.ref);
  }
}

function checkDirections(add: AddIssue, resolved: readonly Resolved[]): void {
  const sectors = [...new Set(resolved.map((r) => r.node.sector).filter((s): s is string => Boolean(s)))].sort();
  for (const [i, a] of sectors.entries()) {
    for (const b of sectors.slice(i + 1)) {
      const gap = sectorGap(a, b);
      if (gap !== null && gap > MAX_SECTOR_GAP_DEG) {
        add("warning", "directions", { a, b, deg: Math.round(gap) });
        return;
      }
    }
  }
}

export function computeTimes(ctx: EditorContext, number: number, stops: readonly EditStop[]): TimedDay {
  const issues: Issue[] = [];
  const add: AddIssue = (level, rule, params, index, ref) =>
    issues.push({ level, rule, day: number, index: index ?? null, ref: ref ?? null, params: params ?? {} });
  const weekday = weekdayOf(ctx, number - 1);
  const { dayStart, dayEnd } = ctx;

  const resolved: Resolved[] = [];
  stops.forEach((stop, index) => {
    const node = ctx.nodes.get(stop.ref);
    if (!node) {
      add("error", "unknown_ref", { ref: stop.ref }, index, stop.ref);
      return;
    }
    const slot = slotById(ctx, stop.slot);
    if (stop.slot && !slot) add("error", "unknown_slot", { slot: stop.slot }, index, stop.ref);
    else if (!stop.slot) add("warning", "missing_slot", {}, index, stop.ref);
    resolved.push({ stop, node, slot, index });
  });
  const result: TimedDay = { day: number, weekday, stops: [], total_minutes: 0, zone_ids: [], issues };
  if (!resolved.length) {
    add("warning", "empty_day", {});
    return result;
  }

  const route: TimedStop[] = [];
  let previous = CENTER_REF;
  let clock = dayStart;
  for (const { stop, node, slot, index } of resolved) {
    const leg = travelBetween(ctx, previous, node.matrixId);
    const earliest = clock + leg.min;
    let arrive = earliest;
    if (node.kind !== "rest" && slot) arrive = Math.max(arrive, toMinutes(slot.start));
    if (node.place) {
      const fit = openingFit(hoursPeriods(node.place.hours), weekday, arrive, node.service);
      if (fit.arrive !== null) arrive = fit.arrive;
      else add("error", "closed", { time: arrive, closedDay: fit.closedDay, need: node.service, weekday }, index, node.ref);
    }
    if (!route.length) {
      const leave = Math.max(dayStart, arrive - leg.min);
      route.push(centerStop(ctx, "start", leave));
    } else if (arrive - earliest >= LONG_WAIT_MIN && node.kind !== "rest") {
      add("warning", "long_wait", { n: arrive - earliest, from: earliest, time: arrive }, index, node.ref);
    }
    const last = route.at(-1);
    if (last) {
      last.travel_min_to_next = leg.min;
      last.travel_estimated = leg.estimated;
    }
    const depart = arrive + visitService(ctx, node, slot, arrive);
    checkVisit(add, node, slot, arrive, index);
    if (depart > dayEnd) add("error", "day_end", { time: depart, end: dayEnd }, index, node.ref);
    route.push(visitStop(node, stop, arrive, depart, index));
    previous = node.matrixId;
    clock = depart;
  }

  const back = travelBetween(ctx, previous, CENTER_REF);
  const lastVisit = route.at(-1);
  if (lastVisit) {
    lastVisit.travel_min_to_next = back.min;
    lastVisit.travel_estimated = back.estimated;
  }
  const end = clock + back.min;
  route.push(centerStop(ctx, "end", end));
  if (end > dayEnd) add("warning", "late_return", { time: end, end: dayEnd });

  let latest = -1;
  for (const { stop, node, index } of resolved) {
    const i = slotIndex(ctx, stop.slot);
    if (i === null) continue;
    if (i < latest) add("warning", "slot_order", { slot: stop.slot ?? null }, index, node.ref);
    latest = Math.max(latest, i);
  }
  route.forEach((there, i) => {
    const travel = route[i - 1]?.travel_min_to_next || 0;
    if (travel > LONG_LEG_MIN) add("warning", "long_leg", { n: travel, back: there.kind === "end" }, there.index, there.ref);
  });
  checkDirections(add, resolved);

  const first = route[0];
  const last = route.at(-1);
  result.stops = route;
  result.total_minutes = first && last ? toMinutes(last.arrive) - toMinutes(first.depart) : 0;
  result.zone_ids = [...new Set(resolved.map((r) => r.node.zone).filter((z): z is string => Boolean(z)))];
  return result;
}

export function validateDay(ctx: EditorContext, number: number, stops: readonly EditStop[]): Issue[] {
  return computeTimes(ctx, number, stops).issues;
}
