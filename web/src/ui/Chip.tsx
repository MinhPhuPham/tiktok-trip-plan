import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./IconSprite";

interface ChipProps {
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Shown before the label; the check mark replaces it while pressed. */
  icon?: IconName;
  count?: number;
  disabled?: boolean;
  "aria-label"?: string;
  title?: string;
}

/** A filter toggle (pill) with a check mark when pressed. */
export function Chip({ pressed, onToggle, children, icon, count, ...rest }: ChipProps) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onToggle} {...rest}>
      <Icon name="check" className="icon ck" />
      {icon ? <Icon name={icon} /> : null}
      {children}
      {count == null ? null : <span className="n num">{count}</span>}
    </button>
  );
}
