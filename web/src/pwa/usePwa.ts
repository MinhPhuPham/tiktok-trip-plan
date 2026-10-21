import { useEffect } from "react";
import { useTripModel } from "../data/hooks";
import { getTranslator } from "../i18n/useT";
import { useTripStoreApi } from "../state/hooks";
import { onAppInstalled } from "./install";

let registered = false;

/**
 * Registers the service worker once per page load (app build only; the import keeps Workbox out
 * of the single file). A waiting update shows "A new version is ready · Reload"; an install, "Installed".
 */
export function usePwa(): void {
  const store = useTripStoreApi();
  const model = useTripModel();
  useEffect(() => {
    if (!__PWA__ || registered) return;
    registered = true;
    const onUpdateReady = (apply: () => void) => {
      const { lang, actions } = store.getState();
      const t = getTranslator(model, lang);
      actions.showToast(t.t("update_ready"), { action: { label: t.t("reload"), run: apply }, durationMs: 60_000 });
    };
    void import("./serviceWorker").then(({ registerServiceWorker }) => registerServiceWorker({ onUpdateReady }));
  }, [store, model]);

  useEffect(() => {
    if (!__PWA__) return undefined;
    return onAppInstalled(() => {
      const { lang, actions } = store.getState();
      actions.showToast(getTranslator(model, lang).t("installed_toast"));
    });
  }, [store, model]);
}
