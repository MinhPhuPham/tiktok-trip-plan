import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { classes } from "../lib/css";
import { Icon } from "./Icon";
import type { IconName } from "./IconSprite";

export interface MultiOption<V extends string> {
  value: V;
  label: string;
  icon?: IconName;
  count?: number;
}

interface MultiSelectProps<V extends string> {
  /** The trigger text with nothing chosen, the panel title and the accessible name. */
  label: string;
  options: readonly MultiOption<V>[];
  selected: ReadonlySet<string>;
  onToggle: (value: V) => void;
  onClear: () => void;
  clearLabel: string;
  doneLabel: string;
  /** A bottom panel over the page (phones, inside the bottom sheet) instead of a popover under the trigger. */
  sheet: boolean;
}

const POPOVER_GAP = 6;

/**
 * A dropdown of checkable options. Choices apply as they are toggled; the panel is a listbox
 * (arrows move, Space toggles, Enter or Escape closes and focus returns to the trigger).
 */
export function MultiSelect<V extends string>(props: MultiSelectProps<V>) {
  const { label, options, selected, onToggle, onClear, clearLabel, doneLabel, sheet } = props;
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setActive] = useState(0);
  const active = Math.min(cursor, Math.max(0, options.length - 1));
  const ids = { title: useId(), option: useId() };

  const chosen = options.filter((option) => selected.has(option.value));
  const first = chosen[0];
  const summary = first ? (chosen.length > 1 ? `${first.label} +${chosen.length - 1}` : first.label) : label;
  const name = chosen.length ? `${label}: ${chosen.map((option) => option.label).join(", ")}` : label;

  const close = (returnFocus: boolean) => {
    dialog.current?.close();
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  const show = () => {
    const node = dialog.current;
    const button = trigger.current;
    if (!node || !button) return;
    if (sheet) {
      node.style.top = "";
      node.showModal();
    } else {
      node.style.top = `${button.offsetTop + button.offsetHeight + POPOVER_GAP}px`;
      node.show();
    }
    setActive(Math.max(0, options.findIndex((option) => selected.has(option.value))));
    setOpen(true);
    list.current?.focus();
  };

  useEffect(() => {
    if (!open || sheet) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) {
        dialog.current?.close();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, sheet]);

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const toggleAt = (index: number) => {
    const option = options[index];
    if (!option) return;
    setActive(index);
    onToggle(option.value);
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = options.length - 1;
    const moves: Record<string, number> = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: last };
    if (event.key in moves) {
      event.preventDefault();
      setActive(Math.min(last, Math.max(0, moves[event.key] ?? 0)));
    } else if (event.key === " ") {
      event.preventDefault();
      toggleAt(active);
    } else if (event.key === "Enter") {
      event.preventDefault();
      close(true);
    }
  };

  const onDialogKey = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };

  /** A click on a modal dialog's own box (not its panel) is the backdrop. */
  const onDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialog.current && sheet) close(true);
  };

  return (
    <div ref={box} className="ms">
      <button
        ref={trigger}
        type="button"
        className={classes("select", chosen.length > 0 && "is-on")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={name}
        disabled={!options.length}
        onClick={() => (open ? close(false) : show())}
      >
        <span className="select-v">{summary}</span>
        <Icon name="chevron" />
      </button>
      <dialog
        ref={dialog}
        className="ms-dialog"
        aria-labelledby={ids.title}
        onKeyDown={onDialogKey}
        onCancel={(event) => {
          event.preventDefault();
          close(true);
        }}
        onClose={() => setOpen(false)}
        onClick={onDialogClick}
      >
        <div className="ms-panel">
          <p className="ms-title" id={ids.title}>
            {label}
          </p>
          <div
            ref={list}
            className="ms-list"
            role="listbox"
            aria-multiselectable="true"
            aria-labelledby={ids.title}
            aria-activedescendant={options.length ? `${ids.option}-${active}` : undefined}
            tabIndex={0}
            onKeyDown={onListKey}
          >
            {options.map((option, index) => {
              const on = selected.has(option.value);
              return (
                <div
                  key={option.value}
                  id={`${ids.option}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={on}
                  className={classes("ms-option", index === active && "is-active")}
                  onClick={() => toggleAt(index)}
                >
                  <span className="ms-box" aria-hidden="true">
                    <Icon name="check" />
                  </span>
                  {option.icon ? <Icon name={option.icon} className="icon ms-icon" /> : <span className="ms-icon" />}
                  <span className="ms-label">{option.label}</span>
                  {option.count == null ? null : <span className="ms-n num">{option.count}</span>}
                </div>
              );
            })}
          </div>
          <div className="ms-foot">
            <button type="button" className="btn ghost" disabled={!chosen.length} onClick={onClear}>
              {clearLabel}
            </button>
            <button type="button" className="btn primary" onClick={() => close(true)}>
              {doneLabel}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
