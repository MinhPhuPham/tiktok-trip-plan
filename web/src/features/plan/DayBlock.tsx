import { memo } from "react";
import type { TripModel } from "../../data/model";
import { daySpan } from "../../data/stops";
import type { TripDay } from "../../data/types";
import type { Translator } from "../../i18n/translator";
import { classes, cssVars } from "../../lib/css";
import { Icon } from "../../ui/Icon";
import { preloadPlanEditor } from "../editor/LazyPlanEditor";
import { DirectionsLinks } from "./DirectionsLinks";
import { StopRow } from "./StopRow";
import { stopCount } from "./stopCount";

interface DayBlockProps {
  model: TripModel;
  t: Translator;
  day: TripDay;
  open: boolean;
  hidden: ReadonlySet<string>;
  /** The id whose card is open. */
  selected: string | null;
  /** `toggle` is the header button, so the list can keep it in place while days open and close. */
  onToggle: (day: number, toggle: HTMLElement) => void;
  onEdit: (day: number) => void;
  onOpen: (id: string) => void;
}

/** One plan day as an accordion item: the header opens it (and focuses it on the map), the pencil edits it. */
export const DayBlock = memo(function DayBlock({ model, t, day, open, hidden, selected, onToggle, onEdit, onOpen }: DayBlockProps) {
  const nameId = `day-name-${day.day}`;
  const bodyId = `day-body-${day.day}`;
  const visits = day.stops.reduce((n, stop) => (stop.number == null ? n : n + 1), 0);
  const editLabel = t.t("edit_plan");
  return (
    <section className={classes("day", open && "is-open")} aria-labelledby={nameId} style={cssVars({ "--d": day.color })}>
      <div className="day-head">
        <h2 className="day-h">
          <button type="button" className="day-toggle" aria-expanded={open} aria-controls={bodyId} onClick={(event) => onToggle(day.day, event.currentTarget)}>
            <span className="swatch" aria-hidden="true" />
            <span className="day-title">
              <span id={nameId}>{t.dayName(day.day)}</span>{" "}
              <span className="day-count num">· {stopCount(t, visits)}</span>
            </span>{" "}
            <span className="day-span num">{daySpan(t, day)}</span>
            <Icon name="chevron" className="icon chev" />
          </button>
        </h2>
        <button
          type="button"
          className="btn ghost day-edit"
          aria-label={editLabel}
          aria-describedby={nameId}
          title={editLabel}
          data-edit-day={day.day}
          onPointerEnter={preloadPlanEditor}
          onFocus={preloadPlanEditor}
          onClick={() => onEdit(day.day)}
        >
          <Icon name="pencil" />
        </button>
      </div>
      <div className="day-body" id={bodyId}>
        <div className="day-inner">
          {day.directions.length ? (
            <div className="day-actions">
              <DirectionsLinks urls={day.directions} t={t} />
            </div>
          ) : null}
          <ol className="stops">
            {day.stops.map((stop, index) => (
              <StopRow
                key={`${index}-${stop.kind}-${stop.ref ?? ""}`}
                model={model}
                t={t}
                day={day}
                stop={stop}
                hidden={hidden}
                selected={selected}
                onOpen={onOpen}
              />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
});
