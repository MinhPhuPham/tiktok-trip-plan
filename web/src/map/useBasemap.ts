import { useCallback, useEffect, useRef, useState } from "react";
import { DOM_IDS } from "../app/ids";
import { useTripModel } from "../data/hooks";
import { getTranslator } from "../i18n/useT";
import { useTripStoreApi } from "../state/hooks";
import { basemapIds, resolveBasemap } from "./basemapChoice";
import { createBasemapController, type BasemapController, type RasterNow } from "./basemapController";
import { watch, type MapHandle } from "./mapCore";

export interface BasemapState {
  /** The popover's choices (Google drops out once it has failed). */
  ids: string[];
  /** A basemap still loading (Google), shown as checked before it is drawn. */
  pending: string | null;
  /** Pick a basemap; picking the stored choice again retries it after a fallback. */
  choose: (id: string) => void;
  raster: () => RasterNow | null;
}

/** The basemap drawn under the overlays, following the store's choice; reports `activeBasemap`. */
export function useBasemap(handle: MapHandle | null): BasemapState {
  const model = useTripModel();
  const store = useTripStoreApi();
  const [pending, setPending] = useState<string | null>(null);
  const [googleFailed, setGoogleFailed] = useState(false);
  const controller = useRef<BasemapController | null>(null);

  useEffect(() => {
    if (!handle) return undefined;
    const { data } = model;
    const { actions } = store.getState();
    const t = () => getTranslator(model, store.getState().lang);
    const ctl = createBasemapController(handle.map, data, () => document.getElementById(DOM_IDS.googleMap), {
      active: actions.setActiveBasemap,
      pending: setPending,
      googleFailed: () => setGoogleFailed(true),
      status: (key) => actions.setStatus(key ? t().t(key) : null),
      toast: (key, vars) => {
        const names = Object.fromEntries(Object.entries(vars ?? {}).map(([k, v]) => [k, t().t(v)]));
        actions.showToast(t().t(key, names));
      },
    });
    controller.current = ctl;
    const stop = watch(
      store,
      (s) => s.basemap,
      (chosen) => ctl.show(resolveBasemap(data, chosen, ctl.googleFailed())),
    );
    const onOnline = () => ctl.redraw();
    window.addEventListener("online", onOnline);
    return () => {
      stop();
      window.removeEventListener("online", onOnline);
      ctl.destroy();
      controller.current = null;
      actions.setStatus(null);
    };
  }, [handle, model, store]);

  const choose = useCallback(
    (id: string) => {
      const { basemap, activeBasemap, actions } = store.getState();
      if (basemap === id && activeBasemap !== id) controller.current?.show(id);
      else actions.setBasemap(id);
    },
    [store],
  );
  const raster = useCallback(() => controller.current?.raster() ?? null, []);

  return { ids: basemapIds(model.data, googleFailed), pending, choose, raster };
}
