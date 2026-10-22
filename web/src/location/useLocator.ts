import { useEffect, useState } from "react";
import { useTripModel } from "../data/hooks";
import { getTranslator } from "../i18n/useT";
import { useTripStoreApi } from "../state/hooks";
import { locateBrowser } from "./browser";
import { browserGeoEnv, startLocator, type GeoUnavailable } from "./locator";

/**
 * Runs the geolocation controller for the page. Returns why location cannot work here (http page,
 * no API), or null when it can. A tap that timed out shows a toast with Try again; no position at
 * all opens the locate help instead (LocateControl).
 */
export function useLocator(): GeoUnavailable | null {
  const model = useTripModel();
  const store = useTripStoreApi();
  const [env] = useState(browserGeoEnv);
  useEffect(
    () =>
      startLocator(store, env, (problem) => {
        if (problem !== "timeout") return;
        const { lang, actions } = store.getState();
        const t = getTranslator(model, lang);
        const message = t.t(locateBrowser().inApp ? "locate_failed_in_app" : "locate_failed");
        actions.showToast(message, { action: { label: t.t("retry"), run: () => actions.locate({ type: "retry" }) } });
      }),
    [env, model, store],
  );
  return env.unavailable;
}
