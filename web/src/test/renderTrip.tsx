import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { TripModelContext } from "../data/context";
import { buildTripModel } from "../data/model";
import { planFromData, type TripData } from "../data/types";
import { TripStoreContext } from "../state/context";
import { createTripStore } from "../state/store";
import { makeTrip } from "./fixtures";

interface RenderTripOptions {
  data?: TripData;
  lang?: string;
  phone?: boolean;
}

/** Test helper: renders `ui` with a trip model and a store that persists nothing. */
export function renderTrip(ui: ReactNode, { data = makeTrip(), lang = "en", phone = false }: RenderTripOptions = {}) {
  const model = buildTripModel(data);
  const store = createTripStore({
    city: data.city,
    langs: model.langs,
    defaultLang: lang,
    plan: planFromData(data),
    phone,
    persistence: null,
  });
  const result = render(
    <TripModelContext value={model}>
      <TripStoreContext value={store}>{ui}</TripStoreContext>
    </TripModelContext>,
  );
  return { ...result, model, store };
}
