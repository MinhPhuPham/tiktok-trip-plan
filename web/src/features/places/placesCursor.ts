import type { MapPlace, TripPlan } from "../../data/types";
import type { Translator } from "../../i18n/translator";
import { km } from "../../lib/format";
import type { Step } from "../../lib/swipe";
import type { Filters } from "../../state/store";

/** Where the peek arrows moved to in one shown list; any other list (filters, search, hide) starts over at its first place. */
export interface PlacesBrowse {
  list: readonly MapPlace[];
  index: number;
  step: Step;
}

export interface PlacesPeekView {
  place: MapPlace;
  index: number;
  /** The arrows (or a swipe) moved the cursor, even when it came back to the first place. */
  browsing: boolean;
  step: Step | null;
}

/** The place the peek row shows: the browsed one, else the list's first; null for an empty list. */
export function placesPeekView(list: readonly MapPlace[], browse: PlacesBrowse | null): PlacesPeekView | null {
  const active = browse && browse.list === list ? browse : null;
  const index = active ? Math.min(Math.max(active.index, 0), list.length - 1) : 0;
  const place = list[index];
  if (!place) return null;
  return { place, index, browsing: active != null, step: active?.step ?? null };
}

/** The place one step away, or null past either end (no wrap). */
export const placeNeighbour = (list: readonly MapPlace[], view: PlacesPeekView, step: Step): MapPlace | null =>
  list[view.index + step] ?? null;

export function stepPlaces(list: readonly MapPlace[], view: PlacesPeekView, step: Step): PlacesBrowse | null {
  return placeNeighbour(list, view, step) ? { list, index: view.index + step, step } : null;
}

export interface FilterScope {
  /** One chosen filter, with "+N" for the others: “bánh căn” +1. "All" when none is chosen. */
  short: string;
  /** Every chosen filter: “bánh căn” · Breakfast · Day 2. */
  full: string;
}

/** The chosen search and filters in words, in the order of the filter grid. */
export function filterScope(t: Translator, filters: Filters): FilterScope {
  const parts: string[] = [];
  if (filters.q) parts.push(`“${filters.q}”`);
  if (filters.day === "none") parts.push(t.t("not_planned"));
  else if (filters.day !== "all") parts.push(t.dayName(Number(filters.day)));
  for (const id of filters.intents) parts.push(t.t(`intent_${id}`));
  for (const level of filters.priorities) parts.push(level === "none" ? t.t("unrated") : t.priority(level));
  for (const category of filters.categories) parts.push(t.category(category));
  const [first] = parts;
  if (first == null) return { short: t.t("all"), full: t.t("all") };
  return { short: parts.length > 1 ? `${first} +${parts.length - 1}` : first, full: parts.join(" · ") };
}

export const placeCount = (t: Translator, n: number): string => t.t(n === 1 ? "place_1" : "place_count", { n });

/** "Day 2 · #3 · 1.2 km · Cafe": where the plan has it, how far, what it is (the pin colour says it too, so it goes first when space runs out). */
export function placePeekMeta(t: Translator, plan: TripPlan, place: MapPlace): string {
  const slot = plan.placeSlots.get(place.id);
  const planned = slot ? (slot.stop != null ? t.t("day_stop", { day: t.dayName(slot.day), n: slot.stop }) : t.dayName(slot.day)) : "";
  return [planned, km(place.distance_km), t.category(place.category)].filter(Boolean).join(" · ");
}
