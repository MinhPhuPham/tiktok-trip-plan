import { useEffect, useState, type FocusEvent, type PointerEvent } from "react";
import { useTripActions } from "./hooks";

/** A sweep across rows reports only the row it settles on, so the map neither flickers nor pans for rows passed over. */
export const ROW_HOVER_DELAY_MS = 120;

export interface RowHoverProps {
  onPointerOver: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
}

const rowId = (target: EventTarget): string | null =>
  target instanceof Element ? (target.closest<HTMLElement>("[data-hover-id]")?.dataset.hoverId ?? null) : null;

const keyboardFocused = (target: EventTarget): boolean => target instanceof Element && target.matches(":focus-visible");

interface RowHover {
  props: RowHoverProps;
  dispose: () => void;
}

function createRowHover(setHovered: (id: string | null) => void): RowHover {
  let pointer: string | null = null;
  let focus: string | null = null;
  let timer: number | undefined;
  const report = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => setHovered(pointer ?? focus), ROW_HOVER_DELAY_MS);
  };
  const props: RowHoverProps = {
    onPointerOver: (event) => {
      const id = rowId(event.target);
      if (event.pointerType === "touch" || id === pointer) return;
      pointer = id;
      report();
    },
    onPointerLeave: (event) => {
      if (event.pointerType === "touch" || pointer == null) return;
      pointer = null;
      report();
    },
    onFocus: (event) => {
      focus = keyboardFocused(event.target) ? rowId(event.target) : null;
      report();
    },
    onBlur: () => {
      focus = null;
      report();
    },
  };
  const dispose = () => {
    window.clearTimeout(timer);
    pointer = null;
    focus = null;
    setHovered(null);
  };
  return { props, dispose };
}

/**
 * Event props for a list: the row (`data-hover-id`) under a mouse or pen, else the row with
 * keyboard focus, becomes the store's `hovered` id once it settles. Touch never hovers.
 */
export function useRowHover(): RowHoverProps {
  const { setHovered } = useTripActions();
  const [hover] = useState(() => createRowHover(setHovered));
  useEffect(() => hover.dispose, [hover]);
  return hover.props;
}
