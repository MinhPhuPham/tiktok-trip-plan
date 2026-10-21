import { useState, type ReactNode } from "react";
import { TripModelContext } from "../data/context";
import { buildTripModel } from "../data/model";
import { todayTripDay } from "../data/stops";
import { planFromData, type TripData } from "../data/types";
import { defaultLang } from "../i18n/shellText";
import { StoreProvider } from "../state/StoreProvider";
import type { TripStoreInit } from "../state/store";
import { matches, PHONE_QUERY } from "./viewport";

interface TripProvidersProps {
  data: TripData;
  children: ReactNode;
}

/** The immutable trip model and the UI store, created once per loaded trip. */
export function TripProviders({ data, children }: TripProvidersProps) {
  const [model] = useState(() => buildTripModel(data));
  const [init] = useState<TripStoreInit>(() => ({
    city: data.city,
    isPlace: (id) => model.placeById.has(id),
    langs: model.langs,
    defaultLang: defaultLang(model.langs),
    plan: planFromData(data),
    openDay: todayTripDay(data),
    phone: matches(PHONE_QUERY),
    online: navigator.onLine,
  }));
  return (
    <TripModelContext value={model}>
      <StoreProvider init={init}>{children}</StoreProvider>
    </TripModelContext>
  );
}
