import { useT } from "../i18n/useT";
import { Button } from "../ui/Button";
import { useInstallState } from "./install";
import { InstallSteps } from "./InstallSteps";

/** The panel footer's install entry: the browser's prompt, else this browser's steps behind "Install app". */
export function InstallButton() {
  const t = useT();
  const install = useInstallState();
  if (install.kind === "unavailable") return null;
  if (install.kind === "prompt") {
    return (
      <Button icon="download" onClick={() => void install.install()}>
        {t.t("install_app")}
      </Button>
    );
  }
  return (
    <details className="about install-help">
      <summary>{t.t("install_app")}</summary>
      <p className="foot-hint">{t.t("install_why")}</p>
      <InstallSteps help={install.kind} ios={install.ios} />
    </details>
  );
}
