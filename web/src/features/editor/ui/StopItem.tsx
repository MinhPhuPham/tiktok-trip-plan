import { useId, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { REST_REF } from "../../../data/types";
import { ON_LEG } from "../logic/constants";
import { slotById } from "../logic/context";
import { issueText, notesText } from "../logic/issues";
import type { Issue, TimedStop } from "../logic/types";
import type { DraftStop } from "../session/session";
import { restName, slotName, starsOf } from "../text";
import { IssueList } from "./IssueList";
import { PeIcon } from "./PeIcon";
import { useEditorText, useIssueWords, useSession, useSessionActions } from "./sessionContext";

export type DropMark = "before" | "after" | null;

export interface WhyIds {
  first: string;
  last: string;
  saved: string;
  max: string;
  keys: string;
}

interface StopItemProps {
  stop: DraftStop;
  index: number;
  dayIndex: number;
  dayCount: number;
  stopCount: number;
  /** Visit number among the day's non-rest stops. */
  number: number;
  timed: TimedStop | undefined;
  issues: readonly Issue[];
  leg: ReactNode;
  open: boolean;
  dropMark: DropMark;
  dragging: boolean;
  why: WhyIds;
  onGripDragStart: (event: DragEvent<HTMLElement>, uid: string) => void;
}

const KEY_SHORTCUTS =
  "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight Shift+Alt+ArrowLeft Shift+Alt+ArrowRight Delete";

/** Up/Down walks the stops; Alt moves the stop; Delete removes it (Backspace does not: too easy to hit). */
function onMainKeyDown(event: KeyboardEvent<HTMLButtonElement>, run: (action: StopKeyAction) => void): void {
  const { key, altKey } = event;
  if (altKey && (key === "ArrowUp" || key === "ArrowDown")) {
    event.preventDefault();
    run(key === "ArrowUp" ? "up" : "down");
  } else if (altKey && (key === "ArrowLeft" || key === "ArrowRight")) {
    event.preventDefault();
    run(key === "ArrowLeft" ? "prev-day" : "next-day");
  } else if (key === "Delete") {
    event.preventDefault();
    run("remove");
  } else if (!altKey && (key === "ArrowUp" || key === "ArrowDown")) {
    const all = [...(event.currentTarget.closest(".pe")?.querySelectorAll<HTMLElement>(".pe-main") ?? [])];
    const next = all[all.indexOf(event.currentTarget) + (key === "ArrowUp" ? -1 : 1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }
}

type StopKeyAction = "up" | "down" | "prev-day" | "next-day" | "remove";

export function StopItem(props: StopItemProps) {
  const { stop, index, dayIndex, dayCount, stopCount, number, timed, issues, leg, open, dropMark, dragging, why } = props;
  const session = useSession();
  const actions = useSessionActions();
  const words = useEditorText();
  const issueWords = useIssueWords();
  const { t, time, tr } = words;
  const issueId = useId();
  /** The note while its input has focus; the plan gets it on blur or Enter. */
  const [typedNote, setTypedNote] = useState<string | null>(null);

  const node = session.ctx.nodes.get(stop.ref);
  const isRest = stop.ref === REST_REF;
  const name = isRest ? restName(session.model, tr) : (node?.name ?? stop.ref);
  const errorCount = issues.filter((x) => x.level === "error").length;
  const hasError = errorCount > 0;
  const hasWarn = !hasError && issues.length > 0;
  const first = dayIndex === 0 && index === 0;
  const last = dayIndex === dayCount - 1 && index === stopCount - 1;
  const slot = slotById(session.ctx, stop.slot);
  const stars = node?.place ? starsOf(node.place) : "";
  const meta =
    node?.kind === "place"
      ? [tr.category(node.category ?? ""), node.place?.priority ? tr.priority(node.place.priority) : ""]
      : node?.kind === "nearby"
        ? [t("nearby")]
        : [];
  const metaText = meta.filter(Boolean).join(" · ");
  const flagTitle = issues.map((x) => issueText(issueWords, x)).join("\n");
  const issueSummary = [
    errorCount ? t("to_fix", { n: errorCount }) : "",
    issues.length > errorCount ? notesText(t, issues.length - errorCount) : "",
  ]
    .filter(Boolean)
    .join(", ");
  const noteField = words.lang === "vi" ? "reason_vi" : "reason";
  const note = typedNote ?? stop[noteField];

  const runKey = (action: StopKeyAction) => {
    if (action === "up" || action === "down") actions.moveBy(stop.uid, action === "up" ? -1 : 1);
    else if (action === "remove") actions.removeStop(stop.uid);
    else actions.moveToDay(stop.uid, dayIndex + (action === "prev-day" ? -1 : 1));
  };

  const className = [
    "pe-stop",
    isRest ? "is-rest" : "",
    hasError ? "has-error" : "",
    hasWarn ? "has-warn" : "",
    open ? "is-open" : "",
    dropMark === "before" ? "is-drop-before" : dropMark === "after" ? "is-drop-after" : "",
    dragging ? "is-dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={className} data-uid={stop.uid}>
      {leg}
      <div className="pe-row">
        <span
          className="pe-grip"
          draggable
          title={t("drag")}
          onDragStart={(event) => props.onGripDragStart(event, stop.uid)}
        >
          <PeIcon name="grip" />
        </span>
        <span className="pe-dot num" aria-hidden="true">
          {isRest ? <PeIcon name="bed" /> : number}
        </span>
        <button
          type="button"
          className="pe-main"
          data-uid={stop.uid}
          data-fk={`main:${stop.uid}`}
          aria-expanded={open}
          aria-describedby={issueSummary ? `${issueId} ${why.keys}` : why.keys}
          aria-keyshortcuts={KEY_SHORTCUTS}
          onClick={() => actions.toggle(stop.uid)}
          onKeyDown={(event) => onMainKeyDown(event, runKey)}
        >
          <span className="pe-line">
            <span className="pe-time num">{timed ? time(timed.arrive_min) + "–" + time(timed.depart_min) : "–"}</span>
            {slot ? <span className="pe-act">{slotName(slot, words.lang)}</span> : null}
          </span>
          <span className="pe-name">
            {stars ? (
              <span className="pe-stars" aria-hidden="true">
                {stars}
              </span>
            ) : null}
            {name}
          </span>
          {metaText ? <span className="pe-meta">{metaText}</span> : null}
        </button>
        {issueSummary ? (
          <>
            <span id={issueId} hidden>
              {issueSummary}
            </span>
            {/* Out of the tab order: the stop's own button carries the summary and expands it too. */}
            <button
              type="button"
              tabIndex={-1}
              className={hasError ? "pe-flag is-error" : "pe-flag is-warn"}
              aria-label={issueSummary}
              aria-expanded={open}
              title={flagTitle}
              onClick={() => actions.toggle(stop.uid)}
            >
              <PeIcon name={hasError ? "error" : "warn"} />
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="pe-icon-btn is-remove"
          data-fk={`remove:${stop.uid}`}
          aria-label={`${t("remove")}: ${name}`}
          title={t("remove")}
          onClick={() => actions.removeStop(stop.uid)}
        >
          <PeIcon name="x" />
        </button>
      </div>
      <IssueList issues={issues.filter((x) => !ON_LEG.has(x.rule))} withWarnings={open} />
      {open ? (
        <div className="pe-more">
          <label className="pe-field">
            <span>{t("slot_label")}</span>
            <select
              data-fk={`slot:${stop.uid}`}
              value={stop.slot ?? ""}
              onChange={(event) => actions.setSlot(stop.uid, event.target.value || null)}
            >
              <option value="">{t("no_slot")}</option>
              {stop.slot && !slot ? <option value={stop.slot}>{stop.slot}</option> : null}
              {session.ctx.rhythm.map((s) => (
                <option key={s.id} value={s.id}>
                  {`${slotName(s, words.lang)} · ${s.start}–${s.end}`}
                </option>
              ))}
            </select>
          </label>
          <label className="pe-field">
            <span>{t("move_to_day")}</span>
            <select
              data-fk={`day:${stop.uid}`}
              value={dayIndex}
              onChange={(event) => actions.moveToDay(stop.uid, Number(event.target.value))}
            >
              {Array.from({ length: dayCount }, (_, d) => (
                <option key={d} value={d}>
                  {t("planned_day", { n: d + 1 })}
                </option>
              ))}
            </select>
          </label>
          <label className="pe-field pe-wide">
            <span>{t("note")}</span>
            <input
              type="text"
              data-fk={`reason:${stop.uid}`}
              value={note}
              placeholder={noteField === "reason_vi" && stop.reason ? stop.reason : undefined}
              autoComplete="off"
              onChange={(event) => setTypedNote(event.target.value)}
              onBlur={(event) => {
                actions.commitNote(stop.uid, event.currentTarget.value);
                setTypedNote(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") actions.commitNote(stop.uid, event.currentTarget.value);
              }}
            />
          </label>
          <div className="pe-move">
            <button
              type="button"
              className="pe-btn"
              data-fk={`up:${stop.uid}`}
              aria-disabled={first || undefined}
              aria-describedby={first ? why.first : undefined}
              title={first ? t("why_first") : undefined}
              onClick={() => {
                if (!first) actions.moveBy(stop.uid, -1, "up");
              }}
            >
              <PeIcon name="up" />
              {t("move_up")}
            </button>
            <button
              type="button"
              className="pe-btn"
              data-fk={`down:${stop.uid}`}
              aria-disabled={last || undefined}
              aria-describedby={last ? why.last : undefined}
              title={last ? t("why_last") : undefined}
              onClick={() => {
                if (!last) actions.moveBy(stop.uid, 1, "down");
              }}
            >
              <PeIcon name="down" />
              {t("move_down")}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
