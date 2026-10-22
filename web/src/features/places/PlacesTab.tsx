import { useMemo } from "react";
import { DOM_IDS, focusById } from "../../app/ids";
import { useListedPlaces, useRanked, useTripModel } from "../../data/hooks";
import { filtersActive } from "../../data/filters";
import { useT } from "../../i18n/useT";
import type { Translator } from "../../i18n/translator";
import { useFilters, useHiddenIds, useTripActions, useTripStore } from "../../state/hooks";
import { useRowHover } from "../../state/useRowHover";
import type { TripState } from "../../state/store";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { FilterPanel } from "./FilterPanel";
import { hiddenCount } from "./options";
import { PlaceList } from "./PlaceList";
import { SearchBox } from "./SearchBox";
import { useStickySearch } from "./useStickySearch";
import "./places.css";

const selectShowHidden = (s: TripState) => s.showHidden;

/** Reset clears every filter; its button disappears, so focus moves to the search box. */
function useResetFilters(): () => void {
  const { resetFilters } = useTripActions();
  return () => {
    resetFilters();
    focusById(DOM_IDS.search);
  };
}

export function PlacesTab() {
  const t = useT();
  const places = useListedPlaces();
  const ranked = useRanked();
  const rowHover = useRowHover();
  const { box, searchMark, resultsMark, revealResults } = useStickySearch();
  return (
    <div ref={box} className="places">
      <div ref={searchMark} className="stuck-mark" aria-hidden="true" />
      <div className="places-search">
        <SearchBox onSearch={revealResults} />
      </div>
      <FilterPanel />
      <div ref={resultsMark} className="stuck-mark results-mark" aria-hidden="true" />
      <ResultBar t={t} shown={places.length} />
      {places.length ? (
        <div {...rowHover}>
          <PlaceList t={t} places={places} grouped={!ranked} />
        </div>
      ) : (
        <NoResults t={t} />
      )}
    </div>
  );
}

function ResultBar({ t, shown }: { t: Translator; shown: number }) {
  const model = useTripModel();
  const hidden = useHiddenIds();
  const filters = useFilters();
  const showHidden = useTripStore(selectShowHidden);
  const { setShowHidden } = useTripActions();
  const resetFilters = useResetFilters();
  const hiddenPlaces = useMemo(() => hiddenCount(model, hidden), [model, hidden]);
  const total = model.places.length;
  return (
    <div className="result-bar">
      <span className="num" aria-live="polite">
        {hiddenPlaces
          ? t.t("count_hidden", { shown, total, n: hiddenPlaces })
          : t.t("count", { shown, total })}
      </span>
      <span className="result-actions">
        {hiddenPlaces ? (
          <button type="button" className="linkish" onClick={() => setShowHidden(!showHidden)}>
            {t.t(showHidden ? "hide_hidden_places" : "show_hidden_places")}
          </button>
        ) : null}
        {filtersActive(filters) ? (
          <button type="button" className="linkish" onClick={resetFilters}>
            {t.t("reset")}
          </button>
        ) : null}
      </span>
    </div>
  );
}

function NoResults({ t }: { t: Translator }) {
  const resetFilters = useResetFilters();
  return (
    <div className="empty">
      <Icon name="compass" />
      <p>{t.t("no_results")}</p>
      <Button onClick={resetFilters}>{t.t("clear_filters")}</Button>
    </div>
  );
}
