import type { ChangeEvent } from "react";
import { classes } from "../lib/css";
import { Icon } from "./Icon";

export interface SelectOption<V extends string> {
  value: V;
  label: string;
  /** The trigger's text when the menu text is longer ("Day 1" for "Day 1 · 13 places"). */
  short?: string;
}

interface SelectProps<V extends string> {
  /** Shown before the value ("Priority: All") and the select's accessible name. */
  label: string;
  value: V;
  options: readonly SelectOption<V>[];
  onChange: (value: V) => void;
  /** Tinted like a pressed chip: a choice other than the default is in effect. */
  active?: boolean;
  /** Leave the label off the trigger when every value names itself ("All days", "Day 2"). */
  bare?: boolean;
}

/** A native select drawn as "Label: value ▾"; the transparent select covers the box, so the OS picker opens anywhere on it. */
export function Select<V extends string>({ label, value, options, onChange, active = false, bare = false }: SelectProps<V>) {
  const current = options.find((option) => option.value === value) ?? options[0];
  const onSelect = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = options.find((option) => option.value === event.target.value);
    if (next) onChange(next.value);
  };
  return (
    <span className={classes("select", active && "is-on")}>
      {bare ? null : (
        <span className="select-k" aria-hidden="true">
          {label}
        </span>
      )}
      <span className="select-v" aria-hidden="true">
        {current?.short ?? current?.label}
      </span>
      <Icon name="chevron" />
      <select aria-label={label} value={value} onChange={onSelect}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}
