import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { DOM_IDS, focusById } from "../app/ids";
import { useT } from "../i18n/useT";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import type { InstallState } from "./install";
import { InstallSteps } from "./InstallSteps";
import { useInstallNudge } from "./useInstallNudge";

const TITLE_ID = "installTitle";

/**
 * "Install app" in the map tools until the trip runs installed. It opens a small popover: why, then the
 * browser's own prompt or the steps for this browser. "Not now" shrinks the button to its icon for two weeks.
 */
export function InstallTool() {
  const { install, entry, snooze } = useInstallNudge();
  return entry && install.kind !== "unavailable" ? (
    <InstallToolButton install={install} compact={entry === "icon"} snooze={snooze} />
  ) : null;
}

interface InstallToolButtonProps {
  install: Exclude<InstallState, { kind: "unavailable" }>;
  compact: boolean;
  snooze: () => void;
}

function InstallToolButton({ install, compact, snooze }: InstallToolButtonProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    pop.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !document.contains(target)) return;
      if (target.closest(`#${DOM_IDS.installPopover}, #${DOM_IDS.installButton}`)) return;
      setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  const close = () => {
    setOpen(false);
    focusById(DOM_IDS.installButton);
  };
  const notNow = () => {
    setOpen(false);
    snooze();
  };
  const runInstall = async () => {
    if (install.kind !== "prompt") return;
    setOpen(false);
    if ((await install.install()) === "dismissed") snooze();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || event.currentTarget.contains(next)) return;
    if (next instanceof Element && next.id === DOM_IDS.installButton) return;
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className="tool install-tool"
        id={DOM_IDS.installButton}
        aria-expanded={open}
        aria-controls={DOM_IDS.installPopover}
        title={compact ? t.t("install_app") : undefined}
        onClick={() => setOpen(!open)}
      >
        <Icon name="download" />
        <span className={compact ? "sr-only" : undefined}>{t.t("install_app")}</span>
      </button>
      <div
        ref={pop}
        className={open ? "install-pop is-entering" : "install-pop"}
        id={DOM_IDS.installPopover}
        role="dialog"
        aria-labelledby={TITLE_ID}
        hidden={!open}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      >
        <h2 id={TITLE_ID}>{t.t("install_title")}</h2>
        <p>{t.t("install_why")}</p>
        {install.kind === "prompt" ? null : <InstallSteps help={install.kind} ios={install.ios} />}
        <div className="install-actions">
          {compact ? null : (
            <Button variant="ghost" onClick={notNow}>
              {t.t("install_not_now")}
            </Button>
          )}
          {install.kind === "prompt" ? (
            <Button variant="primary" icon="download" data-autofocus="" onClick={() => void runInstall()}>
              {t.t("install_confirm")}
            </Button>
          ) : (
            <Button data-autofocus="" onClick={close}>
              {t.t("install_got_it")}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
