/** What the editor core reads from trip.json; MapData satisfies it, test fixtures may omit fields. */

export interface OpeningPeriodLike {
  day: number;
  open: string;
  close: string | null;
}

export type HoursLike = readonly OpeningPeriodLike[] | { periods?: readonly OpeningPeriodLike[] | null };

export interface BestTimeLike {
  hours?: string | null;
  deadline?: string | null;
  source?: string | null;
}

export interface EditorPlace {
  id: string;
  name: string;
  category?: string | null;
  lat: number;
  lng: number;
  hours?: HoursLike | null;
  sector?: string | null;
  zone?: string | null;
  priority?: string | null;
  stars?: string;
  tags?: readonly string[];
  must_try?: readonly string[];
  address?: string;
  best_time?: BestTimeLike | null;
  bestTime?: BestTimeLike | null;
  best_source?: string | null;
  preference?: string | null;
  status?: string;
}

export interface EditorSpot {
  id: string;
  name: string;
  lat: number;
  lng: number;
  zone?: string | null;
  zone_id?: string | null;
}

export interface RhythmSlot {
  id: string;
  start: string;
  end: string;
  name_en: string;
  name_vi: string;
  categories?: readonly string[];
}

export interface EditorConfig {
  dayStart?: string;
  dayEnd?: string;
  rhythm?: readonly RhythmSlot[];
  serviceMinutes?: Readonly<Record<string, number>>;
  nearbyServiceMinutes?: number;
  restMinutes?: number;
  tripDays?: number;
  maxPlacesPerDay?: number | null;
  maxNearbyPerDay?: number;
  speedKmh?: number;
  dated?: boolean;
}

export interface EditorData {
  city?: string;
  center?: { lat: number; lng: number; name?: Readonly<Record<string, string>> | string } | null;
  places?: readonly EditorPlace[];
  nearby?: readonly EditorSpot[];
  travel?: { ids: readonly string[]; minutes: readonly (readonly number[])[] } | null;
  config?: EditorConfig;
  tripWeekdays?: readonly number[];
  tripDates?: readonly (string | null)[];
}

export type NodeKind = "rest" | "place" | "nearby";

export interface EditorNode {
  ref: string;
  kind: NodeKind;
  name: string;
  lat: number | null;
  lng: number | null;
  service: number;
  category: string | null;
  place?: EditorPlace;
  spot?: EditorSpot;
  sector: string | null;
  zone: string | null;
  matrixId: string;
}

export interface Point {
  lat: number;
  lng: number;
}

export interface Leg {
  min: number;
  estimated: boolean;
}

/** One stop as the plan holds it: plan.json's stop without times. */
export interface EditStop {
  ref: string;
  slot?: string | null;
  reason?: string | null;
  reason_vi?: string | null;
}

export interface EditDay {
  stops: readonly EditStop[];
}

export interface UnplacedEntry {
  ref: string;
  code?: string | null;
  reason?: string | null;
}

export type IssueLevel = "error" | "warning";
export type IssueParams = Readonly<Record<string, string | number | boolean | null>>;

export interface Issue {
  level: IssueLevel;
  rule: string;
  day: number | null;
  index: number | null;
  ref: string | null;
  params: IssueParams;
}

export type TimedKind = "start" | "end" | NodeKind;

export interface TimedStop {
  kind: TimedKind;
  ref: string | null;
  name: string;
  lat: number | null;
  lng: number | null;
  arrive: string;
  depart: string;
  arrive_min: number;
  depart_min: number;
  travel_min_to_next: number | null;
  travel_estimated?: boolean;
  slot: string | null;
  reason: string | null;
  reason_vi?: string | null;
  index: number | null;
}

export interface TimedDay {
  day: number;
  weekday: number;
  stops: TimedStop[];
  total_minutes: number;
  zone_ids: string[];
  issues: Issue[];
}

export interface ComputedPlan {
  days: TimedDay[];
  issues: Issue[];
}

/** planning/schema.py AgentPlan, as `route --collect` reads data/plan/plan.json. */
export interface PlanJsonStop {
  ref: string;
  slot: string | null;
  reason?: string;
  reason_vi?: string;
}

export interface PlanJson {
  days: { day: number; stops: PlanJsonStop[] }[];
  unplaced: { ref: string; code?: string; reason: string }[];
}
