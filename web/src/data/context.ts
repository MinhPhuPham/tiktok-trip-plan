import { createContext } from "react";
import type { TripModel } from "./model";

export const TripModelContext = createContext<TripModel | null>(null);
