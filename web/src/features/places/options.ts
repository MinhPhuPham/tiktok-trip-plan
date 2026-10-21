import type { IntentId } from "../../data/intents";
import type { TripModel } from "../../data/model";
import { PRIORITY_ORDER, UNASSIGNED, type MapPlace, type Priority, type TripPlan } from "../../data/types";
import type { Translator } from "../../i18n/translator";
import { km } from "../../lib/format";
import type { IconName } from "../../ui/IconSprite";
import type { SelectOption } from "../../ui/Select";

/** Priority levels some place has, null for unrated. */
export const priorityLevels = (model: TripModel): (Priority | null)[] =>
  PRIORITY_ORDER.filter((level) => model.places.some((p) => p.priority === level));

/** "All days", "Day 1 · 13 places" … "Not planned · 150 places" (the trigger shows the day alone). */
export function dayOptions(t: Translator, model: TripModel, plan: TripPlan): SelectOption<string>[] {
  const perDay = new Map<number, number>();
  for (const { day } of plan.placeSlots.values()) perDay.set(day, (perDay.get(day) ?? 0) + 1);
  const unplanned = model.places.length - plan.placeSlots.size;
  const option = (value: string, name: string, n: number) => ({ value, label: `${name} · ${t.t("place_count", { n })}`, short: name });
  return [
    { value: "all", label: t.t("all_days") },
    ...plan.days.map((d) => option(String(d.day), t.dayName(d.day), perDay.get(d.day) ?? 0)),
    option("none", t.t("not_planned"), unplanned),
  ];
}

/** Icons where a glyph says more than the word; meals stay text so five rows don't repeat one fork. */
export const INTENT_ICONS: Partial<Record<IntentId, IconName>> = {
  cafe: "cafe",
  sunrise: "sunrise",
  clouds: "cloud",
  sunset: "sunset",
  night: "moon",
  view: "mountain",
  photo: "camera",
  nature: "leaf",
  family: "users",
  history: "attraction",
  shopping: "bag",
};

export const hiddenCount = (model: TripModel, hidden: ReadonlySet<string>): number =>
  hidden.size ? model.places.reduce((n, p) => (hidden.has(p.id) ? n + 1 : n), 0) : 0;

/** "N · 1.2 km · Food" under a place name. */
export const placeSub = (t: Translator, place: MapPlace): string =>
  [place.sector === UNASSIGNED ? t.labels.no_direction : place.sector, km(place.distance_km), t.labels.categories[place.category]]
    .filter(Boolean)
    .join(" · ");
