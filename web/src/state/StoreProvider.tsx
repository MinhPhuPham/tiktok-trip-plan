import { useEffect, useState, type ReactNode } from "react";
import { TripStoreContext } from "./context";
import { tripStorageId } from "./persist";
import { browserPersistence, createTripStore, type TripStoreInit } from "./store";

interface StoreProviderProps {
  init: TripStoreInit;
  children: ReactNode;
}

/**
 * Creates the store once from the loaded trip; later `init` changes are ignored. Hidden places
 * follow other tabs of the same trip.
 */
export function StoreProvider({ init, children }: StoreProviderProps) {
  const [store] = useState(() => createTripStore(init));
  const persistence = init.persistence === undefined ? browserPersistence : init.persistence;
  const storageId = tripStorageId(init);

  useEffect(
    () => persistence?.watchTrip?.(storageId, (trip) => store.getState().actions.replaceHidden(trip.hidden)),
    [persistence, storageId, store],
  );

  return <TripStoreContext value={store}>{children}</TripStoreContext>;
}
