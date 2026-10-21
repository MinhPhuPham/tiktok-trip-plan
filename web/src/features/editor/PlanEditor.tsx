import { useTripModel } from "../../data/hooks";
import { useTripStoreApi } from "../../state/hooks";
import "./editor.css";
import { getEditorSession } from "./session/session";
import { EditorPanel } from "./ui/EditorPanel";
import { EditorSessionContext } from "./ui/sessionContext";

/**
 * The plan editor (lazy chunk, mounted by the Plan tab while `editing`). Every edit recomputes the
 * clock and publishes the plan with actions.setPlan, so the map and the Plan tab follow live;
 * Done closes it with setEditing(false). The draft outlives the panel (one session per trip).
 */
export default function PlanEditor() {
  const session = getEditorSession(useTripModel(), useTripStoreApi());
  return (
    <EditorSessionContext value={session}>
      <div id="plan-editor">
        <EditorPanel />
      </div>
    </EditorSessionContext>
  );
}
