import type { Pixels } from "./overlayShift";

/** A circle wider than this says nothing useful about where the user is. */
export const MAX_ACCURACY_M = 2000;
/** Moves of the dot within this distance of the visible centre do not pan a following map. */
export const FOLLOW_TOLERANCE_PX = 16;
export const FOLLOW_INTERVAL_MS = 1000;
/** map.css .user-loc */
export const USER_DOT_SIZE = 22;

const EQUATOR_M = 40_075_016.686;

/** Ground metres per screen pixel at `lat` and `zoom` (Web Mercator, 256 px tiles). */
export function metersPerPixel(lat: number, zoom: number): number {
  return (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / 2 ** (zoom + 8);
}

/**
 * The accuracy circle shows while it means something: within MAX_ACCURACY_M and smaller than the
 * view (a circle reaching every corner of a centred view only tints the map).
 */
export function accuracyShown(accuracyM: number, radiusPx: number, view: Pixels): boolean {
  return accuracyM <= MAX_ACCURACY_M && radiusPx < Math.hypot(view[0], view[1]) / 2;
}

export const USER_DOT_HTML =
  '<div class="user-loc"><span class="user-loc-cone"></span><span class="user-loc-halo"></span><span class="user-loc-dot"></span></div>';
