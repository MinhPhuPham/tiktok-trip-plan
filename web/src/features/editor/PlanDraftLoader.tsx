import { useEffect } from "react";
import { useTripModel } from "../../data/hooks";
import { useTripStoreApi } from "../../state/hooks";
import { tripStorageId } from "../../state/persist";
import { draftBasis, hasCurrentDraft } from "./session/draftStorage";

/**
 * Mount once in the app shell: when this browser saved plan edits made from this generated plan,
 * it loads the editor session (lazy chunk), which applies the draft with setPlan. A missing or
 * stale draft loads nothing; the editor offers a stale one when it opens.
 */
export function PlanDraftLoader() {
  const model = useTripModel();
  const store = useTripStoreApi();
  useEffect(() => {
    if (!hasCurrentDraft(tripStorageId(model.data), draftBasis(model.data))) return;
    void import("./session/session").then(({ getEditorSession }) => getEditorSession(model, store));
  }, [model, store]);
  return null;
}
