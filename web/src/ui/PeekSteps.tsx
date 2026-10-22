import type { KeyboardEvent } from "react";
import type { Step } from "../lib/swipe";
import { Icon } from "./Icon";
import { useSwipeStep, type SwipeProps } from "./useSwipeStep";

const STEP_KEYS: Readonly<Record<string, Step>> = { ArrowLeft: -1, ArrowRight: 1 };
const STEPS = [-1, 1] as const;

interface PeekStepsProps {
  /** Accessible name of each arrow ("Next stop: Lookout"). */
  label: (step: Step) => string;
  enabled: (step: Step) => boolean;
  onStep: (step: Step) => void;
}

/** The peek row's ‹ › pair; an arrow with nowhere to go stays focusable but disabled. */
export function PeekSteps({ label, enabled, onStep }: PeekStepsProps) {
  return (
    <div className="peek-steps">
      {STEPS.map((step) => (
        <button
          key={step}
          type="button"
          className="peek-step"
          aria-label={label(step)}
          aria-disabled={!enabled(step) || undefined}
          onClick={() => onStep(step)}
        >
          <Icon name={step < 0 ? "chevron-left" : "chevron-right"} />
        </button>
      ))}
    </div>
  );
}

/** Row props that step with ← → and a horizontal swipe. */
export function usePeekStepping(onStep: (step: Step) => void): SwipeProps & { onKeyDown: (event: KeyboardEvent<HTMLElement>) => void } {
  const swipe = useSwipeStep(onStep);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = STEP_KEYS[event.key];
    if (step == null || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    onStep(step);
  };
  return { onKeyDown, ...swipe };
}
