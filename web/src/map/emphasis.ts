import type { TripPlan } from "../data/types";
import { DIMMED_OPACITY } from "./mapCore";

export const HIDDEN_OPACITY = 0.45;

/**
 * Which markers the map draws at full strength. The open Plan tab day keeps its stops lit and a
 * hovered row adds its marker to them. With no day open there is nothing to keep, so a hovered row
 * spotlights its marker alone: everything else dims, routes, stop chips and other clusters too.
 */
export interface MapEmphasis {
  /** The hovered row's marker while the map draws it. */
  hover: string | null;
  /** The marker whose card is open. */
  selected: string | null;
  /** The open day's stops; empty on the Places tab or with every Plan tab day closed. */
  focus: ReadonlySet<string>;
  /** Hovering with no day open (the map's `is-spotlight` class dims routes, stop chips and clusters). */
  spotlight: boolean;
}

/** The ids of the focused day's stops (places and nearby spots); empty when no day is focused. */
function focusRefs(plan: TripPlan, focusDay: number | null): ReadonlySet<string> {
  const day = focusDay == null ? undefined : plan.dayByNumber.get(focusDay);
  return new Set(day ? day.stops.flatMap((s) => (s.ref ? [s.ref] : [])) : []);
}

export function mapEmphasis(plan: TripPlan, focusDay: number | null, hover: string | null, selected: string | null): MapEmphasis {
  const focus = focusRefs(plan, focusDay);
  return { hover, selected, focus, spotlight: hover != null && focus.size === 0 };
}

/** A place pin or nearby dot at full opacity. */
export function isLit({ hover, selected, focus, spotlight }: MapEmphasis, id: string): boolean {
  if (id === hover) return true;
  if (spotlight) return id === selected;
  return focus.size === 0 || focus.has(id);
}

/** Hidden places fade unless hovered; a spotlight overrides that fade like it overrides the day. */
export function pinOpacity(emphasis: MapEmphasis, id: string, hidden: ReadonlySet<string>): number {
  if (id !== emphasis.hover && !emphasis.spotlight && hidden.has(id)) return HIDDEN_OPACITY;
  return isLit(emphasis, id) ? 1 : DIMMED_OPACITY;
}
