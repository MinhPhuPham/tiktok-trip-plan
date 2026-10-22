import { useState } from "react";
import { flushSync } from "react-dom";
import { DOM_IDS, focusById } from "../../app/ids";
import { openPlaceSearch } from "../../app/openSearch";
import { usePeekFocus } from "../../app/usePeekFocus";
import { filtersActive } from "../../data/filters";
import { useShownPlaces, useTripPlan } from "../../data/hooks";
import type { Translator } from "../../i18n/translator";
import { useT } from "../../i18n/useT";
import type { Step } from "../../lib/swipe";
import { useFilters, usePhone, useSheetOpen, useTripActions, useTripStoreApi } from "../../state/hooks";
import { Icon } from "../../ui/Icon";
import { PeekSteps, usePeekStepping } from "../../ui/PeekSteps";
import { filterScope, placeCount, placeNeighbour, placePeekMeta, placesPeekView, stepPlaces, type PlacesBrowse } from "./placesCursor";

/**
 * The collapsed phone sheet's row on the Places tab: what the list holds (filters and count), a
 * search button, and ‹ › through the list as shown, lighting each place on the map; nothing on desktop.
 */
export function PlacesPeek() {
  return usePhone() ? <PlacesPeekRow /> : null;
}

function PlacesPeekRow() {
  const t = useT();
  const plan = useTripPlan();
  const list = useShownPlaces();
  const filters = useFilters();
  const { openCard, resetFilters } = useTripActions();
  const sheetOpen = useSheetOpen();
  const [browse, setBrowse] = useState<PlacesBrowse | null>(null);
  if (browse && (sheetOpen || browse.list !== list)) setBrowse(null);

  const view = placesPeekView(list, browse);
  const show = usePeekFocus(view?.browsing ? view.place.id : null, () => setBrowse(null));
  const step = (delta: Step) => {
    const moved = view && stepPlaces(list, view, delta);
    const target = moved && list[moved.index];
    if (!moved || !target) return;
    setBrowse(moved);
    show(target.id);
  };
  const stepping = usePeekStepping(step);
  const scope = filterScope(t, filters);

  if (!view) {
    const clear = () => {
      flushSync(resetFilters);
      focusById(DOM_IDS.peekMain);
    };
    return (
      <div className="peek has-search">
        <SearchButton t={t} />
        <div className="peek-main peek-empty">
          <span className="peek-text">
            <span className="peek-meta" title={scope.full}>
              <b>{scope.short}</b>
            </span>
            <span className="peek-name" role="status">
              {t.t("peek_no_match")}
            </span>
          </span>
        </div>
        {filtersActive(filters) ? (
          <button type="button" className="peek-clear" onClick={clear}>
            {t.t("clear_filters")}
          </button>
        ) : null}
      </div>
    );
  }

  const { place, index, browsing } = view;
  const lead = `${scope.short} · ${browsing ? `${index + 1}/${list.length}` : list.length}`;
  const meta = placePeekMeta(t, plan, place);
  const stepLabel = (delta: Step) => {
    const target = placeNeighbour(list, view, delta);
    const label = t.t(delta < 0 ? "peek_prev_place" : "peek_next_place");
    return target ? `${label}: ${target.name}` : label;
  };

  return (
    <div className="peek has-search" {...stepping}>
      <SearchButton t={t} />
      <button
        id={DOM_IDS.peekMain}
        className="peek-main"
        type="button"
        title={[`${scope.full} · ${placeCount(t, list.length)}`, place.name].join(": ")}
        onClick={() => openCard(place.id)}
      >
        <span key={index} className="peek-text" data-step={view.step == null ? undefined : view.step < 0 ? "prev" : "next"}>
          <span className="peek-meta num">
            <b>{lead}</b>
            {meta ? ` · ${meta}` : null}
          </span>
          <span className="peek-name">{place.name}</span>
        </span>
      </button>
      <PeekSteps label={stepLabel} enabled={(delta) => placeNeighbour(list, view, delta) != null} onStep={step} />
      <span className="sr-only" role="status">
        {browsing ? `${lead} · ${meta} ${place.name}` : ""}
      </span>
    </div>
  );
}

/** Opens the sheet at full height with the keyboard in the place search. */
function SearchButton({ t }: { t: Translator }) {
  const store = useTripStoreApi();
  const label = t.t("search");
  return (
    <button type="button" className="peek-search" aria-label={label} title={label} onClick={() => openPlaceSearch(store)}>
      <Icon name="search" />
    </button>
  );
}
