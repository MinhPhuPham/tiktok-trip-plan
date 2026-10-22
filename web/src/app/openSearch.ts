import { flushSync } from "react-dom";
import type { TripStoreApi } from "../state/store";
import { DOM_IDS, focusById } from "./ids";

/**
 * Shows the Places tab (the phone sheet at full height) and focuses its search. The render is
 * flushed so the box is no longer inert when it takes focus inside the same tap: iOS raises the
 * keyboard only for a focus made during the user's gesture.
 */
export function openPlaceSearch(store: TripStoreApi): void {
  const { phone, actions } = store.getState();
  flushSync(() => {
    actions.setTab("places");
    if (phone) actions.setSheet("full");
  });
  focusById(DOM_IDS.search);
}
