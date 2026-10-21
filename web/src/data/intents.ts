import { toMin } from "../lib/format";
import type { TripModel } from "./model";
import { priorityRank } from "./priority";
import type { MapPlace, OpeningPeriod, TripPlan } from "./types";

/** Traveller intents of the Places tab ("Good for"), in trip-day order: meals, then the day's moments, then the rest. */
export const INTENT_IDS = [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "late_night",
  "cafe",
  "sunrise",
  "clouds",
  "sunset",
  "night",
  "view",
  "photo",
  "nature",
  "family",
  "history",
  "shopping",
] as const;
export type IntentId = (typeof INTENT_IDS)[number];

/** Minutes after midnight, end exclusive. */
type Window = readonly [number, number];

interface Intent {
  id: IntentId;
  matches: (place: MapPlace) => boolean;
  /** The plan's rhythm slot for it: places planned in that slot rank first. */
  slot?: string;
  /** Hours it is about: a best time (else opening hours) inside them ranks a place higher. */
  window?: Window;
  /** Tags that rank a match higher without being required. */
  boost?: readonly string[];
  /** Fewer qualifying places hide the intent. */
  min?: number;
}

const DAY_MIN = 1440;
const h = (hours: number, minutes = 0) => hours * 60 + minutes;
/** A night venue is still open after this on some day. */
const NIGHT_OPEN_UNTIL = h(20, 30);
/** Spans this long are "open 24 hours": open-air spots without gates, which says nothing about night views. */
const ALL_DAY = h(23);

const tagged =
  (...tags: string[]) =>
  (place: MapPlace): boolean =>
    place.tags.some((tag) => tags.includes(tag));

/** Opening periods as [open, close] minute spans, a close at or before the open running past midnight. */
function openingSpans(periods: readonly OpeningPeriod[]): Window[] {
  return periods.flatMap((period) => {
    const open = toMin(period.open);
    if (open == null) return [];
    const close = period.close ? toMin(period.close) : null;
    if (close == null) return [[open, open + DAY_MIN] as const];
    return [[open, close > open ? close : close + DAY_MIN] as const];
  });
}

/** Open past 20:30 on at least one day, by real opening hours (24-hour listings do not count). */
export function openAtNight(periods: readonly OpeningPeriod[]): boolean {
  return openingSpans(periods).some(([open, close]) => close - open < ALL_DAY && close > NIGHT_OPEN_UNTIL);
}

const viewAtNight = (place: MapPlace): boolean =>
  (tagged("view", "photo_spot")(place) && openAtNight(place.hours.periods)) ||
  (tagged("late_night")(place) && tagged("view")(place));

export const INTENTS: readonly Intent[] = [
  { id: "breakfast", matches: tagged("breakfast"), slot: "breakfast", window: [h(6), h(9, 30)] },
  { id: "lunch", matches: tagged("lunch"), slot: "lunch", window: [h(11), h(13, 30)] },
  { id: "dinner", matches: tagged("dinner"), slot: "dinner", window: [h(17, 30), h(20, 30)] },
  { id: "snack", matches: tagged("snack", "dessert") },
  { id: "late_night", matches: tagged("late_night"), slot: "evening", window: [h(21), h(24)] },
  { id: "cafe", matches: (place) => place.category === "cafe", slot: "cafe", boost: ["garden", "view", "work_friendly"] },
  { id: "sunrise", matches: tagged("sunrise"), slot: "sunrise", window: [h(4, 30), h(7)] },
  { id: "clouds", matches: tagged("cloud_hunting"), slot: "sunrise", window: [h(4, 30), h(7, 30)] },
  { id: "sunset", matches: tagged("sunset"), window: [h(16, 30), h(18, 30)] },
  { id: "night", matches: viewAtNight, slot: "evening", window: [h(19, 30), h(23)], min: 2 },
  { id: "view", matches: tagged("view") },
  { id: "photo", matches: tagged("photo_spot") },
  { id: "nature", matches: tagged("nature", "garden") },
  { id: "family", matches: tagged("family") },
  { id: "history", matches: tagged("history") },
  { id: "shopping", matches: tagged("shopping") },
];

