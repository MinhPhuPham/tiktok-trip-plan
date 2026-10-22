import { use, useMemo } from "react";
import { selectPlan, useTripStore, useShallow } from "../state/hooks";
import type { TripState } from "../state/store";
import { TripModelContext } from "./context";
import { intentCounts, listedPlaces, shownOrder } from "./filters";
import type { IntentId } from "./intents";
import type { TripModel } from "./model";
import { normalizePlan } from "./plan";
import type { MapPlace, Plan, TripPlan } from "./types";

export function useTripModel(): TripModel {
  const model = use(TripModelContext);
  if (!model) throw new Error("useTripModel needs <TripModelContext>");
  return model;
}

const plans = new WeakMap<TripModel, WeakMap<Plan, TripPlan>>();

/** normalizePlan, computed once per plan object (shared by every component and Leaflet hook). */
export function getTripPlan(model: TripModel, plan: Plan): TripPlan {
  let byPlan = plans.get(model);
  if (!byPlan) plans.set(model, (byPlan = new WeakMap<Plan, TripPlan>()));
  let normalized = byPlan.get(plan);
  if (!normalized) byPlan.set(plan, (normalized = normalizePlan(model, plan)));
  return normalized;
}

/** The plan as drawn: export or editor days, numbered, with each place's day. */
export function useTripPlan(): TripPlan {
  const model = useTripModel();
  const plan = useTripStore(selectPlan);
  return getTripPlan(model, plan);
}

const useListInput = () =>
  useTripStore(useShallow((s) => ({ filters: s.filters, hidden: s.hidden, showHidden: s.showHidden })));

/** The Places tab rows. */
export function useListedPlaces(): MapPlace[] {
  const model = useTripModel();
  const plan = useTripPlan();
  const input = useListInput();
  return useMemo(() => listedPlaces(model, plan, input), [model, plan, input]);
}

const selectRanked = (s: TripState) => s.filters.intents.size > 0;

/** Whether the Places list is ranked by "Good for" relevance (one list) rather than must-go first. */
export const useRanked = () => useTripStore(selectRanked);

/** The Places tab rows in the order the list shows them. */
export function useShownPlaces(): readonly MapPlace[] {
  const places = useListedPlaces();
  const ranked = useRanked();
  return useMemo(() => shownOrder(places, ranked), [places, ranked]);
}

/** How many places each "Good for" intent would list with the other filters as they are. */
export function useIntentCounts(): Map<IntentId, number> {
  const model = useTripModel();
  const plan = useTripPlan();
  const input = useListInput();
  return useMemo(() => intentCounts(model, plan, input), [model, plan, input]);
}
