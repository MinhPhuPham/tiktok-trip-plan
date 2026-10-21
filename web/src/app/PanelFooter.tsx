import { useTripModel } from "../data/hooks";
import { ExportPreferencesButton } from "../features/places/ExportPreferencesButton";
import { useT } from "../i18n/useT";
import { InstallButton } from "../pwa/InstallButton";

const RESOLVE_COMMAND = "uv run tiktok-trip run --from resolve";

export function PanelFooter() {
  const t = useT();
  const { data } = useTripModel();
  const [before, after = ""] = t.t("export_prefs_hint").split("{command}");
  return (
    <footer className="panel-foot">
      <ExportPreferencesButton />
      <InstallButton />
      <details className="about">
        <summary>{t.t("about")}</summary>
        <p className="foot-hint">
          {before}
          <code>{RESOLVE_COMMAND}</code>
          {after}
        </p>
        <p className="num">{t.t("generated", { date: t.loc(data.generated) })}</p>
      </details>
    </footer>
  );
}
