import { useCallback } from "react";
import { useTripModel } from "../data/hooks";
import { useT } from "../i18n/useT";
import { useTripStoreApi } from "../state/hooks";

/** Hide or show a place in this browser, with an Undo toast. */
export function useToggleHidden(): (id: string) => void {
  const model = useTripModel();
  const t = useT();
  const store = useTripStoreApi();
  return useCallback(
    (id: string) => {
      const place = model.placeById.get(id);
      if (!place) return;
      const { actions } = store.getState();
      const hiding = actions.toggleHidden(id);
      actions.showToast(t.t(hiding ? "hidden_toast" : "restored_toast", { name: place.name }), {
        action: { label: t.t("undo"), run: () => actions.setHidden(id, !hiding) },
      });
    },
    [model, t, store],
  );
}
