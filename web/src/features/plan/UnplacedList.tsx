import type { TripModel } from "../../data/model";
import { pinSize } from "../../data/priority";
import type { PlanUnplaced } from "../../data/types";
import type { Translator } from "../../i18n/translator";
import { cssVars } from "../../lib/css";
import { Icon } from "../../ui/Icon";
import { PlaceStars } from "../../ui/PlaceStars";
import { unplacedReason } from "./unplaced";

interface UnplacedListProps {
  model: TripModel;
  t: Translator;
  items: readonly PlanUnplaced[];
  hidden: ReadonlySet<string>;
  selected: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: (id: string) => void;
}

/** "Not planned": places the plan left out, each with the planner's reason. */
export function UnplacedList({ model, t, items, hidden, selected, open, onOpenChange, onOpen }: UnplacedListProps) {
  if (!items.length) return null;
  return (
    <details className="unplaced" open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}>
      <summary>
        {t.t("not_planned")}
        <span className="count num">{items.length}</span>
        <Icon name="chevron" className="icon chev" />
      </summary>
      <ul className="place-list">
        {items.map((item) => (
          <UnplacedRow key={item.ref} model={model} t={t} item={item} hidden={hidden} selected={item.ref === selected} onOpen={onOpen} />
        ))}
      </ul>
    </details>
  );
}

interface UnplacedRowProps {
  model: TripModel;
  t: Translator;
  item: PlanUnplaced;
  hidden: ReadonlySet<string>;
  selected: boolean;
  onOpen: (id: string) => void;
}

function UnplacedRow({ model, t, item, hidden, selected, onOpen }: UnplacedRowProps) {
  const place = model.placeById.get(item.ref) ?? null;
  const name = place?.name ?? model.nearbyById.get(item.ref)?.name ?? (item.name || item.ref);
  const why = unplacedReason(t, item);
  const size = place ? `${pinSize(place.priority) / 2}px` : "";
  const isHidden = place != null && hidden.has(place.id);
  return (
    <li className={isHidden ? "is-hidden" : undefined}>
      <button
        type="button"
        className="row-btn"
        disabled={!model.target(item.ref)}
        aria-current={selected ? "true" : undefined}
        data-hover-id={isHidden || !model.target(item.ref) ? undefined : item.ref}
        onClick={() => onOpen(item.ref)}
      >
        <span className="row-pin" aria-hidden="true">
          {place ? (
            <span style={{ ...cssVars({ "--c": model.categoryColor(place.category) }), width: size, height: size }} />
          ) : null}
        </span>
        <span className="row-text">
          <span className="row-name">
            <PlaceStars place={place} t={t} />
            {name}
          </span>
          {why ? <span className="row-sub wrap">{why}</span> : null}
        </span>
        <span />
      </button>
    </li>
  );
}
