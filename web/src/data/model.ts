import { inkFor, isInkColor, safeColor } from "../lib/color";
import { fold } from "../lib/format";
import { DEFAULT_CATEGORY_COLORS, DEFAULT_CATEGORY_INK } from "./palette";
import { priorityRank } from "./priority";
import {
  CATEGORY_ORDER,
  CENTER_REF,
  categoryId,
  UNASSIGNED,
  type CategoryId,
  type MapCenter,
  type MapNearby,
  type MapPlace,
  type MapRhythmSlot,
  type MediaItem,
  type TripData,
} from "./types";

export type Target =
  | { type: "place"; id: string; item: MapPlace }
  | { type: "nearby"; id: string; item: MapNearby }
  | { type: "center"; id: typeof CENTER_REF; item: MapCenter };

/** Immutable lookups over the export, built once per load. */
export interface TripModel {
  data: TripData;
  /** Places by priority, then distance from the center, then name. */
  places: readonly MapPlace[];
  placeById: ReadonlyMap<string, MapPlace>;
  nearbyById: ReadonlyMap<string, MapNearby>;
  /** Folded name, address, dishes and tag names in every language, for search. */
  searchText: ReadonlyMap<string, string>;
  /** Categories some place has, in CATEGORY_ORDER. */
  presentCategories: readonly CategoryId[];
  rhythm: ReadonlyMap<string, MapRhythmSlot>;
  media: Readonly<Record<string, readonly MediaItem[]>>;
  langs: readonly string[];
  sectorColor: (sector: string | null | undefined) => string;
  sectorInk: (sector: string | null | undefined) => string;
  /** Pin fill of a place category (unknown categories as "other"). */
  categoryColor: (category: string) => string;
  categoryInk: (category: string) => string;
  defaultDayColor: (day: number) => string;
  /** Text colour on a day colour: the export's day_ink for its palette, else computed. */
  dayInk: (color: string) => string;
  target: (id: string | null | undefined) => Target | null;
}

/** Exports written before the category palette lack these fields. */
type CategoryPalette = Partial<Pick<TripData, "category_colors" | "category_ink">>;

function categoryLookups({ category_colors: colors = {}, category_ink: inks = {} }: CategoryPalette) {
  const categoryColor = (category: string): string => {
    const id = categoryId(category);
    return safeColor(colors[id] ?? DEFAULT_CATEGORY_COLORS[id]);
  };
  const categoryInk = (category: string): string => {
    const id = categoryId(category);
    const ink = colors[id] ? inks[id] : DEFAULT_CATEGORY_INK[id];
    return isInkColor(ink) ? ink : inkFor(categoryColor(id));
  };
  return { categoryColor, categoryInk };
}

function comparePlaces(a: MapPlace, b: MapPlace): number {
  return (
    priorityRank(a.priority) - priorityRank(b.priority) ||
    (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9) ||
    a.name.localeCompare(b.name)
  );
}

export function buildTripModel(data: TripData): TripModel {
  const places = data.places.toSorted(comparePlaces);
  const placeById = new Map(places.map((p) => [p.id, p]));
  const nearbyById = new Map(data.nearby.map((s) => [s.id, s]));
  const allLabels = Object.values(data.labels);
  const searchText = new Map(
    places.map((p) => {
      const tags = allLabels.flatMap((labels) => p.tags.map((tag) => labels.tags[tag] ?? tag));
      return [p.id, fold([p.name, p.address, p.must_try.join(" "), tags.join(" ")].join(" "))];
    }),
  );
  const colors = data.sector_colors;
  const sectorColor = (sector: string | null | undefined): string =>
    safeColor(colors[sector ?? UNASSIGNED] ?? colors[UNASSIGNED]);
  const sectorInk = (sector: string | null | undefined): string => {
    const ink = data.sector_ink[sector ?? UNASSIGNED];
    return isInkColor(ink) ? ink : inkFor(sectorColor(sector));
  };
  const { categoryColor, categoryInk } = categoryLookups(data);
  const dayColors = data.day_colors.length ? data.day_colors : ["#0072B2"];
  const defaultDayColor = (day: number): string =>
    safeColor(dayColors[(((day - 1) % dayColors.length) + dayColors.length) % dayColors.length]);
  const inkByDayColor = new Map(
    data.day_colors.flatMap((color, i) => {
      const ink = data.day_ink[i];
      return isInkColor(ink) ? [[color.toLowerCase(), ink] as const] : [];
    }),
  );
  const dayInk = (color: string): string => inkByDayColor.get(color.toLowerCase()) ?? inkFor(color);
  const target = (id: string | null | undefined): Target | null => {
    if (!id) return null;
    if (id === CENTER_REF) return data.center ? { type: "center", id: CENTER_REF, item: data.center } : null;
    const place = placeById.get(id);
    if (place) return { type: "place", id, item: place };
    const spot = nearbyById.get(id);
    return spot ? { type: "nearby", id, item: spot } : null;
  };
  return {
    data,
    places,
    placeById,
    nearbyById,
    searchText,
    presentCategories: CATEGORY_ORDER.filter((category) => places.some((p) => p.category === category)),
    rhythm: new Map(data.config.rhythm.map((slot) => [slot.id, slot])),
    media: data.media,
    langs: Object.keys(data.labels),
    sectorColor,
    sectorInk,
    categoryColor,
    categoryInk,
    defaultDayColor,
    dayInk,
    target,
  };
}
