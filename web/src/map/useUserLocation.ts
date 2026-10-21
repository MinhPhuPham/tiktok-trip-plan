import { useEffect } from "react";
import { useTripStoreApi } from "../state/hooks";
import type { MapHandle } from "./mapCore";
import { startUserLayer } from "./userLayer";

/** The blue dot and the follow camera (map/userLayer.ts). */
export function useUserLocation(handle: MapHandle | null): void {
  const store = useTripStoreApi();
  useEffect(() => (handle ? startUserLayer(handle.map, store) : undefined), [handle, store]);
}
