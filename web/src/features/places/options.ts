import type { TripModel } from "../../data/model";
import { PRIORITY_ORDER, UNASSIGNED, type MapPlace, type Priority } from "../../data/types";
import type { Translator } from "../../i18n/translator";
import { km } from "../../lib/format";

/** Priority levels some place has, null for unrated. */
export const priorityLevels = (model: TripModel): (Priority | null)[] =>
  PRIORITY_ORDER.filter((level) => model.places.some((p) => p.priority === level));

/** Tags of the places not hidden, in label order, with how many places carry each. */
export function tagCounts(model: TripModel, hidden: ReadonlySet<string>, t: Translator): [string, number][] {
  const counts = new Map<string, number>();
  for (const place of model.places) {
    if (hidden.has(place.id)) continue;
    for (const tag of place.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return Object.keys(t.labels.tags).flatMap((tag) => {
    const n = counts.get(tag);
    return n ? [[tag, n] as [string, number]] : [];
  });
}

export const hiddenCount = (model: TripModel, hidden: ReadonlySet<string>): number =>
  hidden.size ? model.places.reduce((n, p) => (hidden.has(p.id) ? n + 1 : n), 0) : 0;

/** "Must go", "High priority" / "Ưu tiên cao". */
export function priorityChip(t: Translator, level: Priority): string {
  const name = t.priority(level);
  if (level === "must") return name;
  return t.t("prio_chip", { level: t.lang === "vi" ? name.toLocaleLowerCase("vi") : name });
}

/** "N · 1.2 km · Food" under a place name. */
export const placeSub = (t: Translator, place: MapPlace): string =>
  [place.sector === UNASSIGNED ? t.labels.no_direction : place.sector, km(place.distance_km), t.labels.categories[place.category]]
    .filter(Boolean)
    .join(" · ");
