import { useEffect } from "react";
import { useTripStoreApi } from "../state/hooks";
import { PHONE_QUERY } from "./viewport";

/** Keeps `phone` in the store in step with the 760px breakpoint (the sheet collapses on change). */
export function useViewport(): void {
  const store = useTripStoreApi();
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const sync = () => {
      if (store.getState().phone !== query.matches) store.getState().actions.setPhone(query.matches);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [store]);
}
