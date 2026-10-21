import { useId } from "react";
import { useToggleHidden } from "../../app/useToggleHidden";
import { useTripModel, useTripPlan } from "../../data/hooks";
import { dayColorOf } from "../../data/plan";
import type { MapPlace } from "../../data/types";
import type { Translator } from "../../i18n/translator";
import { classes } from "../../lib/css";
import { useHiddenIds, useSelectedId, useTripActions } from "../../state/hooks";
import { PlaceRow } from "./PlaceRow";

interface PlaceListProps {
  t: Translator;
  places: readonly MapPlace[];
  /** Must-go places under their own heading; off while the order is by intent relevance. */
  grouped?: boolean;
}

/** Must-go places first under their own heading, then the rest; or one list in the given order. */
export function PlaceList({ t, places, grouped = true }: PlaceListProps) {
  if (!grouped) return <PlaceGroup t={t} places={places} />;
  const must = places.filter((p) => p.priority === "must");
  const rest = must.length ? places.filter((p) => p.priority !== "must") : places;
  if (!must.length) return <PlaceGroup t={t} places={rest} />;
  return (
    <>
      <PlaceGroup t={t} places={must} title={t.t("must_go")} must />
      {rest.length ? <PlaceGroup t={t} places={rest} title={t.t("other_places")} /> : null}
    </>
  );
}

interface PlaceGroupProps {
  t: Translator;
  places: readonly MapPlace[];
  title?: string;
  must?: boolean;
}

function PlaceGroup({ t, places, title, must = false }: PlaceGroupProps) {
  const model = useTripModel();
  const plan = useTripPlan();
  const hidden = useHiddenIds();
  const selected = useSelectedId();
  const { openCard } = useTripActions();
  const toggleHidden = useToggleHidden();
  const headingId = useId();
  const list = (
    <ul className="place-list" aria-labelledby={title ? headingId : undefined}>
      {places.map((place) => {
        const slot = plan.placeSlots.get(place.id);
        return (
          <PlaceRow
            key={place.id}
            place={place}
            t={t}
            color={model.categoryColor(place.category)}
            hidden={hidden.has(place.id)}
            selected={place.id === selected}
            day={slot?.day ?? null}
            stop={slot?.stop ?? null}
            dayColor={slot ? dayColorOf(model, plan, slot.day) : null}
            onOpen={openCard}
            onUnhide={toggleHidden}
          />
        );
      })}
    </ul>
  );
  if (!title) return list;
  return (
    <div className="place-group">
      <h3 className={classes("list-head", must && "must")} id={headingId}>
        {title}
        <span className="n num">{places.length}</span>
      </h3>
      {list}
    </div>
  );
}
