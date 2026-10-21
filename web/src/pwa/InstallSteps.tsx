import { useRef, useState } from "react";
import type { Translator } from "../i18n/translator";
import { useT } from "../i18n/useT";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/IconSprite";
import type { InstallHelp } from "./installOffer";
import "./install.css";

interface InstallStepsProps {
  help: InstallHelp;
  ios: boolean;
}

/** How to install in this browser when it has no install prompt of its own. */
export function InstallSteps({ help, ios }: InstallStepsProps) {
  const t = useT();
  const browser = ios ? "Safari" : "Chrome";
  switch (help) {
    case "share":
      return (
        <ol className="install-steps">
          <li>
            <IconText t={t} text="install_ios_share" icon="share" />
          </li>
          <li>
            <IconText t={t} text="install_ios_add" icon="plus-square" />
          </li>
        </ol>
      );
    case "menu":
      return (
        <ol className="install-steps">
          <li>
            <IconText t={t} text="install_menu_open" icon="more" />
          </li>
          <li>{t.t("install_menu_add")}</li>
        </ol>
      );
    case "dock":
      return <p className="install-note">{t.t("install_dock")}</p>;
    case "in-app":
      return (
        <>
          <p className="install-note">{t.t("install_in_app")}</p>
          <ol className="install-steps">
            <li>{t.t("install_in_app_open")}</li>
            <li>{t.t("install_in_app_then", { browser })}</li>
          </ol>
          <p className="install-note">{t.t("install_copy_hint", { browser })}</p>
          <CopyLink />
        </>
      );
    case "safari-only":
    case "unsupported":
      return (
        <>
          <p className="install-note">{t.t(help === "safari-only" ? "install_safari_only" : "install_unsupported")}</p>
          <CopyLink />
        </>
      );
  }
}

type CopyState = "idle" | "copied" | "manual";

/** Copies the page link; where the clipboard is blocked (some in-app browsers) shows it selected instead. */
function CopyLink() {
  const t = useT();
  const [state, setState] = useState<CopyState>("idle");
  const field = useRef<HTMLInputElement>(null);
  const url = window.location.href;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("manual");
      requestAnimationFrame(() => field.current?.select());
    }
  };
  return (
    <div className="install-copy">
      <Button icon={state === "copied" ? "check" : "copy"} onClick={() => void copy()}>
        {t.t(state === "copied" ? "install_copied" : "install_copy_link")}
      </Button>
      {state === "manual" ? (
        <input
          ref={field}
          className="install-url"
          type="url"
          readOnly
          value={url}
          aria-label={t.t("install_link")}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
      <span className="sr-only" role="status">
        {state === "copied" ? t.t("install_copied") : ""}
      </span>
    </div>
  );
}

interface IconTextProps {
  t: Translator;
  text: string;
  icon: IconName;
}

/** A label whose "{icon}" placeholder becomes the icon the browser shows. */
function IconText({ t, text, icon }: IconTextProps) {
  const [before, after = ""] = t.t(text).split("{icon}");
  return (
    <>
      {before}
      <Icon name={icon} className="icon install-glyph" />
      {after}
    </>
  );
}
