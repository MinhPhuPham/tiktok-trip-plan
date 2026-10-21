/** Port of clock.py and routing/windows.py: opening hours, best-time ranges, distances. */
import { pad2, toMin } from "../../../lib/format";
import { DAY_MINUTES, DETOUR_FACTOR, EARTH_RADIUS_KM, EST_SPEED_KMH, SECTORS_8 } from "./constants";
import type { HoursLike, OpeningPeriodLike, Point } from "./types";

export type Interval = [number, number];

/** The export's "HH:MM" as minutes; NaN (not null) for anything else, so a bad time fails every check. */
export const toMinutes = (hhmm: string): number => toMin(hhmm) ?? Number.NaN;

export function toHHMM(minutes: number): string {
  const value = Math.max(0, Math.round(minutes));
  return `${pad2(Math.floor(value / 60))}:${pad2(value % 60)}`;
}

function merge(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter(([lo, hi]) => lo <= hi).toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Interval[] = [];
  for (const [lo, hi] of sorted) {
    const last = merged[merged.length - 1];
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }
  return merged;
}

export function hoursPeriods(hours: HoursLike | null | undefined): readonly OpeningPeriodLike[] | null {
  if (!hours) return null;
  if (Array.isArray(hours)) return hours as readonly OpeningPeriodLike[];
  const periods = (hours as { periods?: readonly OpeningPeriodLike[] | null }).periods;
  return Array.isArray(periods) ? periods : null;
}

/**
 * Union of the weekday's opening periods, cut at midnight like clock.py; null = unknown (open), [] = closed
 * that day. card/openState.ts reads the same periods as week-long spans instead, to say "closes 02:00".
 */
export function openingIntervals(hours: HoursLike | null | undefined, weekday: number): Interval[] | null {
  const periods = hoursPeriods(hours);
  if (!periods || !periods.length) return null;
  const only = periods[0];
  if (periods.length === 1 && only && only.close == null && only.open === "00:00") return [[0, DAY_MINUTES]];
  const found: Interval[] = [];
  for (const period of periods) {
    const start = toMinutes(period.open);
    const end = period.close == null ? DAY_MINUTES : toMinutes(period.close);
    const overnight = period.close != null && end <= start;
    if (period.day === weekday) found.push([start, overnight ? DAY_MINUTES : end]);
    else if (overnight && (period.day + 1) % 7 === weekday) found.push([0, end]);
  }
  return merge(found);
}

export interface OpeningFit {
  arrive: number | null;
  closedDay: boolean;
}

/** First start at or after `earliest` that fits the whole visit. */
export function openingFit(
  hours: HoursLike | null | undefined,
  weekday: number,
  earliest: number,
  service: number,
): OpeningFit {
  const intervals = openingIntervals(hours, weekday);
  if (intervals === null) return { arrive: earliest, closedDay: false };
  for (const [lo, hi] of intervals) {
    const start = Math.max(earliest, lo);
    if (start + service <= hi) return { arrive: start, closedDay: false };
  }
  return { arrive: null, closedDay: intervals.length === 0 };
}

const RANGE_RE = /(\d{1,2})(?:[:hH.](\d{2}))?\s*[hH]?\s*(?:[–—-]|to)\s*(\d{1,2})(?:[:hH.](\d{2}))?/;

export function parseHourRange(text: string | null | undefined): Interval | null {
  if (!text) return null;
  const match = RANGE_RE.exec(text);
  if (!match) return null;
  const [, h1, m1, h2, m2] = match;
  const start = Number(h1) * 60 + Number(m1 || 0);
  let end = Number(h2) * 60 + Number(m2 || 0);
  if (start >= DAY_MINUTES || end > DAY_MINUTES) return null;
  if (end <= start) end = DAY_MINUTES;
  return [start, end];
}

export function sectorGap(a: string, b: string): number | null {
  const ia = SECTORS_8.indexOf(a as (typeof SECTORS_8)[number]);
  const ib = SECTORS_8.indexOf(b as (typeof SECTORS_8)[number]);
  if (ia < 0 || ib < 0) return null;
  const gap = Math.abs(ia * 45 - ib * 45) % 360;
  return Math.min(gap, 360 - gap);
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const p1 = lat1 * rad;
  const p2 = lat2 * rad;
  const dp = p2 - p1;
  const dl = (lng2 - lng1) * rad;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Same as routing/travel.py estimate (18 km/h, x1.3 detour), ceiled like TravelMatrix.build. */
export function estimateMinutes(a: Point, b: Point, speedKmh?: number): number {
  const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
  return Math.ceil(((km * DETOUR_FACTOR) / (speedKmh || EST_SPEED_KMH)) * 60 - 1e-9);
}
