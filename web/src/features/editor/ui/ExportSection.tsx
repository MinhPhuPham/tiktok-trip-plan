import { downloadText } from "../../../lib/download";
import { COLLECT_CMD } from "../logic/constants";
import { PeIcon } from "./PeIcon";
import { useEditorText, useSession, useSessionActions } from "./sessionContext";

/** plan.json for data/plan/plan.json, the command that adopts it, and the reset. */
export function ExportSection({ hasErrors }: { hasErrors: boolean }) {
  const session = useSession();
  const actions = useSessionActions();
  const { t } = useEditorText();
  return (
    <section className="pe-export">
      <button
        type="button"
        className="pe-btn primary-outline"
        data-fk="export"
        onClick={() => downloadText("plan.json", `${JSON.stringify(session.planJson(), null, 2)}\n`, "application/json")}
      >
        <PeIcon name="download" />
        {t("export_plan")}
      </button>
      {hasErrors ? <p className="pe-note is-error">{t("export_has_errors")}</p> : null}
      <p className="pe-note">{t("export_help")}</p>
      <pre className="pe-cmd">
        <code>{COLLECT_CMD}</code>
      </pre>
      <p className="pe-note">{t("export_after")}</p>
      <button type="button" className="pe-btn ghost" data-fk="reset" onClick={actions.reset}>
        <PeIcon name="undo" />
        {t("reset_plan")}
      </button>
    </section>
  );
}
