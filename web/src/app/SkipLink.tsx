import type { MouseEvent } from "react";
import { useT } from "../i18n/useT";
import { useTripActions, useTripStoreApi } from "../state/hooks";
import { DOM_IDS, focusById } from "./ids";

export function SkipLink() {
  const t = useT();
  const store = useTripStoreApi();
  const { setSheetOpen } = useTripActions();
  const skip = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (store.getState().phone) setSheetOpen(false);
    focusById(DOM_IDS.map);
  };
  return (
    <a className="skip-link" href={`#${DOM_IDS.map}`} onClick={skip}>
      {t.t("skip_to_map")}
    </a>
  );
}
