import { fold } from "../lib/format";
import type { Filters, Tab } from "../state/store";
import { countIntents, fitsAnyIntent, intentIndex, rankByIntents, type IntentId } from "./intents";
import type { TripModel } from "./model";
import type { MapPlace, TripPlan } from "./types";

const WORDS = /\s+/;

/** Search words, day, priority and category: every filter but the intents. */
function matchesChoices(model: TripModel, plan: TripPlan, place: MapPlace, filters: Filters): boolean {
  const { q, day } = filters;
  if (q) {
    const text = model.searchText.get(place.id) ?? "";
    if (!fold(q).split(WORDS).every((word) => text.includes(word))) return false;
  }
  const planned = plan.placeSlots.get(place.id)?.day;
  if (day === "none" && planned != null) return false;
  if (day !== "all" && day !== "none" && String(planned) !== day) return false;
  if (filters.priorities.size && !filters.priorities.has(place.priority ?? "none")) return false;
  if (filters.categories.size && !filters.categories.has(place.category)) return false;
  return true;
}

/** Whether a place passes the Places tab filters; the intents match when any of them fits. */
function matchesFilters(model: TripModel, plan: TripPlan, place: MapPlace, filters: Filters): boolean {
  if (!matchesChoices(model, plan, place, filters)) return false;
  return !filters.intents.size || fitsAnyIntent(intentIndex(model), filters.intents, place.id);
}

export function filtersActive(filters: Filters): boolean {
  return Boolean(
    filters.q || filters.day !== "all" || filters.priorities.size || filters.categories.size || filters.intents.size,
  );
}

export interface VisibilityInput {
  tab: Tab;
  filters: Filters;
  hidden: ReadonlySet<string>;
  showHidden: boolean;
}

type ListInput = Omit<VisibilityInput, "tab">;

/** Whether the map draws a place: not hidden (unless shown) and, on the Places tab, matching its filters. */
export function placeDrawn(model: TripModel, plan: TripPlan, input: VisibilityInput, place: MapPlace): boolean {
  if (input.hidden.has(place.id) && !input.showHidden) return false;
  return input.tab !== "places" || matchesFilters(model, plan, place, input.filters);
}

/** Ids of the places the map draws (see placeDrawn). */
export function visiblePlaceIds(model: TripModel, plan: TripPlan, input: VisibilityInput): Set<string> {
  return new Set(model.places.flatMap((place) => (placeDrawn(model, plan, input, place) ? [place.id] : [])));
}

const inPool = (input: ListInput, place: MapPlace): boolean => input.showHidden || !input.hidden.has(place.id);

/**
 * The Places tab list: the pool (hidden ones only when shown) filtered, in model order, or by
 * relevance while intents are chosen (data/intents.ts rankByIntents).
 */
export function listedPlaces(model: TripModel, plan: TripPlan, input: ListInput): MapPlace[] {
  const listed = model.places.filter((place) => inPool(input, place) && matchesFilters(model, plan, place, input.filters));
  const { intents } = input.filters;
  return intents.size ? rankByIntents(listed, intents, intentIndex(model), plan) : listed;
}

/** Must-go places and the rest, each in the given order. */
export function splitMustGo(places: readonly MapPlace[]): { must: MapPlace[]; rest: MapPlace[] } {
  const must = places.filter((p) => p.priority === "must");
  return { must, rest: must.length ? places.filter((p) => p.priority !== "must") : [...places] };
}

/** The Places list in the order it shows: must-go first, unless ranked by the chosen intents. */
export function shownOrder(places: readonly MapPlace[], ranked: boolean): readonly MapPlace[] {
  if (ranked) return places;
  const { must, rest } = splitMustGo(places);
  return must.length ? [...must, ...rest] : places;
}

/** Places per available intent among the pool the other filters leave, so no offered intent lists nothing. */
export function intentCounts(model: TripModel, plan: TripPlan, input: ListInput): Map<IntentId, number> {
  const pool = model.places.filter((place) => inPool(input, place) && matchesChoices(model, plan, place, input.filters));
  return countIntents(intentIndex(model), pool);
}
