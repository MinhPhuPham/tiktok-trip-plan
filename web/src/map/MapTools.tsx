import { DOM_IDS } from "../app/ids";
import { useT } from "../i18n/useT";
import { useTripActions, useTripStore } from "../state/hooks";
import type { TripState } from "../state/store";
import { Icon } from "../ui/Icon";

const selectLayersOpen = (s: TripState) => s.layersOpen;

/** Fit-all and layers buttons at the map's top right. */
export function MapTools() {
  const t = useT();
  const open = useTripStore(selectLayersOpen);
  const { requestMap, setLayersOpen } = useTripActions();
  return (
    <div className="map-tools">
      <button
        type="button"
        className="tool"
        id={DOM_IDS.fitButton}
        title={t.t("fit_all")}
        onClick={() => requestMap({ type: "fitAll", animate: true })}
      >
        <Icon name="fit" />
        <span className="sr-only">{t.t("fit_all")}</span>
      </button>
      <button
        type="button"
        className="tool"
        id={DOM_IDS.layersButton}
        title={t.t("layers")}
        aria-label={t.t("layers")}
        aria-expanded={open}
        aria-controls={DOM_IDS.layersPopover}
        onClick={(event) => {
          if (open) event.currentTarget.focus();
          setLayersOpen(!open);
        }}
      >
        <Icon name="layers" />
        <span className="label">{t.t("layers")}</span>
      </button>
    </div>
  );
}
