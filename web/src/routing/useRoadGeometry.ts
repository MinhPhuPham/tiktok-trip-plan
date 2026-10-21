import { useEffect, useSyncExternalStore } from "react";
import { getTripPlan, useTripModel } from "../data/hooks";
import type { TripModel } from "../data/model";
import type { TripData } from "../data/types";
import { watch } from "../map/mapCore";
import { useTripStoreApi } from "../state/hooks";
import { indexedDbLegStore, type LegStore } from "./legCache";
import { routeBase } from "./osrm";
import { createRoadRouter, type RoadRouter, type RoadStatus } from "./router";

/** Exports older than live routing lack these fields. */
type RoutingFields = Partial<Pick<TripData, "roads_enabled" | "roads_endpoint" | "roads_profile">>;

/** The OSRM base URL the export allows, or null for no live routing. */
export function routingBase({ roads_enabled: enabled = false, roads_endpoint: endpoint = "", roads_profile: profile = "" }: RoutingFields): string | null {
  const base = enabled ? routeBase(endpoint, profile) : "";
  return /^https?:\/\//.test(base) ? base : null;
}

let legStore: LegStore | null = null;
const routers = new WeakMap<TripModel, RoadRouter>();

/** One router per loaded trip, so the map and the status pill share its cache and status. */
export function getRoadRouter(model: TripModel): RoadRouter {
  let router = routers.get(model);
  if (!router) {
    router = createRoadRouter({ base: routingBase(model.data), exported: model.data.roads, store: (legStore ??= indexedDbLegStore()) });
    routers.set(model, router);
  }
  return router;
}

/**
 * Road geometry for the plan as shown, edits included. Follows the store's plan and connectivity
 * without re-rendering; the map redraws through router.subscribe, the status pill uses useRoadStatus.
 */
export function useRoadGeometry(): RoadRouter {
  const model = useTripModel();
  const store = useTripStoreApi();
  const router = getRoadRouter(model);

  useEffect(() => {
    const stopOnline = watch(store, (s) => s.online, (online) => router.setOnline(online));
    const stopPlan = watch(
      store,
      (s) => s.plan,
      (plan) => router.request(getTripPlan(model, plan).days.map((day) => day.stops)),
    );
    return () => {
      stopOnline();
      stopPlan();
    };
  }, [model, store, router]);

  return router;
}

export function useRoadStatus(): RoadStatus {
  const router = getRoadRouter(useTripModel());
  return useSyncExternalStore(router.subscribeStatus, router.getStatus);
}
