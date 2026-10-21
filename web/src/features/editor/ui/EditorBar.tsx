import { notesText, type IssueCounts } from "../logic/issues";
import { PeIcon } from "./PeIcon";
import { useEditorText, useSessionActions, useSessionState } from "./sessionContext";

interface EditorBarProps {
  dirty: boolean;
  counts: IssueCounts;
  whySaved: string;
  onJump: () => void;
}

/** Sticky header: title, Save, Done; the save status and the check summary under it. */
export function EditorBar({ dirty, counts, whySaved, onJump }: EditorBarProps) {
  const { t } = useEditorText();
  const actions = useSessionActions();
  const saveError = useSessionState((s) => s.saveError);
  const showNotes = useSessionState((s) => s.showNotes);
  const { errors, warnings } = counts;
  return (
    <header className="pe-bar">
      <div className="pe-bar-row">
        <h2 className="pe-title">{t("edit_plan")}</h2>
        <button
          type="button"
          className="pe-btn"
          data-fk="save"
          aria-disabled={dirty ? undefined : true}
          aria-describedby={dirty ? undefined : whySaved}
          onClick={() => {
            if (dirty) actions.save();
          }}
        >
          {t("save")}
        </button>
        <button type="button" className="pe-btn primary" data-fk="done" onClick={actions.close}>
          {t("done")}
        </button>
      </div>
      <div className="pe-bar-row pe-sub">
        {saveError ? (
          <span className="pe-status is-error">{t("save_failed")}</span>
        ) : (
          <span className={dirty ? "pe-status is-dirty" : "pe-status"}>{dirty ? t("unsaved") : t("saved")}</span>
        )}
        <div className="pe-summary">
          {errors ? (
            <button type="button" className="pe-checks is-error" data-fk="jump" onClick={onJump}>
              <PeIcon name="error" />
              {t("to_fix", { n: errors })}
            </button>
          ) : (
            <span className="pe-checks is-ok">
              <PeIcon name="check" />
              {t(warnings ? "no_errors" : "all_good")}
            </span>
          )}
          {warnings ? (
            <button
              type="button"
              className="pe-checks is-notes"
              data-fk="notes"
              aria-expanded={showNotes}
              onClick={actions.toggleNotes}
            >
              <PeIcon name="warn" />
              {notesText(t, warnings)}
              <PeIcon name="down" className="pe-chev" />
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
