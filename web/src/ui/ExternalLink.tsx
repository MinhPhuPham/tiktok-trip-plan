import type { ReactNode } from "react";
import { useT } from "../i18n/useT";
import { safeUrl } from "../lib/safe";
import { buttonClass, type ButtonVariant } from "./Button";
import { Icon } from "./Icon";
import type { IconName } from "./IconSprite";

interface ExternalLinkProps {
  href: string | null | undefined;
  children: ReactNode;
  variant?: ButtonVariant;
  icon?: IconName;
  className?: string;
  "aria-label"?: string;
}

/** An https link styled as a button that opens in a new tab; renders nothing for other URLs. */
export function ExternalLink({ href, children, variant, icon, className, "aria-label": label }: ExternalLinkProps) {
  const t = useT();
  const url = safeUrl(href);
  if (!url) return null;
  return (
    <a className={className ?? buttonClass(variant)} href={url} target="_blank" rel="noopener noreferrer" aria-label={label}>
      {icon ? <Icon name={icon} /> : null}
      {children}
      {label ? null : <span className="sr-only"> {t.t("new_tab")}</span>}
    </a>
  );
}
