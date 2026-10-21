import type { DragEvent } from "react";
import { REST_REF } from "../../../data/types";
import { cssVars } from "../../../lib/css";
import { ON_LEG } from "../logic/constants";
import { weekdayOf } from "../logic/context";
import type { IssueGroups } from "../logic/issues";
import { WEEKDAYS } from "../logic/labels";
import type { TimedDay } from "../logic/types";
import type { DraftDay } from "../session/session";
import { centerName } from "../text";
import { IssueList } from "./IssueList";
import { LegLine } from "./LegLine";
import { PeIcon } from "./PeIcon";
import { StopItem, type DropMark, type WhyIds } from "./StopItem";
import { useEditorText, useSession, useSessionActions, useSessionState } from "./sessionContext";

export type DropTarget = { uid: string; after: boolean } | { day: number } | null;

interface DayCardProps {
  day: DraftDay;
  dayIndex: number;
  dayCount: number;
  timed: TimedDay | undefined;
  groups: IssueGroups;
  drop: DropTarget;
  draggingUid: string | null;
  why: WhyIds;
  onGripDragStart: (event: DragEvent<HTMLElement>, uid: string) => void;
}

function CenterRow({ label, at }: { label: string; at: string }) {
  return (
    <div className="pe-center">
      <span className="pe-dot is-center" aria-hidden="true">
        <PeIcon name="home" />
      </span>
      <span>{label}</span>
      <span className="num">{at}</span>
    </div>
  );
}

function dropMarkFor(drop: DropTarget, uid: string): DropMark {
  if (!drop || !("uid" in drop) || drop.uid !== uid) return null;
  return drop.after ? "after" : "before";
}

export function DayCard({ day, dayIndex, dayCount, timed, groups, drop, draggingUid, why, onGripDragStart }: DayCardProps) {
  const { ctx, model } = useSession();
  const actions = useSessionActions();
  const expanded = useSessionState((s) => s.expanded);
  const { t, time, lang, tr } = useEditorText();
  const route = timed?.stops ?? [];
  const routeAt = new Map<number, number>();
  route.forEach((r, k) => {
    if (r.index != null) routeAt.set(r.index, k);
  });
  const places = day.stops.filter((s) => {
    const node = ctx.nodes.get(s.ref);
    return node && node.kind !== "rest";
  }).length;
  const travel = route.reduce((sum, r) => sum + (r.travel_min_to_next || 0), 0);
  const first = route[0];
  const end = route.at(-1);
  const beforeEnd = route.at(-2);
  const weekdays = WEEKDAYS[lang] ?? WEEKDAYS.en ?? [];
  const weekday = ctx.dated ? ` · ${weekdays[weekdayOf(ctx, dayIndex)] ?? ""}` : "";
  const center = centerName(model, tr);
  const headingId = `pe-day-${dayIndex}`;
  const dropInto = drop != null && "day" in drop && drop.day === dayIndex;
  const numbers: number[] = [];
  for (const stop of day.stops) numbers.push((numbers.at(-1) ?? 0) + (stop.ref === REST_REF ? 0 : 1));
  const color = model.defaultDayColor(dayIndex + 1);
  /** A long ride back already shows on the last leg. */
  const dayIssues = (groups.byDay.get(dayIndex) ?? []).filter((x) => !ON_LEG.has(x.rule));

  return (
    <section
      className={dropInto ? "pe-day is-drop-into" : "pe-day"}
      style={cssVars({ "--d": color, "--dink": model.dayInk(color) })}
      data-day={dayIndex}
      aria-labelledby={headingId}
    >
      <header className="pe-day-head">
        <h3 id={headingId} tabIndex={-1} data-fk={`day:${dayIndex}`}>
          <span className="pe-swatch" aria-hidden="true" />
          {t("planned_day", { n: dayIndex + 1 })}
          {weekday}
        </h3>
        <button
          type="button"
          className="pe-icon-btn is-remove"
          data-fk={`remove-day:${dayIndex}`}
          aria-label={`${t("remove_day")} ${dayIndex + 1}`}
          title={t("remove_day")}
          onClick={() => actions.removeDay(dayIndex)}
        >
          <PeIcon name="trash" />
        </button>
        {end ? (
          <p className="pe-day-stats num">{t("day_stats", { places, travel, end: time(end.arrive_min) })}</p>
        ) : null}
      </header>
      <IssueList issues={dayIssues} className="pe-day-issues" />
      {day.stops.length ? (
        <>
          {first ? <CenterRow label={t("leave_center", { name: center })} at={time(first.depart_min)} /> : null}
          <ol className="pe-stops" data-day={dayIndex}>
            {day.stops.map((stop, i) => {
              const k = routeAt.get(i);
              const prev = k != null && k > 0 ? route[k - 1] : undefined;
              const here = k != null ? route[k] : undefined;
              return (
                <StopItem
                  key={stop.uid}
                  stop={stop}
                  index={i}
                  dayIndex={dayIndex}
                  dayCount={dayCount}
                  stopCount={day.stops.length}
                  number={numbers[i] ?? 0}
                  timed={here}
                  issues={groups.byStop.get(stop.uid) ?? []}
                  leg={prev && here ? <LegLine prev={prev} next={here} /> : null}
                  open={expanded.has(stop.uid)}
                  dropMark={dropMarkFor(drop, stop.uid)}
                  dragging={draggingUid === stop.uid}
                  why={why}
                  onGripDragStart={onGripDragStart}
                />
              );
            })}
          </ol>
          {end && beforeEnd ? <LegLine prev={beforeEnd} next={end} /> : null}
          {end ? <CenterRow label={t("back_center", { name: center })} at={time(end.arrive_min)} /> : null}
        </>
      ) : (
        <ol className="pe-stops is-empty" data-day={dayIndex}>
          <li className="pe-empty">{t("empty_day")}</li>
        </ol>
      )}
      <div className="pe-day-actions">
        <button type="button" className="pe-btn" data-fk={`add-place:${dayIndex}`} onClick={() => actions.openPicker(dayIndex)}>
          <PeIcon name="plus" />
          {t("add_place")}
        </button>
        <button type="button" className="pe-btn ghost" data-fk={`add-rest:${dayIndex}`} onClick={() => actions.addRest(dayIndex)}>
          <PeIcon name="bed" />
          {t("add_rest")}
        </button>
      </div>
    </section>
  );
}
