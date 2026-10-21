import type { MapData, MapLabels, MapStop, MapUnplaced } from "./trip.gen";

export type {
  Basemap,
  MapCenter,
  MapData,
  MapDay,
  MapLabels,
  MapNearby,
  MapPlace,
  MapRay,
  MapRhythmSlot,
  MapRing,
  MapStop,
  MapUnplaced,
  MediaItem,
  OpeningPeriod,
} from "./trip.gen";

export type TripData = MapData;
export type LangCode = string;
/** One display string per language code ({en, vi}). */
export type Localized = Readonly<Record<LangCode, string>>;
export type Labels = MapLabels;

export const UNASSIGNED = "UNASSIGNED";
export const CENTER_REF = "center";
export const REST_REF = "rest";
/** Stop kinds drawn at the center (and its travel-matrix node). */
export const CENTER_KINDS: ReadonlySet<string> = new Set(["start", "end", "rest"]);
export const PRIORITY_ORDER = ["must", "high", "medium", "low", null] as const;
export type Priority = Exclude<(typeof PRIORITY_ORDER)[number], null>;
export const CATEGORY_ORDER = ["food", "cafe", "attraction", "other"] as const;
export type CategoryId = (typeof CATEGORY_ORDER)[number];
const CATEGORIES: ReadonlySet<string> = new Set(CATEGORY_ORDER);
/** The category, or "other" for one this app does not know. */
export const categoryId = (category: string): CategoryId =>
  CATEGORIES.has(category) ? (category as CategoryId) : "other";

/**
 * A stop as the plan holds it: the exported MapStop, or the plan editor's output (times as
 * minutes, no names). Normalising adds the point and visit number.
 */
export type PlanStop = Partial<Omit<MapStop, "kind">> & {
  kind: string;
  arrive_min?: number | null;
  depart_min?: number | null;
};

export interface PlanDay {
  day: number;
  color?: string;
  areas?: string;
  span?: Localized;
  directions?: string[];
  stops: PlanStop[];
}

export type PlanUnplaced = MapUnplaced;

/** The plan as shown: the export's, or the one the editor produced (`edited`). */
export interface Plan {
  days: PlanDay[];
  unplaced: PlanUnplaced[];
  edited: boolean;
}

export interface TripStop extends PlanStop {
  lat: number;
  lng: number;
  /** 1-based visit number within the day; null for start, end and rest. */
  number: number | null;
}

export interface TripDay {
  day: number;
  color: string;
  ink: string;
  stops: TripStop[];
  areas: string;
  directions: string[];
  span: Localized | undefined;
}

export interface PlaceSlot {
  day: number;
  stop: number | null;
  /** The plan's rhythm slot of the visit ("breakfast", "sunrise", …). */
  slot: string | null;
}

/** The plan ready to draw: numbered days, the day each place is in, and the left-out places. */
export interface TripPlan {
  days: TripDay[];
  dayByNumber: ReadonlyMap<number, TripDay>;
  unplaced: PlanUnplaced[];
  placeSlots: ReadonlyMap<string, PlaceSlot>;
  visitCount: number;
  edited: boolean;
}

export function planFromData(data: Pick<TripData, "days" | "unplaced">): Plan {
  return { days: data.days, unplaced: data.unplaced, edited: false };
}
