import { memo } from "react";
import { pinSize } from "../../data/priority";
import type { MapPlace } from "../../data/types";
import type { Translator } from "../../i18n/translator";
import { classes, cssVars } from "../../lib/css";
import { Icon } from "../../ui/Icon";
import { PlaceStars } from "../../ui/PlaceStars";
import { placeSub } from "./options";

interface PlaceRowProps {
  place: MapPlace;
  t: Translator;
  color: string;
  hidden: boolean;
  selected: boolean;
  day: number | null;
  stop: number | null;
  dayColor: string | null;
  onOpen: (id: string) => void;
  onUnhide: (id: string) => void;
}

export const PlaceRow = memo(function PlaceRow({ place, t, color, hidden, selected, day, stop, dayColor, onOpen, onUnhide }: PlaceRowProps) {
  const size = `${pinSize(place.priority) / 2 + 2}px`;
  const sub = placeSub(t, place);
  const hours = t.pick(place.hours.en, place.hours.vi);
  return (
    <li className={classes("place-row", hidden && "is-hidden")}>
      <button
        type="button"
        className="row-btn"
        aria-current={selected ? "true" : undefined}
        data-hover-id={place.id}
        onClick={() => onOpen(place.id)}
      >
        <span className="row-pin" aria-hidden="true">
          <span style={{ ...cssVars({ "--c": color }), width: size, height: size }} />
        </span>
        <span className="row-text">
          <span className="row-name">
            <PlaceStars place={place} t={t} />
            {place.name}
            {hidden ? <span className="tag-hidden">{t.t("hidden_badge")}</span> : null}
          </span>
          <span className="row-sub num" title={sub}>
            {sub}
          </span>
          {hours ? (
            <span className="row-hours num" title={hours}>
              {hours}
            </span>
          ) : null}
        </span>
        {day != null && dayColor ? (
          <span className="row-day num">
            <i style={cssVars({ "--d": dayColor })} />
            {stop != null ? t.t("day_stop", { day: t.dayName(day), n: stop }) : t.dayName(day)}
          </span>
        ) : (
          <span />
        )}
      </button>
      {hidden ? (
        <button
          type="button"
          className="row-unhide"
          title={t.t("show_in_list")}
          aria-label={`${t.t("show_in_list")}: ${place.name}`}
          onClick={() => onUnhide(place.id)}
        >
          <Icon name="eye" />
        </button>
      ) : null}
    </li>
  );
});
