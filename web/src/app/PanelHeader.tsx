import { useTripModel } from "../data/hooks";
import { useT } from "../i18n/useT";
import { DOM_IDS } from "./ids";
import { LanguageSwitch } from "./LanguageSwitch";

/** City and trip summary above the tabs (desktop). */
export function PanelHeader() {
  const { data, places } = useTripModel();
  const t = useT();
  const summary = [t.loc(data.summary), t.t("place_count", { n: places.length })].filter(Boolean).join(" · ");
  return (
    <header className="panel-head">
      <div className="titles">
        <h1 id={DOM_IDS.panelTitle}>{data.city}</h1>
        <p className="num">{summary}</p>
      </div>
      <LanguageSwitch />
    </header>
  );
}

/** The phone sheet shows no title block; its heading (and the sheet's name) stays for screen readers. */
export function PanelTitle() {
  const { data } = useTripModel();
  const t = useT();
  return (
    <h1 id={DOM_IDS.panelTitle} className="sr-only">
      {[data.city, t.loc(data.summary)].filter(Boolean).join(" · ")}
    </h1>
  );
}
