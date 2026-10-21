import { useTripModel } from "../data/hooks";
import { useT } from "../i18n/useT";
import { LanguageSwitch } from "./LanguageSwitch";

export function PanelHeader() {
  const { data, places } = useTripModel();
  const t = useT();
  const summary = [t.loc(data.summary), t.t("place_count", { n: places.length })].filter(Boolean).join(" · ");
  return (
    <header className="panel-head">
      <div className="titles">
        <h1>{data.city}</h1>
        <p className="num">{summary}</p>
      </div>
      <LanguageSwitch />
    </header>
  );
}

