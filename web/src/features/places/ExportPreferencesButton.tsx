import { useTripModel } from "../../data/hooks";
import { useT } from "../../i18n/useT";
import { downloadText } from "../../lib/download";
import { useTripActions, useTripStoreApi } from "../../state/hooks";
import { Button } from "../../ui/Button";
import { preferencesYaml } from "./preferences";

/** Downloads preferences.yaml with the hidden places under `removed`. */
export function ExportPreferencesButton() {
  const t = useT();
  const model = useTripModel();
  const store = useTripStoreApi();
  const { showToast } = useTripActions();
  const exportPreferences = () => {
    const { yaml, removed } = preferencesYaml(model, store.getState().hidden);
    downloadText("preferences.yaml", yaml, "text/yaml;charset=utf-8");
    showToast(t.t("prefs_saved", { n: removed }));
  };
  return (
    <Button icon="download" onClick={exportPreferences}>
      {t.t("export_prefs")}
    </Button>
  );
}
