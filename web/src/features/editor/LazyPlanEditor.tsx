import { lazy } from "react";

/** The editor chunk loads only when the user opens it; wrap in <Suspense>. */
export const LazyPlanEditor = lazy(() => import("./PlanEditor"));

export const preloadPlanEditor = (): void => void import("./PlanEditor");
