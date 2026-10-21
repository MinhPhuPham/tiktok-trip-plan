import { use, useMemo } from "react";
import { selectPlan, useTripStore, useShallow } from "../state/hooks";
import { TripModelContext } from "./context";
import { listedPlaces } from "./filters";
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

/** The Places tab rows. */
export function useListedPlaces(): MapPlace[] {
  const model = useTripModel();
  const plan = useTripPlan();
  const input = useTripStore(useShallow((s) => ({ filters: s.filters, hidden: s.hidden, showHidden: s.showHidden })));
  return useMemo(() => listedPlaces(model, plan, input), [model, plan, input]);
}
