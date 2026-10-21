import { useId, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type RefObject } from "react";
import { prefersReducedMotion } from "../../../app/viewport";
import { isTypingTarget, scrollParent } from "../../../lib/dom";
import { MAX_DAYS } from "../logic/constants";
import { errorCount, groupIssues } from "../logic/issues";
import type { SessionState } from "../session/session";
import { AddPlaceDialog } from "./AddPlaceDialog";
import { DayCard, type DropTarget } from "./DayCard";
import { EditorBar } from "./EditorBar";
import { ExportSection } from "./ExportSection";
import { LeftOutList } from "./LeftOutList";
import { LiveRegion } from "./LiveRegion";
import { PeIcon } from "./PeIcon";
import type { WhyIds } from "./StopItem";
import { useEditorText, useSession, useSessionActions, useSessionState } from "./sessionContext";

const sameDrop = (a: DropTarget, b: DropTarget): boolean =>
  a === b ||
  (a != null && b != null && ("uid" in a && "uid" in b ? a.uid === b.uid && a.after === b.after : "day" in a && "day" in b && a.day === b.day));

/** Where a dragged stop would land: before/after another stop, or at the end of a day. */
function dropTargetOf(event: DragEvent<HTMLElement>, dragUid: string): DropTarget {
  const target = event.target as Element;
  const li = target.closest<HTMLElement>(".pe-stop");
  if (li && li.dataset.uid && li.dataset.uid !== dragUid) {
    const box = li.getBoundingClientRect();
    return { uid: li.dataset.uid, after: event.clientY > box.top + box.height / 2 };
  }
  const day = target.closest<HTMLElement>(".pe-day");
  return day ? { day: Number(day.dataset.day) } : null;
}

/**
 * Scrolls the panel so `el` starts just under the sticky editor bar (scrollIntoView would also
 * scroll the overflow: hidden panel and app shell).
 */
function scrollBelowBar(el: HTMLElement, root: HTMLElement): void {
  const box = scrollParent(el);
  if (!box) return;
  const bar = root.querySelector(".pe-bar")?.getBoundingClientRect().height ?? 0;
  box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - bar;
}

const selectFocus = (s: SessionState) => s.focus;
const selectLive = (s: SessionState) => s.live;

/**
 * Carries out the session's focus requests after the edit has rendered. Each request runs once: when
 * <Activity> shows the panel again the effect re-runs, and the seq guard keeps focus where it is.
 */
function FocusRequests({ root }: { root: RefObject<HTMLDivElement | null> }) {
  const focus = useSessionState(selectFocus);
  const handled = useRef(0);
  useLayoutEffect(() => {
    if (!focus || focus.seq === handled.current) return;
    handled.current = focus.seq;
    const panel = root.current;
    const el = panel?.querySelector<HTMLElement>(`[data-fk="${CSS.escape(focus.key)}"]`);
    if (!panel || !el || (el as HTMLButtonElement).disabled) return;
    if (focus.key.startsWith("day:")) {
      scrollBelowBar(el.closest<HTMLElement>(".pe-day") ?? el, panel);
      el.focus({ preventScroll: true });
    } else {
      el.focus();
    }
  }, [focus, root]);
  return null;
}

function SessionLiveRegion() {
  const live = useSessionState(selectLive);
  return <LiveRegion text={live.text} seq={live.seq} />;
}

