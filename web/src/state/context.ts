import { createContext } from "react";
import type { TripStoreApi } from "./store";

export const TripStoreContext = createContext<TripStoreApi | null>(null);
