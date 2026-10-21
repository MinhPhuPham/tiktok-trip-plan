import { useId, useMemo } from "react";
import { advancedFilterCount } from "../../data/filters";
import { useTripModel, useTripPlan } from "../../data/hooks";
import { PRIORITY_STARS } from "../../data/priority";
import type { Translator } from "../../i18n/translator";
import { useT } from "../../i18n/useT";
import { useFilters, useHiddenIds, useTripActions, useTripStore } from "../../state/hooks";
import type { Filters, TripState } from "../../state/store";
import { Chip } from "../../ui/Chip";
import { Icon } from "../../ui/Icon";
import { Segmented, type SegmentedOption } from "../../ui/Segmented";
import { CompassPicker } from "./CompassPicker";
import { SearchBox } from "./SearchBox";
import { priorityChip, priorityLevels, tagCounts } from "./options";

const selectFiltersOpen = (s: TripState) => s.filtersOpen;

export function FilterPanel() {
  const t = useT();
  const filters = useFilters();
  const open = useTripStore(selectFiltersOpen);
  const { setFiltersOpen } = useTripActions();
  const moreId = useId();
  const active = advancedFilterCount(filters);
  return (
    <div className="filters">
      <SearchBox />
      <DayFilter t={t} day={filters.day} />
      <button
        type="button"
        className="disclosure"
        aria-expanded={open}
        aria-controls={moreId}
        onClick={() => setFiltersOpen(!open)}
      >
        <span>{t.t("filters")}</span>
        <span className="disclosure-n num">{active || ""}</span>
        <Icon name="chevron" className="icon chev" />
      </button>
      <div className="more-filters" id={moreId} hidden={!open}>
        <MoreFilters t={t} filters={filters} />
      </div>
    </div>
  );
}

function DayFilter({ t, day }: { t: Translator; day: string }) {
  const plan = useTripPlan();
  const { setDayFilter } = useTripActions();
  const labelId = useId();
  const options: SegmentedOption<string>[] = [
    { value: "all", label: t.t("all") },
    ...plan.days.map((d) => ({ value: String(d.day), label: t.dayName(d.day) })),
  ];
  if (plan.days.length) options.push({ value: "none", label: t.t("not_planned") });
  return (
    <div>
      <p className="f-label" id={labelId}>
        {t.t("day")}
      </p>
      <Segmented options={options} value={day} onChange={setDayFilter} aria-labelledby={labelId} wrap />
    </div>
  );
}

function MoreFilters({ t, filters }: { t: Translator; filters: Filters }) {
  const model = useTripModel();
  const hidden = useHiddenIds();
  const { toggleFilter } = useTripActions();
  const ids = { dir: useId(), prio: useId(), cat: useId(), tag: useId() };
  const levels = useMemo(() => priorityLevels(model), [model]);
  const cats = model.presentCategories;
  const tags = useMemo(() => tagCounts(model, hidden, t), [model, hidden, t]);
  return (
    <>
      <div className="f-row">
        <div>
          <p className="f-label" id={ids.dir}>
            {t.t("direction")}
          </p>
          <CompassPicker t={t} selected={filters.sectors} labelId={ids.dir} />
        </div>
        <div>
          <p className="f-label" id={ids.prio}>
            {t.t("priority")}
          </p>
          <div className="chips stack" role="group" aria-labelledby={ids.prio}>
            {levels.map((level) => {
              const key = level ?? "none";
              return (
                <Chip key={key} pressed={filters.priorities.has(key)} onToggle={() => toggleFilter("priorities", key)}>
                  {level ? (
                    <span className="stars" aria-hidden="true">
                      {PRIORITY_STARS[level]}
                    </span>
                  ) : null}
                  {level ? priorityChip(t, level) : t.t("unrated")}
                </Chip>
              );
            })}
          </div>
        </div>
      </div>
      <div>
        <p className="f-label" id={ids.cat}>
          {t.t("category")}
        </p>
        <div className="chips" role="group" aria-labelledby={ids.cat}>
          {cats.map((category) => (
            <Chip
              key={category}
              icon={category}
              pressed={filters.categories.has(category)}
              onToggle={() => toggleFilter("categories", category)}
            >
              {t.category(category)}
            </Chip>
          ))}
        </div>
      </div>
      {tags.length ? (
        <div>
          <p className="f-label" id={ids.tag}>
            {t.t("tags")}
          </p>
          <div className="chips" role="group" aria-labelledby={ids.tag}>
            {tags.map(([tag, n]) => (
              <Chip key={tag} count={n} pressed={filters.tags.has(tag)} onToggle={() => toggleFilter("tags", tag)}>
                {t.tag(tag)}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
