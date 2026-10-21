import type { TripModel } from "../../data/model";
import { useStopNotes } from "../../data/planIssues";
import { stopActivity, stopName, stopPlace, stopTargetId, stopTime } from "../../data/stops";
import { CENTER_REF, type TripDay, type TripStop } from "../../data/types";
import type { Translator } from "../../i18n/translator";
import { classes, cssVars } from "../../lib/css";
import { Icon } from "../../ui/Icon";
import { PlaceStars } from "../../ui/PlaceStars";

interface StopRowProps {
  model: TripModel;
  t: Translator;
  day: TripDay;
  stop: TripStop;
  hidden: ReadonlySet<string>;
  selected: string | null;
  onOpen: (id: string) => void;
}

export function StopRow({ model, t, day, stop, hidden, selected, onOpen }: StopRowProps) {
  const visit = stop.number != null;
  const place = stopPlace(model, stop);
  const isHidden = place != null && hidden.has(place.id);
  const target = stopTargetId(model, stop);
  const hoverId = !isHidden && target !== CENTER_REF && model.target(target) ? target : undefined;
  const activity = stopActivity(model, t, stop);
  const reason = t.pick(stop.reason, stop.reason_vi);
  const notes = useStopNotes(stop);
  return (
    <li
      className={classes("stop", !visit && "muted", isHidden && "is-hidden")}
      style={cssVars({ "--d": day.color, "--dink": day.ink })}
    >
      <button
        type="button"
        className="stop-btn"
        disabled={!model.target(target)}
        aria-current={visit && target === selected ? "true" : undefined}
        data-hover-id={hoverId}
        onClick={() => onOpen(target)}
      >
        <span className={classes("dot num", !visit && "hollow")} aria-hidden="true">
          {visit ? stop.number : ""}
        </span>
        <span className="row-text">
          <span className="stop-meta">
            {visit ? <span className="sr-only">{stop.number}.</span> : null}
            <span className="num">{stopTime(t, stop)}</span>
            {stop.kind === "rest" ? null : (
              <span className="act" title={activity}>
                {activity}
              </span>
            )}
            {notes ? (
              <span className={classes("stop-flag", notes.level === "error" && "is-error")} role="img" aria-label={notes.label}>
                <Icon name={notes.level === "error" ? "alert" : "warn"} />
              </span>
            ) : null}
          </span>
          <span className="stop-name">
            <PlaceStars place={place} t={t} />
            {stopName(model, t, stop)}
            {isHidden ? <span className="tag-hidden">{t.t("hidden_badge")}</span> : null}
          </span>
          {reason ? <span className="stop-reason">{reason}</span> : null}
        </span>
      </button>
    </li>
  );
}
