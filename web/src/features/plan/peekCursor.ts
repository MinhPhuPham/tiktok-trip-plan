import { dayVisits, legMinutesTo, type PeekStart } from "../../data/stops";
import type { TripDay, TripStop } from "../../data/types";
import type { Step } from "../../lib/swipe";

/**
 * Where the peek row's arrows moved to among the visits of the start stop's day. It belongs to the
 * stop it started from: when the start changes (clock, open day, plan edit) the peek goes back to it.
 */
export interface PeekBrowse {
  base: TripStop;
  index: number;
  step: Step;
}

export interface PeekView {
  day: TripDay;
  /** The day's visits the cursor moves over. */
  visits: readonly TripStop[];
  stop: TripStop;
  index: number;
  /** The shown stop is the next stop by the clock (dated trip, today), labelled "Next". */
  isNext: boolean;
  /** The arrows (or a swipe) moved the cursor, even when it came back to the start. */
  browsing: boolean;
  step: Step | null;
  legMinutes: number | null;
}

export function peekView(start: PeekStart, browse: PeekBrowse | null): PeekView {
  const visits = dayVisits(start.day);
  const first = Math.max(0, visits.indexOf(start.stop));
  const active = browse && browse.base === start.stop ? browse : null;
  const index = active ? Math.min(Math.max(active.index, 0), visits.length - 1) : first;
  const stop = visits[index] ?? start.stop;
  return {
    day: start.day,
    visits,
    stop,
    index,
    isNext: start.live && index === first,
    browsing: active != null,
    step: active?.step ?? null,
    legMinutes: legMinutesTo(start.day, stop),
  };
}

/** The visit one step away, or null past the first or last (no wrap). */
export const neighbour = (view: PeekView, step: Step): TripStop | null => view.visits[view.index + step] ?? null;

export function stepPeek(view: PeekView, start: PeekStart, step: Step): PeekBrowse | null {
  return neighbour(view, step) ? { base: start.stop, index: view.index + step, step } : null;
}
