import { useT } from "../i18n/useT";
import { Button } from "../ui/Button";
import { useInstallState } from "./install";

export function InstallButton() {
  const t = useT();
  const install = useInstallState();
  if (install.kind === "prompt") {
    return (
      <Button icon="download" onClick={() => void install.install()}>
        {t.t("install_app")}
      </Button>
    );
  }
  return install.kind === "ios-hint" ? <p className="foot-hint">{t.t("install_ios")}</p> : null;
}
