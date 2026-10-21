/** The editor context: nodes (rest, places, nearby spots), travel matrix, rhythm, weekdays. */
import { CENTER_REF, REST_REF } from "../../../data/types";
import { estimateMinutes, toMinutes } from "./clock";
import {
  DEFAULT_MAX_NEARBY,
  DEFAULT_NEARBY_SERVICE,
  DEFAULT_REST_MIN,
  DEFAULT_SERVICE,
  DEFAULT_WEEKDAY,
  EST_SPEED_KMH,
  MAX_DAYS,
} from "./constants";
import type { EditorConfig, EditorData, EditorNode, EditorPlace, Leg, Point, RhythmSlot } from "./types";

export interface EditorContext {
  cfg: EditorConfig;
  dayStart: number;
  dayEnd: number;
  rhythm: readonly RhythmSlot[];
  restMinutes: number;
  tripDays: number;
  maxPlacesPerDay: number | null;
  maxNearbyPerDay: number;
  speedKmh: number;
  dated: boolean;
  weekdays: readonly number[];
  nodes: ReadonlyMap<string, EditorNode>;
  places: readonly EditorPlace[];
  centerPoint: Point | null;
  matrix: { index: ReadonlyMap<string, number>; minutes: readonly (readonly number[])[] };
}

const isActivePlace = (place: EditorPlace): boolean => place.status !== "skip" && place.preference !== "removed";

/** Names that depend on the language (the center's) are resolved at render, so the rest node has none. */
export function buildContext(data: EditorData): EditorContext {
  const cfg = data.config ?? {};
  const center = data.center ?? null;
  const service = cfg.serviceMinutes ?? {};
  const nodes = new Map<string, EditorNode>();
  const centerPoint = center ? { lat: center.lat, lng: center.lng } : null;
  nodes.set(REST_REF, {
    ref: REST_REF,
    kind: "rest",
    name: "",
    lat: centerPoint ? centerPoint.lat : null,
    lng: centerPoint ? centerPoint.lng : null,
    service: 0,
    category: null,
    sector: null,
    zone: null,
    matrixId: CENTER_REF,
  });
  const places = (data.places ?? []).filter(isActivePlace);
  for (const place of places) {
    const category = place.category || "other";
    nodes.set(place.id, {
      ref: place.id,
      kind: "place",
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      service: service[category] ?? service.other ?? DEFAULT_SERVICE,
      category,
      place,
      sector: place.sector || null,
      zone: place.zone || null,
      matrixId: place.id,
    });
  }
  for (const spot of data.nearby ?? []) {
    if (nodes.has(spot.id)) continue;
    nodes.set(spot.id, {
      ref: spot.id,
      kind: "nearby",
      name: spot.name,
      lat: spot.lat,
      lng: spot.lng,
      service: cfg.nearbyServiceMinutes ?? DEFAULT_NEARBY_SERVICE,
      category: null,
      spot,
      sector: null,
      zone: spot.zone || spot.zone_id || null,
      matrixId: spot.id,
    });
  }
  const travel = data.travel ?? { ids: [], minutes: [] };
  const index = new Map((travel.ids ?? []).map((id, i) => [id, i]));
  const weekdays = Array.isArray(data.tripWeekdays) ? data.tripWeekdays : [];
  return {
    cfg,
    dayStart: toMinutes(cfg.dayStart || "04:00"),
    dayEnd: toMinutes(cfg.dayEnd || "22:00"),
    rhythm: cfg.rhythm ?? [],
    restMinutes: cfg.restMinutes ?? DEFAULT_REST_MIN,
    tripDays: cfg.tripDays ?? (weekdays.length || MAX_DAYS),
    maxPlacesPerDay: cfg.maxPlacesPerDay ?? null,
    maxNearbyPerDay: cfg.maxNearbyPerDay ?? DEFAULT_MAX_NEARBY,
    speedKmh: cfg.speedKmh || EST_SPEED_KMH,
    dated: Boolean(cfg.dated || (data.tripDates ?? []).some(Boolean)),
    weekdays,
    nodes,
    places,
    centerPoint,
    matrix: { index, minutes: travel.minutes ?? [] },
  };
}

export function weekdayOf(ctx: EditorContext, dayIndex: number): number {
  const days = ctx.weekdays;
  const first = days[0];
  if (dayIndex < days.length) return days[dayIndex] ?? DEFAULT_WEEKDAY;
  if (first === undefined) return DEFAULT_WEEKDAY;
  const consecutive = days.length > 1 && days[1] === (first + 1) % 7;
  return ctx.dated || consecutive ? (first + dayIndex) % 7 : (days[days.length - 1] ?? DEFAULT_WEEKDAY);
}

function pointOf(ctx: EditorContext, id: string): Point | null {
  if (id === CENTER_REF) return ctx.centerPoint;
  const node = ctx.nodes.get(id);
  return node && node.lat != null && node.lng != null ? { lat: node.lat, lng: node.lng } : null;
}

/** The matrix when it has the pair, else the haversine estimate. */
export function travelBetween(ctx: EditorContext, a: string, b: string): Leg {
  const { index, minutes } = ctx.matrix;
  const ia = index.get(a);
  const ib = index.get(b);
  if (ia !== undefined && ib !== undefined) {
    const value = minutes[ia]?.[ib];
    if (typeof value === "number") return { min: value, estimated: false };
  }
  if (a === b) return { min: 0, estimated: false };
  const pa = pointOf(ctx, a);
  const pb = pointOf(ctx, b);
  if (!pa || !pb) return { min: 0, estimated: true };
  return { min: estimateMinutes(pa, pb, ctx.speedKmh), estimated: true };
}

export function slotById(ctx: EditorContext, id: string | null | undefined): RhythmSlot | null {
  return id ? (ctx.rhythm.find((s) => s.id === id) ?? null) : null;
}

export function slotIndex(ctx: EditorContext, id: string | null | undefined): number | null {
  const i = id ? ctx.rhythm.findIndex((s) => s.id === id) : -1;
  return i < 0 ? null : i;
}

export function restSlot(ctx: EditorContext): RhythmSlot | null {
  return ctx.rhythm.find((s) => s.id === REST_REF) ?? ctx.rhythm.find((s) => !(s.categories ?? []).length) ?? null;
}
