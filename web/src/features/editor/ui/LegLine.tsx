import { LONG_LEG_MIN, LONG_WAIT_MIN } from "../logic/constants";
import type { TimedStop } from "../logic/types";
import { useEditorText } from "./sessionContext";

/** Travel minutes on the day's spine, plus the wait before a visit opens. */
export function LegLine({ prev, next }: { prev: TimedStop; next: TimedStop }) {
  const { t } = useEditorText();
  const travel = prev.travel_min_to_next;
  if (travel == null) return null;
  const wait = next.arrive_min - (prev.depart_min + travel);
  const showWait = wait > 0 && next.kind !== "end" && next.kind !== "rest";
  return (
    <div className={travel > LONG_LEG_MIN ? "pe-leg is-long" : "pe-leg"}>
      <span className="pe-leg-text num">{t(prev.travel_estimated ? "leg_estimate" : "leg", { n: travel })}</span>
      {showWait ? (
        <span className={wait >= LONG_WAIT_MIN ? "pe-wait is-long" : "pe-wait"}>{t("wait", { n: wait })}</span>
      ) : null}
    </div>
  );
}
