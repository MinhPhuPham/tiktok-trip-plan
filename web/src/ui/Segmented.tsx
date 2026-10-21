import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { classes } from "../lib/css";
import { Icon } from "./Icon";

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
  /** Accessible name when the visible label is an abbreviation ("EN" → "English"). */
  ariaLabel?: string;
  /** Language of the option's own text. */
  lang?: string;
}

interface SegmentedProps<V extends string> {
  options: readonly SegmentedOption<V>[];
  value: V | null;
  onChange: (value: V) => void;
  /**
   * "pressed": a group of toggle buttons (aria-pressed), Tab moves through them.
   * "radio": a radiogroup with one tab stop and arrow keys (aria-checked, check mark).
   */
  mode?: "pressed" | "radio";
  "aria-label"?: string;
  "aria-labelledby"?: string;
  wrap?: boolean;
  className?: string;
}

const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  mode = "pressed",
  wrap = false,
  className,
  ...aria
}: SegmentedProps<V>) {
  const group = useRef<HTMLDivElement>(null);
  const radio = mode === "radio";

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!radio || !NAV_KEYS.has(event.key)) return;
    const enabled = options.filter((o) => !o.disabled);
    const index = enabled.findIndex((o) => o.value === value);
    if (!enabled.length) return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const nextIndex =
      event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (index + step + enabled.length) % enabled.length;
    const next = enabled[nextIndex];
    if (!next) return;
    onChange(next.value);
    group.current?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
  };

  return (
    <div
      ref={group}
      className={classes("seg", wrap && "wrap", className)}
      role={radio ? "radiogroup" : "group"}
      onKeyDown={onKeyDown}
      {...aria}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            data-value={option.value}
            title={option.title}
            aria-label={option.ariaLabel}
            lang={option.lang}
            disabled={option.disabled}
            role={radio ? "radio" : undefined}
            aria-checked={radio ? on : undefined}
            aria-pressed={radio ? undefined : on}
            tabIndex={radio ? (on || (value == null && option === options[0]) ? 0 : -1) : undefined}
            onClick={() => onChange(option.value)}
          >
            {radio ? <Icon name="check" className="icon ck" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
