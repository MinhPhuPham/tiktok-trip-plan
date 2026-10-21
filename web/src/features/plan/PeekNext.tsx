import { DOM_IDS } from "../../app/ids";
import { useNow } from "../../app/useNow";
import { useTripModel, useTripPlan } from "../../data/hooks";
import { arriveMin, nextStop, stopName, stopTargetId } from "../../data/stops";
import { useT } from "../../i18n/useT";
import { cssVars } from "../../lib/css";
import { usePhone, useTripActions } from "../../state/hooks";

/** The collapsed phone sheet's "Next: 9:30 Phở Gia Truyền" row; nothing on desktop. */
export function PeekNext() {
  return usePhone() ? <PeekNextButton /> : null;
}

function PeekNextButton() {
  const t = useT();
  const model = useTripModel();
  const plan = useTripPlan();
  const now = useNow();
  const { openCard } = useTripActions();
  const next = nextStop(model, plan, now);
  if (!next) return null;
  const { day, stop, legMinutes } = next;
  const time = t.time(arriveMin(stop));
  const name = stopName(model, t, stop);
  const sub = [
    t.t("day_stop", { day: t.dayName(day.day), n: stop.number ?? "" }),
    legMinutes != null ? t.t("leg", { n: legMinutes }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      id={DOM_IDS.peekNext}
      className="peek"
      type="button"
      title={[t.t("next"), time, name].join(" ")}
      onClick={() => openCard(stopTargetId(model, stop))}
    >
      <span className="peek-dot num" style={cssVars({ "--d": day.color, "--dink": day.ink })} aria-hidden="true">
        {stop.number}
      </span>
      <span className="peek-text">
        <span className="peek-line">
          <b>{t.t("next")}</b> <span className="num">{time}</span> <span className="peek-name">{name}</span>
        </span>
        <span className="peek-sub num">{sub}</span>
      </span>
    </button>
  );
}
