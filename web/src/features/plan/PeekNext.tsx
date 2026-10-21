import { useEffect, useState, type KeyboardEvent } from "react";
import { DOM_IDS } from "../../app/ids";
import { useNow } from "../../app/useNow";
import { useTripModel, useTripPlan } from "../../data/hooks";
import { arriveMin, peekStart, stopName, stopTargetId, type PeekStart } from "../../data/stops";
import { useT } from "../../i18n/useT";
import { cssVars } from "../../lib/css";
import { useFocusDay, usePhone, useSheetOpen, useTripActions, useTripStoreApi } from "../../state/hooks";
import { Icon } from "../../ui/Icon";
import { neighbour, peekView, stepPeek, type PeekBrowse, type Step } from "./peekCursor";
import { useSwipeStep } from "./useSwipeStep";

/** Left alone this long, the peek row goes back to where it starts (the next stop, or the open day's #1). */
export const PEEK_IDLE_RESET_MS = 120_000;

const STEP_KEYS: Readonly<Record<string, Step>> = { ArrowLeft: -1, ArrowRight: 1 };

/**
 * The collapsed phone sheet's stop row with ‹ › through that day's stops; nothing on desktop. On a
 * dated trip's day it starts at the next stop by the clock, otherwise at #1 of the open Plan day.
 */
export function PeekNext() {
  return usePhone() ? <PeekNextRow /> : null;
}

function PeekNextRow() {
  const model = useTripModel();
  const plan = useTripPlan();
  const openDay = useFocusDay();
  const now = useNow();
  const start = peekStart(model, plan, openDay, now);
  return start ? <PeekStepper start={start} /> : null;
}

function PeekStepper({ start }: { start: PeekStart }) {
  const t = useT();
  const model = useTripModel();
  const store = useTripStoreApi();
  const { openCard, requestMap } = useTripActions();
  const sheetOpen = useSheetOpen();
  const [browse, setBrowse] = useState<PeekBrowse | null>(null);
  if (browse && (sheetOpen || browse.base !== start.stop)) setBrowse(null);

  const view = peekView(start, browse);
  const focusId = view.browsing ? stopTargetId(model, view.stop) : null;

  /* The browsed stop's pin lights like a hovered list row's; idle, the row returns to its start. */
  useEffect(() => {
    if (!focusId) return undefined;
    store.getState().actions.setHovered(focusId);
    const idle = window.setTimeout(() => setBrowse(null), PEEK_IDLE_RESET_MS);
    return () => {
      window.clearTimeout(idle);
      const { hovered, actions } = store.getState();
      if (hovered === focusId) actions.setHovered(null);
    };
  }, [focusId, store]);

  const step = (delta: Step) => {
    const target = neighbour(view, delta);
    const moved = stepPeek(view, start, delta);
    if (!target || !moved) return;
    setBrowse(moved);
    const id = stopTargetId(model, target);
    if (store.getState().selected) openCard(id);
    else requestMap({ type: "fly", id });
  };
  const swipe = useSwipeStep(step);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = STEP_KEYS[event.key];
    if (delta == null || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    step(delta);
  };

  const { day, stop, isNext, legMinutes } = view;
  const time = t.time(arriveMin(stop));
  const name = stopName(model, t, stop);
  const dayStop = t.t("day_stop", { day: t.dayName(day.day), n: stop.number ?? "" });
  const leg = legMinutes != null ? t.t("leg", { n: legMinutes }) : "";
  const lead = isNext ? t.t("next") : dayStop;
  const meta = (isNext ? [time, dayStop, leg] : [time, leg]).filter(Boolean).join(" · ");
  const stepLabel = (delta: Step) => {
    const target = neighbour(view, delta);
    const label = t.t(delta < 0 ? "peek_prev" : "peek_next");
    return target ? `${label}: ${stopName(model, t, target)}` : label;
  };

  return (
    <div className="peek" onKeyDown={onKeyDown} {...swipe}>
      <button
        id={DOM_IDS.peekNext}
        className="peek-main"
        type="button"
        title={[lead, time, name].filter(Boolean).join(" ")}
        onClick={() => openCard(stopTargetId(model, stop))}
      >
        <span className="peek-dot num" style={cssVars({ "--d": day.color, "--dink": day.ink })} aria-hidden="true">
          {stop.number}
        </span>
        <span
          key={`${day.day}:${view.index}`}
          className="peek-text"
          data-step={view.step == null ? undefined : view.step < 0 ? "prev" : "next"}
        >
          <span className="peek-meta num">
            <b>{lead}</b>
            {meta ? `${isNext ? " " : " · "}${meta}` : null}
          </span>
          <span className="peek-name">{name}</span>
        </span>
      </button>
      <div className="peek-steps">
        {([-1, 1] as const).map((delta) => (
          <button
            key={delta}
            type="button"
            className="peek-step"
            aria-label={stepLabel(delta)}
            aria-disabled={!neighbour(view, delta) || undefined}
            onClick={() => step(delta)}
          >
            <Icon name={delta < 0 ? "chevron-left" : "chevron-right"} />
          </button>
        ))}
      </div>
      <span className="sr-only" role="status">
        {view.browsing ? `${lead} ${meta} ${name}` : ""}
      </span>
    </div>
  );
}
