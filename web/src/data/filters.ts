import { fold } from "../lib/format";
import type { Filters, Tab } from "../state/store";
import type { TripModel } from "./model";
import type { MapPlace, TripPlan } from "./types";

const WORDS = /\s+/;

/** Whether a place passes the Places tab filters (search words, day, direction, priority, category, tag). */
function matchesFilters(model: TripModel, plan: TripPlan, place: MapPlace, filters: Filters): boolean {
  const { q, day } = filters;
  if (q) {
    const text = model.searchText.get(place.id) ?? "";
    if (!fold(q).split(WORDS).every((word) => text.includes(word))) return false;
  }
  const planned = plan.placeSlots.get(place.id)?.day;
  if (day === "none" && planned != null) return false;
  if (day !== "all" && day !== "none" && String(planned) !== day) return false;
  if (filters.sectors.size && !filters.sectors.has(place.sector)) return false;
  if (filters.priorities.size && !filters.priorities.has(place.priority ?? "none")) return false;
  if (filters.categories.size && !filters.categories.has(place.category)) return false;
  if (filters.tags.size && !place.tags.some((tag) => filters.tags.has(tag))) return false;
  return true;
}

/** Direction, priority, category and tag selections (the count on the "Filters" disclosure). */
export function advancedFilterCount(filters: Filters): number {
  return filters.sectors.size + filters.priorities.size + filters.categories.size + filters.tags.size;
}

export function filtersActive(filters: Filters): boolean {
  return Boolean(filters.q || filters.day !== "all" || advancedFilterCount(filters));
}

export interface VisibilityInput {
  tab: Tab;
  filters: Filters;
  hidden: ReadonlySet<string>;
  showHidden: boolean;
}

/** Whether the map draws a place: not hidden (unless shown) and, on the Places tab, matching its filters. */
export function placeDrawn(model: TripModel, plan: TripPlan, input: VisibilityInput, place: MapPlace): boolean {
  if (input.hidden.has(place.id) && !input.showHidden) return false;
  return input.tab !== "places" || matchesFilters(model, plan, place, input.filters);
}

/** Ids of the places the map draws (see placeDrawn). */
export function visiblePlaceIds(model: TripModel, plan: TripPlan, input: VisibilityInput): Set<string> {
  return new Set(model.places.flatMap((place) => (placeDrawn(model, plan, input, place) ? [place.id] : [])));
}

/** The Places tab list: the pool (hidden ones only when shown) filtered, in model order. */
export function listedPlaces(model: TripModel, plan: TripPlan, input: Omit<VisibilityInput, "tab">): MapPlace[] {
  return model.places.filter(
    (place) => (input.showHidden || !input.hidden.has(place.id)) && matchesFilters(model, plan, place, input.filters),
  );
}
