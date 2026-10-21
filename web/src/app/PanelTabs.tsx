import { useRef, type KeyboardEvent } from "react";
import { useTripModel, useTripPlan } from "../data/hooks";
import { useT } from "../i18n/useT";
import { useTab, useTripActions } from "../state/hooks";
import type { Tab } from "../state/store";
import { DOM_IDS } from "./ids";

const TABS: readonly { tab: Tab; id: string; panel: string; label: string }[] = [
  { tab: "plan", id: DOM_IDS.tabPlan, panel: DOM_IDS.viewPlan, label: "plan" },
  { tab: "places", id: DOM_IDS.tabPlaces, panel: DOM_IDS.viewPlaces, label: "places" },
];

export function PanelTabs() {
  const t = useT();
  const tab = useTab();
  const { setTab } = useTripActions();
  const { places } = useTripModel();
  const plan = useTripPlan();
  const list = useRef<HTMLDivElement>(null);
  const counts: Record<Tab, string> = { plan: plan.days.length ? String(plan.days.length) : "", places: String(places.length) };

  const select = (next: Tab, focus: boolean) => {
    setTab(next);
    const body = document.getElementById(DOM_IDS.panelBody);
    if (body) body.scrollTop = 0;
    if (focus) list.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((item) => item.tab === tab);
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    const target =
      event.key === "Home" ? TABS[0] : event.key === "End" ? TABS[TABS.length - 1] : step ? TABS[(index + step + TABS.length) % TABS.length] : null;
    if (!target) return;
    event.preventDefault();
    select(target.tab, true);
  };

  return (
    <div ref={list} className="tabs" role="tablist" aria-label={`${t.t("plan")} / ${t.t("places")}`} onKeyDown={onKeyDown}>
      {TABS.map((item) => {
        const selected = item.tab === tab;
        return (
          <button
            key={item.tab}
            className="tab"
            role="tab"
            type="button"
            id={item.id}
            data-tab={item.tab}
            aria-controls={item.panel}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => select(item.tab, false)}
          >
            <span>{t.t(item.label)}</span>
            <span className="count num">{counts[item.tab]}</span>
          </button>
        );
      })}
    </div>
  );
}
