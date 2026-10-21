import { useId, type ReactNode } from "react";
import { DOM_IDS } from "../../app/ids";
import type { TripModel } from "../../data/model";
import { dayColorOf, directionsTo } from "../../data/plan";
import type { MapPlace, TripPlan } from "../../data/types";
import type { Translator } from "../../i18n/translator";
import { cssVars } from "../../lib/css";
import { fold, km } from "../../lib/format";
import { Button } from "../../ui/Button";
import { ExternalLink } from "../../ui/ExternalLink";
import { MediaGallery } from "./MediaGallery";
import { openState } from "./openState";

const MAX_DISHES = 3;

/** Up to three dishes, duplicates (ignoring accents and case) dropped. */
export function mustTry(dishes: readonly string[]): string[] {
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const dish of dishes) {
    const key = fold(dish).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    picked.push(dish.trim());
    if (picked.length === MAX_DISHES) break;
  }
  return picked;
}

interface PlaceDetailsProps {
  model: TripModel;
  plan: TripPlan;
  t: Translator;
  place: MapPlace;
  hidden: boolean;
  now: Date;
  photosExpanded: boolean;
  onExpandPhotos: () => void;
  onToggleHidden: () => void;
}

export function PlaceDetails({
  model,
  plan,
  t,
  place,
  hidden,
  now,
  photosExpanded,
  onExpandPhotos,
  onToggleHidden,
}: PlaceDetailsProps) {
  const hintId = useId();
  const slot = plan.placeSlots.get(place.id);
  const meta = [t.category(place.category), t.directionName(place.sector), km(place.distance_km)].filter(Boolean).join(" · ");
  const dishes = mustTry(place.must_try);
  return (
    <>
      <div className="card-top">
        {place.stars ? (
          <span className="stars" aria-hidden="true">
            {place.stars}
          </span>
        ) : null}
        {place.priority === "must" ? (
          <span className="badge-must">{t.t("must_go")}</span>
        ) : (
          <span>{place.priority ? t.priority(place.priority) : t.t("unrated")}</span>
        )}
        {slot ? (
          <span className="card-plan num">
            <span className="swatch" style={cssVars({ "--d": dayColorOf(model, plan, slot.day) })} />
            {slot.stop != null ? t.t("day_stop", { day: t.dayName(slot.day), n: slot.stop }) : t.dayName(slot.day)}
          </span>
        ) : null}
        {hidden ? <span className="badge-hidden">{t.t("hidden_badge")}</span> : null}
      </div>
      <h2 className="card-title" id={DOM_IDS.cardTitle} tabIndex={-1}>
        {place.name}
      </h2>
      <p className="card-meta num">{meta}</p>
      <dl>
        <Row label={t.t("hours")}>{hoursContent(t, place, now)}</Row>
        <Row label={t.labels.best_time}>{bestTimeContent(t, place)}</Row>
        <Row label={t.t("price")}>{place.price || null}</Row>
        <Row label={t.t("rating")}>
          {place.rating != null ? (
            <span className="num">
              {place.rating_count
                ? t.t("rating_value", { rating: place.rating.toFixed(1), n: place.rating_count.toLocaleString(t.lang) })
                : place.rating.toFixed(1)}
            </span>
          ) : null}
        </Row>
      </dl>
      {place.tags.length ? (
        <ul className="tags" aria-label={t.labels.tags_title}>
          {place.tags.map((tag) => (
            <li key={tag}>{t.labels.tags[tag] ?? tag.replace(/_/g, " ")}</li>
          ))}
        </ul>
      ) : null}
      {dishes.length ? (
        <div className="card-dishes">
          <p className="card-label">{t.t("must_try")}</p>
          <ul className="tags dishes">
            {dishes.map((dish) => (
              <li key={dish}>{dish}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <MediaGallery
        key={place.id}
        t={t}
        placeName={place.name}
        items={model.media[place.id] ?? []}
        expanded={photosExpanded}
        onExpand={onExpandPhotos}
      />
      {place.address ? <p className="card-address">{place.address}</p> : null}
      <div className="card-actions">
        <ExternalLink href={place.maps_url} variant="primary" icon="external">
          {t.t("open_maps")}
        </ExternalLink>
        <ExternalLink href={directionsTo(place.lat, place.lng, model.data.config.travelmode)} variant="ghost" icon="route">
          {t.labels.directions_link}
        </ExternalLink>
        {place.videos.map((url, index) => (
          <ExternalLink key={url} href={url} variant="ghost" icon="play">
            {t.t("video", { n: index + 1 })}
          </ExternalLink>
        ))}
      </div>
      <div className="card-foot">
        <Button variant="ghost" icon={hidden ? "eye" : "eye-off"} aria-describedby={hintId} onClick={onToggleHidden}>
          {t.t(hidden ? "show_in_list" : "hide_from_list")}
        </Button>
        <p className="card-hint" id={hintId}>
          {t.t("hide_hint")}
        </p>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children == null || children === false) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function hoursContent(t: Translator, place: MapPlace, now: Date): ReactNode {
  const text = t.pick(place.hours.en, place.hours.vi);
  const open = openState(t, place.hours.periods, now);
  if (!text && !open) return null;
  return (
    <span>
      {open ? <strong className={open.open ? "open-state is-open" : "open-state"}>{open.text}</strong> : null}
      {text ? <span className={open ? "why num" : "num"}>{text}</span> : null}
    </span>
  );
}

function bestTimeContent(t: Translator, place: MapPlace): ReactNode {
  const best = t.months(t.loc(place.best));
  if (!best) return null;
  const why = t.loc(place.best_why);
  const source =
    place.best_source === "heuristic"
      ? t.t("estimate")
      : place.best_source
        ? t.t("from_source", { source: t.t(`source_${place.best_source}`) })
        : "";
  return (
    <span>
      <span className="num">{best}</span>
      {source ? <span className="soft"> ({source})</span> : null}
      {why ? <span className="why">{why}</span> : null}
    </span>
  );
}
