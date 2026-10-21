import { PeIcon } from "./PeIcon";
import { useEditorText, useSessionActions, useSessionState } from "./sessionContext";

interface EditorBarProps {
  /** Problems route --collect would reject; warnings are never counted. */
  errors: number;
  onJump: () => void;
}

/** Sticky header: title, a jump to the first problem while there are some, and Done. Edits save themselves. */
export function EditorBar({ errors, onJump }: EditorBarProps) {
  const { t } = useEditorText();
  const actions = useSessionActions();
  const saveError = useSessionState((s) => s.saveError);
  return (
    <header className="pe-bar">
      <div className="pe-bar-row">
        <h2 className="pe-title">{t("edit_plan")}</h2>
        {errors ? (
          <button type="button" className="pe-fix" data-fk="jump" onClick={onJump}>
            <PeIcon name="error" />
            <span className="num">{t("to_fix", { n: errors })}</span>
          </button>
        ) : null}
        <button type="button" className="pe-btn primary" data-fk="done" onClick={actions.close}>
          {t("done")}
        </button>
      </div>
      {saveError ? <p className="pe-save-error">{t("save_failed")}</p> : null}
    </header>
  );
}
