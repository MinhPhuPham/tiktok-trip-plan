import { useMemo } from "react";
import { useTripModel, useTripPlan } from "../../data/hooks";
import type { Translator } from "../../i18n/translator";
import { useT } from "../../i18n/useT";
import { useFilters, useTripActions } from "../../state/hooks";
import type { FilterSetKey } from "../../state/store";
import { Select, type SelectOption } from "../../ui/Select";
import { IntentFilter } from "./IntentFilter";
import { dayOptions, priorityLevels } from "./options";

const ALL = "all";

/** One grid of dropdowns: day, "Good for", priority and category. */
export function FilterPanel() {
  const t = useT();
  const filters = useFilters();
  return (
    <div className="filters">
      <DaySelect t={t} day={filters.day} />
      <IntentFilter t={t} selected={filters.intents} />
      <ChoiceSelect t={t} filter="priorities" label={t.t("priority")} set={filters.priorities} />
      <ChoiceSelect t={t} filter="categories" label={t.t("category")} set={filters.categories} />
    </div>
  );
}

function DaySelect({ t, day }: { t: Translator; day: string }) {
  const model = useTripModel();
  const plan = useTripPlan();
  const { setDayFilter } = useTripActions();
  const options = useMemo(() => dayOptions(t, model, plan), [t, model, plan]);
  if (!plan.days.length) return null;
  return <Select label={t.t("day")} value={day} options={options} onChange={setDayFilter} active={day !== ALL} bare />;
}

interface ChoiceSelectProps {
  t: Translator;
  filter: Extract<FilterSetKey, "priorities" | "categories">;
  label: string;
  set: ReadonlySet<string>;
}

/** A single choice written to a filter set (empty for "all"). */
function ChoiceSelect({ t, filter, label, set }: ChoiceSelectProps) {
  const model = useTripModel();
  const { chooseFilter } = useTripActions();
  const options = useMemo<SelectOption<string>[]>(() => {
    const values =
      filter === "priorities"
        ? priorityLevels(model).map((level) => ({ value: level ?? "none", label: level ? t.priority(level) : t.t("unrated") }))
        : model.presentCategories.map((c) => ({ value: c, label: t.category(c) }));
    return [{ value: ALL, label: t.t("all") }, ...values];
  }, [filter, model, t]);
  const value = set.values().next().value ?? ALL;
  const choose = (next: string) => chooseFilter(filter, next === ALL ? null : next);
  return <Select label={label} value={value} options={options} onChange={choose} active={value !== ALL} />;
}