export function EditorPanel() {
  const session = useSession();
  const actions = useSessionActions();
  const { t, lang } = useEditorText();
  const days = useSessionState((s) => s.days);
  const unplaced = useSessionState((s) => s.unplaced);
  const staleDraft = useSessionState((s) => s.staleDraft);
  const root = useRef<HTMLDivElement>(null);
  const dragUid = useRef<string | null>(null);
  const [drop, setDrop] = useState<DropTarget>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const idBase = useId();
  const why: WhyIds = {
    first: `${idBase}why-first`,
    last: `${idBase}why-last`,
    max: `${idBase}why-max`,
    keys: `${idBase}kbd-hint`,
  };

  const { computed, leftOut } = session.derive({ days, unplaced });
  const groups = useMemo(() => groupIssues(days, computed.issues), [days, computed]);
  const errors = errorCount(computed.issues);
  const full = days.length >= MAX_DAYS;

  const jumpToError = () => {
    const first = root.current?.querySelector<HTMLElement>(".pe-stop.has-error, .pe-issue.is-error");
    if (!first) return;
    const box = scrollParent(first);
    if (box) {
      const offset = first.getBoundingClientRect().top - box.getBoundingClientRect().top;
      box.scrollTo({
        top: box.scrollTop + offset - (box.clientHeight - first.offsetHeight) / 2,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
    const target = first.querySelector<HTMLElement>(".pe-main") ?? first.closest(".pe-day")?.querySelector<HTMLElement>("h3");
    target?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const undoKey = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z";
    if (undoKey && !isTypingTarget(event.target) && session.store.getState().undo) {
      event.preventDefault();
      actions.undo();
    }
  };

  const onGripDragStart = (event: DragEvent<HTMLElement>, uid: string) => {
    dragUid.current = uid;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", uid);
    const li = event.currentTarget.closest<HTMLElement>(".pe-stop");
    if (li) event.dataTransfer.setDragImage(li, 24, 20);
    requestAnimationFrame(() => setDragging(uid));
  };
  const endDrag = () => {
    dragUid.current = null;
    setDrop(null);
    setDragging(null);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    const uid = dragUid.current;
    if (!uid) return;
    const target = dropTargetOf(event, uid);
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDrop((current) => (sameDrop(current, target) ? current : target));
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const uid = dragUid.current;
    if (!uid) return;
    event.preventDefault();
    const target = dropTargetOf(event, uid);
    endDrag();
    if (!target) return;
    if ("uid" in target) actions.dropOnStop(uid, target.uid, target.after);
    else actions.dropIntoDay(uid, target.day);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
  };

  return (
    <>
      <div
        ref={root}
        className="pe"
        data-lang={lang}
        onKeyDown={onKeyDown}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={endDrag}
        onDragLeave={onDragLeave}
      >
        <div className="pe-content">
          <EditorBar errors={errors} onJump={jumpToError} />
          {staleDraft ? (
            <div className="pe-banner">
              <span>{t("stale_draft")}</span>
              <button type="button" className="pe-btn" onClick={actions.restoreDraft}>
                {t("restore_draft")}
              </button>
              <button type="button" className="pe-btn ghost" onClick={actions.discardDraft}>
                {t("discard_draft")}
              </button>
            </div>
          ) : null}
          <p className="pe-hint" id={why.keys}>
            {t("keyboard_hint")}
          </p>
          <div hidden>
            <span id={why.first}>{t("why_first")}</span>
            <span id={why.last}>{t("why_last")}</span>
            <span id={why.max}>{t("max_days")}</span>
          </div>
          {days.map((day, d) => (
            <DayCard
              key={d}
              day={day}
              dayIndex={d}
              dayCount={days.length}
              timed={computed.days[d]}
              groups={groups}
              drop={drop}
              draggingUid={dragging}
              why={why}
              onGripDragStart={onGripDragStart}
            />
          ))}
          <div className="pe-add-day">
            <button
              type="button"
              className="pe-btn"
              data-fk="add-day"
              aria-disabled={full || undefined}
              aria-describedby={full ? why.max : undefined}
              title={full ? t("max_days") : undefined}
              onClick={() => {
                if (!full) actions.addDay();
              }}
            >
              <PeIcon name="calendar" />
              {t("add_day")}
            </button>
          </div>
          <LeftOutList leftOut={leftOut} dayCount={days.length} groups={groups} />
          <ExportSection hasErrors={errors > 0} />
        </div>
        <SessionLiveRegion />
        <AddPlaceDialog />
      </div>
      {/* A sibling after the root, not a child: its layout effect runs once the root's ref is attached. */}
      <FocusRequests root={root} />
    </>
  );
}
