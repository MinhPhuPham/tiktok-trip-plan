import { useEffect } from "react";
import { useTripStoreApi } from "../state/hooks";
import type { MapHandle } from "./mapCore";

/** Long enough to tell a single click from the first click of a double-click zoom. */
export const DISMISS_DELAY_MS = 250;

/**
 * A click on empty map closes the open card and leaves focus on the map. Pins, clusters, routes
 * and spots do not bubble their clicks to the map; drags fire no click; a double-click zooms
 * without closing.
 */
export function useCardDismiss(handle: MapHandle | null): void {
  const store = useTripStoreApi();

  useEffect(() => {
    if (!handle) return undefined;
    const { map } = handle;
    let timer = 0;
    const cancel = () => window.clearTimeout(timer);
    const onClick = () => {
      const clicked = store.getState().selected;
      cancel();
      if (!clicked) return;
      timer = window.setTimeout(() => {
        const { selected, actions } = store.getState();
        if (selected !== clicked) return;
        map.getContainer().focus({ preventScroll: true });
        actions.closeCard();
      }, DISMISS_DELAY_MS);
    };
    map.on("click", onClick);
    map.on("dblclick zoomstart", cancel);
    return () => {
      cancel();
      map.off("click", onClick);
      map.off("dblclick zoomstart", cancel);
    };
  }, [handle, store]);
}
