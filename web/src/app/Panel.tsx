import { Activity } from "react";
import { PeekNext } from "../features/plan/PeekNext";
import { PlanTab } from "../features/plan/PlanTab";
import { PlacesTab } from "../features/places/PlacesTab";
import { useT } from "../i18n/useT";
import { usePhone, useSheet, useTab, useTripActions } from "../state/hooks";
import { BottomSheet } from "../ui/BottomSheet";
import { DOM_IDS } from "./ids";
import { PanelFooter } from "./PanelFooter";
import { PanelHeader } from "./PanelHeader";
import { PanelTabs } from "./PanelTabs";

const head = (
  <>
    <PanelHeader />
    <PanelTabs />
  </>
);

export function Panel() {
  const t = useT();
  const tab = useTab();
  const phone = usePhone();
  const detent = useSheet();
  const { setSheet, toggleSheet } = useTripActions();
  const toggleLabel = detent === "peek" ? t.t("show_list") : `${t.t("hide_list")}, ${t.t(`sheet_height_${detent}`)}`;
  return (
    <BottomSheet
      id={DOM_IDS.panel}
      handleId={DOM_IDS.sheetToggle}
      bodyId={DOM_IDS.panelBody}
      phone={phone}
      detent={detent}
      onDetentChange={setSheet}
      onToggle={toggleSheet}
      toggleLabel={toggleLabel}
      status={t.t(`sheet_${detent}`)}
      peek={<PeekNext />}
      head={head}
    >
      <Activity mode={tab === "plan" ? "visible" : "hidden"}>
        <section role="tabpanel" id={DOM_IDS.viewPlan} aria-labelledby={DOM_IDS.tabPlan}>
          <PlanTab />
        </section>
      </Activity>
      <Activity mode={tab === "places" ? "visible" : "hidden"}>
        <section role="tabpanel" id={DOM_IDS.viewPlaces} aria-labelledby={DOM_IDS.tabPlaces}>
          <PlacesTab />
        </section>
      </Activity>
      <PanelFooter />
    </BottomSheet>
  );
}