export interface IntentIndex {
  /** Intents with enough places, in INTENT_IDS order. */
  available: readonly IntentId[];
  /** Place ids per intent. */
  members: ReadonlyMap<IntentId, ReadonlySet<string>>;
}

const indexes = new WeakMap<TripModel, IntentIndex>();

/** Which places fit each intent, computed once per model. */
export function intentIndex(model: TripModel): IntentIndex {
  let index = indexes.get(model);
  if (!index) {
    const members = new Map(
      INTENTS.map((intent) => [intent.id, new Set(model.places.filter(intent.matches).map((p) => p.id))] as const),
    );
    const available = INTENTS.filter((intent) => (members.get(intent.id)?.size ?? 0) >= (intent.min ?? 1)).map((i) => i.id);
    indexes.set(model, (index = { available, members }));
  }
  return index;
}

/** Whether the place fits at least one of the intents (union). */
export function fitsAnyIntent(index: IntentIndex, intents: ReadonlySet<string>, placeId: string): boolean {
  for (const id of intents) if (index.members.get(id as IntentId)?.has(placeId)) return true;
  return false;
}

/** How many of `places` fit each available intent. */
export function countIntents(index: IntentIndex, places: readonly MapPlace[]): Map<IntentId, number> {
  return new Map(
    index.available.map((id) => {
      const members = index.members.get(id);
      return [id, members ? places.reduce((n, p) => (members.has(p.id) ? n + 1 : n), 0) : 0] as const;
    }),
  );
}

const RANGE = /(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/;

function bestTimeSpan(place: MapPlace): Window | null {
  const match = RANGE.exec(place.best_time?.hours ?? "");
  const from = toMin(match?.[1]);
  const to = toMin(match?.[2]);
  if (from == null || to == null) return null;
  return [from, to > from ? to : to + DAY_MIN];
}

const overlaps = ([a0, a1]: Window, [b0, b1]: Window): boolean =>
  (a0 < b1 && b0 < a1) || (a0 < b1 + DAY_MIN && b0 + DAY_MIN < a1);

/** The best time overlaps the window; without a best time, some opening span does. */
function inWindow(place: MapPlace, window: Window): boolean {
  const best = bestTimeSpan(place);
  if (best) return overlaps(best, window);
  return openingSpans(place.hours.periods).some((span) => overlaps(span, window));
}

/** Must, high, then the rest. */
const priorityTier = (priority: string | null): number => Math.min(priorityRank(priority), 2);

/**
 * The listed places ordered for the chosen intents: planned in one of their slots first, then must
 * and high priority, then a good time (or a boost tag) for them, then rating; ties keep `places` order.
 */
export function rankByIntents(
  places: readonly MapPlace[],
  intents: ReadonlySet<string>,
  index: IntentIndex,
  plan: TripPlan,
): MapPlace[] {
  const chosen = INTENTS.filter((intent) => intents.has(intent.id));
  const keyed = places.map((place, order) => {
    const fitting = chosen.filter((intent) => index.members.get(intent.id)?.has(place.id));
    const slot = plan.placeSlots.get(place.id)?.slot;
    const planned = slot != null && fitting.some((intent) => intent.slot === slot);
    const timely = fitting.some(
      (intent) =>
        (intent.window != null && inWindow(place, intent.window)) || intent.boost?.some((tag) => place.tags.includes(tag)),
    );
    return { place, order, key: [planned ? 0 : 1, priorityTier(place.priority), timely ? 0 : 1, -(place.rating ?? 0)] };
  });
  return keyed
    .toSorted((a, b) => {
      for (let i = 0; i < a.key.length; i++) {
        const diff = (a.key[i] ?? 0) - (b.key[i] ?? 0);
        if (diff) return diff;
      }
      return a.order - b.order;
    })
    .map((entry) => entry.place);
}
