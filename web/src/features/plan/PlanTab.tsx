import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { prefersReducedMotion } from "../../app/viewport";
import { useTripModel, useTripPlan } from "../../data/hooks";
import type { TripPlan } from "../../data/types";
import { useT } from "../../i18n/useT";
import type { Translator } from "../../i18n/translator";
import { scrollParent } from "../../lib/dom";
import { useEditing, useFocusDay, useHiddenIds, useSelectedId, useTripActions, useTripStoreApi } from "../../state/hooks";
import { useRowHover } from "../../state/useRowHover";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { LazyPlanEditor, preloadPlanEditor } from "../editor/LazyPlanEditor";
import { DayBlock } from "./DayBlock";
import { UnplacedList } from "./UnplacedList";
import "./plan.css";

const PLAN_EDITOR_ID = "plan-editor";

export function PlanTab() {
  const t = useT();
  const plan = useTripPlan();
  const editing = useEditing();
  const store = useTripStoreApi();
  const root = useRef<HTMLDivElement>(null);
  const wasEditing = useRef(editing);
  const [unplacedOpen, setUnplacedOpen] = useState(false);
  const rowHover = useRowHover();

  useEffect(() => {
    if (wasEditing.current && !editing) {
      const active = document.activeElement;
      if (!active || active === document.body) {
        const { editDay } = store.getState();
        const buttons = root.current?.querySelectorAll<HTMLButtonElement>("[data-edit-day]") ?? [];
        const target = [...buttons].find((b) => b.dataset.editDay === String(editDay)) ?? buttons[0];
        target?.focus({ preventScroll: true });
      }
    }
    wasEditing.current = editing;
  }, [editing, store]);

  if (editing) {
    return (
      <Suspense fallback={<div id={PLAN_EDITOR_ID} aria-busy="true" />}>
        <LazyPlanEditor />
      </Suspense>
    );
  }
  return (
    <div ref={root} {...rowHover}>
      <PlanDays t={t} plan={plan} unplacedOpen={unplacedOpen} onUnplacedOpenChange={setUnplacedOpen} />
    </div>
  );
}

interface PlanDaysProps {
  t: Translator;
  plan: TripPlan;
  unplacedOpen: boolean;
  onUnplacedOpenChange: (open: boolean) => void;
}

function PlanDays({ t, plan, unplacedOpen, onUnplacedOpenChange }: PlanDaysProps) {
  const model = useTripModel();
  const focusDay = useFocusDay();
  const hidden = useHiddenIds();
  const selected = useSelectedId();
  const store = useTripStoreApi();
  const { openCard, setEditing, toggleFocusDay } = useTripActions();
  /*
   * On phones an opened day lowers the sheet to half (its route shows above) and moves to the top of
   * the list. Otherwise a day above may close: keep the clicked header in place so its day unfolds under it.
   */
  const toggleDay = useCallback(
    (day: number, toggle: HTMLElement) => {
      const before = toggle.getBoundingClientRect().top;
      flushSync(() => toggleFocusDay(day, { sheet: "half" }));
      const list = scrollParent(toggle);
      const section = toggle.closest(".day");
      if (!list || !section) return;
      const { phone, focusDay } = store.getState();
      if (phone && focusDay === day) {
        const top = list.scrollTop + section.getBoundingClientRect().top - list.getBoundingClientRect().top;
        list.scrollTo({ top, behavior: prefersReducedMotion() ? "instant" : "smooth" });
        return;
      }
      const shift = toggle.getBoundingClientRect().top - before;
      if (shift) list.scrollBy({ top: shift, behavior: "instant" });
    },
    [store, toggleFocusDay],
  );
  const editDay = useCallback((day: number) => setEditing(true, day), [setEditing]);
  if (!plan.days.length) {
    return (
      <div className="empty">
        <Icon name="route" />
        <p>{t.labels.no_plan}</p>
        <Button
          icon="pencil"
          aria-controls={PLAN_EDITOR_ID}
          data-edit-day=""
          onPointerEnter={preloadPlanEditor}
          onFocus={preloadPlanEditor}
          onClick={() => setEditing(true)}
        >
          {t.t("edit_plan")}
        </Button>
      </div>
    );
  }
  return (
    <>
      {plan.days.map((day) => (
        <DayBlock
          key={day.day}
          model={model}
          t={t}
          day={day}
          open={focusDay === day.day}
          hidden={hidden}
          selected={selected}
          onToggle={toggleDay}
          onEdit={editDay}
          onOpen={openCard}
        />
      ))}
      <UnplacedList
        model={model}
        t={t}
        items={plan.unplaced}
        hidden={hidden}
        selected={selected}
        open={unplacedOpen}
        onOpenChange={onUnplacedOpenChange}
        onOpen={openCard}
      />
    </>
  );
}
