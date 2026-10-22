import { useEffect, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { swipeStep, type Step } from "../lib/swipe";

/** A click this soon after a swipe is the swipe's own click, not a tap. */
const CLICK_AFTER_SWIPE_MS = 500;

export interface SwipeProps {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
}

interface Swipe {
  props: SwipeProps;
  /** The step handler of the latest render. */
  setOnStep: (onStep: (step: Step) => void) => void;
  dispose: () => void;
}

/*
 * The release is heard on window, so it still counts when an ancestor captures the pointer (the
 * sheet's vertical drag). Nothing is stopped or prevented while the finger moves.
 */
function createSwipe(): Swipe {
  let onStep: (step: Step) => void = () => undefined;
  let start: { id: number; x: number; y: number } | null = null;
  let swipedAt = -Infinity;
  const detach = () => {
    window.removeEventListener("pointerup", release);
    window.removeEventListener("pointercancel", release);
    start = null;
  };
  function release(event: PointerEvent): void {
    if (!start || event.pointerId !== start.id) return;
    const step = event.type === "pointerup" ? swipeStep(event.clientX - start.x, event.clientY - start.y) : null;
    detach();
    if (step == null) return;
    swipedAt = event.timeStamp;
    onStep(step);
  }
  const props: SwipeProps = {
    onPointerDown: (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      detach();
      start = { id: event.pointerId, x: event.clientX, y: event.clientY };
      window.addEventListener("pointerup", release, { passive: true });
      window.addEventListener("pointercancel", release, { passive: true });
    },
    onClickCapture: (event) => {
      if (event.timeStamp - swipedAt > CLICK_AFTER_SWIPE_MS) return;
      swipedAt = -Infinity;
      event.preventDefault();
      event.stopPropagation();
    },
  };
  const setOnStep = (next: (step: Step) => void) => {
    onStep = next;
  };
  return { props, setOnStep, dispose: detach };
}

/** Pointer props for a row that steps left/right on a horizontal swipe; the swipe's click is swallowed. */
export function useSwipeStep(onStep: (step: Step) => void): SwipeProps {
  const [swipe] = useState(createSwipe);
  useEffect(() => swipe.setOnStep(onStep));
  useEffect(() => swipe.dispose, [swipe]);
  return swipe.props;
}
