import { useState } from "react";
import { DOM_IDS } from "../../app/ids";
import { usePeekFocus } from "../../app/usePeekFocus";
import { useNow } from "../../app/useNow";
import { useTripModel, useTripPlan } from "../../data/hooks";
import { arriveMin, peekStart, stopName, stopTargetId, type PeekStart } from "../../data/stops";
import { useT } from "../../i18n/useT";
import { cssVars } from "../../lib/css";
import type { Step } from "../../lib/swipe";
import { useFocusDay, usePhone, useSheetOpen, useTripActions } from "../../state/hooks";
import { PeekSteps, usePeekStepping } from "../../ui/PeekSteps";
import { neighbour, peekView, stepPeek, type PeekBrowse } from "./peekCursor";

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
  const { openCard } = useTripActions();
  const sheetOpen = useSheetOpen();
  const [browse, setBrowse] = useState<PeekBrowse | null>(null);
  if (browse && (sheetOpen || browse.base !== start.stop)) setBrowse(null);

  const view = peekView(start, browse);
  const show = usePeekFocus(view.browsing ? stopTargetId(model, view.stop) : null, () => setBrowse(null));

  const step = (delta: Step) => {
    const target = neighbour(view, delta);
    const moved = stepPeek(view, start, delta);
    if (!target || !moved) return;
    setBrowse(moved);
    show(stopTargetId(model, target));
  };
  const stepping = usePeekStepping(step);

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
    <div className="peek" {...stepping}>
      <button
        id={DOM_IDS.peekMain}
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
      <PeekSteps label={stepLabel} enabled={(delta) => neighbour(view, delta) != null} onStep={step} />
      <span className="sr-only" role="status">
        {view.browsing ? `${lead} ${meta} ${name}` : ""}
      </span>
    </div>
  );
}
