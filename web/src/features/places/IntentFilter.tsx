import { useMemo } from "react";
import { useIntentCounts, useTripModel } from "../../data/hooks";
import { intentIndex, type IntentId } from "../../data/intents";
import type { Translator } from "../../i18n/translator";
import { usePhone, useTripActions } from "../../state/hooks";
import { MultiSelect, type MultiOption } from "../../ui/MultiSelect";
import { INTENT_ICONS } from "./options";

interface IntentFilterProps {
  t: Translator;
  selected: ReadonlySet<string>;
}

/**
 * "Good for" (breakfast, sunrise, …) as a multi-select: each intent with the places it would list
 * under the other filters; those with none are left out unless chosen, so they can still be cleared.
 * With none left at all the trigger stays in place, disabled, so the dropdown grid does not reflow.
 */
export function IntentFilter({ t, selected }: IntentFilterProps) {
  const model = useTripModel();
  const counts = useIntentCounts();
  const phone = usePhone();
  const { toggleFilter, clearFilter } = useTripActions();
  const options = useMemo<MultiOption<IntentId>[]>(
    () =>
      intentIndex(model).available.flatMap((id) => {
        const count = counts.get(id) ?? 0;
        if (!count && !selected.has(id)) return [];
        return [{ value: id, label: t.t(`intent_${id}`), icon: INTENT_ICONS[id], count }];
      }),
    [model, counts, selected, t],
  );
  if (!intentIndex(model).available.length) return null;
  return (
    <MultiSelect
      label={t.t("intents")}
      options={options}
      selected={selected}
      onToggle={(id) => toggleFilter("intents", id)}
      onClear={() => clearFilter("intents")}
      clearLabel={t.t("intents_clear")}
      doneLabel={t.t("done")}
      sheet={phone}
    />
  );
}
