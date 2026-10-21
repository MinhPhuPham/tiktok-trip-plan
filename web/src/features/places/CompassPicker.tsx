import { useTripModel } from "../../data/hooks";
import { COMPASS_GRID, UNASSIGNED } from "../../data/types";
import type { Translator } from "../../i18n/translator";
import { cssVars } from "../../lib/css";
import { useTripActions } from "../../state/hooks";
import { Chip } from "../../ui/Chip";
import { Icon } from "../../ui/Icon";

interface CompassPickerProps {
  t: Translator;
  selected: ReadonlySet<string>;
  labelId: string;
}

/** Eight direction toggles around an "all directions" hub, plus "No direction" when some place has none. */
export function CompassPicker({ t, selected, labelId }: CompassPickerProps) {
  const model = useTripModel();
  const { toggleFilter, clearFilter } = useTripActions();
  const allLabel = t.t("all_directions");
  return (
    <>
      <div className="compass" role="group" aria-labelledby={labelId}>
        {COMPASS_GRID.map((sector) => {
          if (sector == null) {
            return (
              <button
                key="hub"
                type="button"
                className="hub"
                aria-pressed={selected.size === 0}
                aria-label={allLabel}
                title={allLabel}
                onClick={() => clearFilter("sectors")}
              >
                <Icon name="home" />
              </button>
            );
          }
          const name = t.directionName(sector);
          const enabled = model.sectorIds.includes(sector) && model.presentSectors.has(sector);
          return (
            <button
              key={sector}
              type="button"
              aria-pressed={selected.has(sector)}
              disabled={!enabled}
              aria-label={`${sector} – ${name}`}
              title={name}
              style={cssVars({ "--c": model.sectorColor(sector), "--ink": model.sectorInk(sector) })}
              onClick={() => toggleFilter("sectors", sector)}
            >
              {sector}
            </button>
          );
        })}
      </div>
      {model.presentSectors.has(UNASSIGNED) ? (
        <div className="chips no-dir">
          <Chip pressed={selected.has(UNASSIGNED)} onToggle={() => toggleFilter("sectors", UNASSIGNED)}>
            {t.labels.no_direction}
          </Chip>
        </div>
      ) : null}
    </>
  );
}
