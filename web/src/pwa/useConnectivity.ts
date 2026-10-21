import { useEffect } from "react";
import { useTripModel } from "../data/hooks";
import { getTranslator } from "../i18n/useT";
import { useTripStoreApi } from "../state/hooks";

/** Mirrors navigator.onLine into the store and announces changes with a toast. */
export function useConnectivity(): void {
  const store = useTripStoreApi();
  const model = useTripModel();
  useEffect(() => {
    const announce = (online: boolean) => {
      const { lang, actions } = store.getState();
      actions.setOnline(online);
      actions.showToast(getTranslator(model, lang).t(online ? "online" : "offline"));
      if (online && __PWA__) void import("./serviceWorker").then(({ warmOfflineCache }) => warmOfflineCache());
    };
    const onOnline = () => announce(true);
    const onOffline = () => announce(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    store.getState().actions.setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [store, model]);
}
