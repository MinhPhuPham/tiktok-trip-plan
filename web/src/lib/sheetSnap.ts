/** Resting heights of the phone bottom sheet, top (most open) first. */
export const DETENTS = ["full", "half", "peek"] as const;
export type SheetDetent = (typeof DETENTS)[number];
export type OpenDetent = Exclude<SheetDetent, "peek">;

/** translateY of the sheet at each detent (0 = fully open). */
export type SheetOffsets = Readonly<Record<SheetDetent, number>>;

export interface DragSample {
  /** Event time in ms. */
  t: number;
  /** Finger position in px. */
  y: number;
}

/** Movement before a press becomes a drag (taps and horizontal swipes stay below it). */
export const DRAG_SLOP_PX = 6;
/** Release velocity comes from the samples of this last stretch of the gesture. */
const VELOCITY_WINDOW_MS = 80;
/** A release lands where the sheet would be after coasting this long. */
const PROJECTION_MS = 200;
/** From this speed (px/ms) a release always moves past the nearest detent in its direction. */
const FLICK_VELOCITY = 0.5;
const HALF_RATIO = 0.5;
/** The half detent shows at least this much list above the peek. */
const MIN_HALF_GAIN = 160;
/** iOS-like resistance: the sheet moves less and less the further it is pulled past an end. */
const RUBBER_BAND = 0.55;

export const SETTLE_MS = 320;
export const SETTLE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export interface SheetGeometry {
  sheetHeight: number;
  /** Visible height of the collapsed sheet: handle, peek row and the bottom safe area. */
  peekHeight: number;
  viewportHeight: number;
}

export function sheetOffsets({ sheetHeight, peekHeight, viewportHeight }: SheetGeometry): SheetOffsets {
  const peek = Math.max(0, sheetHeight - peekHeight);
  const halfVisible = Math.min(sheetHeight, Math.max(peekHeight + MIN_HALF_GAIN, Math.round(viewportHeight * HALF_RATIO)));
  return { full: 0, half: Math.min(peek, Math.max(0, sheetHeight - halfVisible)), peek };
}

/** The neighbouring detent: -1 opens further (toward full), 1 lowers (toward peek); clamped at the ends. */
export function stepDetent(detent: SheetDetent, direction: -1 | 1): SheetDetent {
  const index = DETENTS.indexOf(detent) + direction;
  return DETENTS[Math.min(DETENTS.length - 1, Math.max(0, index))] ?? detent;
}

const band = (overshoot: number, size: number): number => (1 - 1 / ((overshoot * RUBBER_BAND) / size + 1)) * size;

/** Position with resistance outside [min, max]; `size` scales how soon the pull stiffens. */
export function rubberBand(y: number, min: number, max: number, size: number): number {
  if (size <= 0) return Math.min(max, Math.max(min, y));
  if (y < min) return min - band(min - y, size);
  if (y > max) return max + band(y - max, size);
  return y;
}

/** Finger velocity in px/ms (positive = downward) over the last 80 ms; 0 when the finger rested. */
export function releaseVelocity(samples: readonly DragSample[], now: number): number {
  const recent = samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);
  const first = recent[0];
  const last = recent.at(-1);
  if (!first || !last || last.t <= first.t) return 0;
  return (last.y - first.y) / (last.t - first.t);
}

const nearest = (offsets: SheetOffsets, y: number, among: readonly SheetDetent[] = DETENTS): SheetDetent =>
  among.reduce((best, d) => (Math.abs(offsets[d] - y) < Math.abs(offsets[best] - y) ? d : best));

/**
 * Where a released sheet settles: the detent nearest to its projected position, and for a flick at
 * least the next detent in the flick's direction.
 */
export function pickDetent(offsets: SheetOffsets, y: number, velocity: number): SheetDetent {
  const target = nearest(offsets, y + velocity * PROJECTION_MS);
  if (Math.abs(velocity) < FLICK_VELOCITY) return target;
  const direction = Math.sign(velocity);
  if ((offsets[target] - y) * direction > 0) return target;
  const ahead = DETENTS.filter((d) => (offsets[d] - y) * direction > 0);
  return ahead.length ? nearest(offsets, y, ahead) : target;
}

/**
 * An ease-out whose start speed matches the release velocity, so the sheet carries on from the
 * finger instead of restarting; a slow or opposite release gets a gentle ease-out.
 */
export function settleEase(distance: number, velocity: number, durationMs = SETTLE_MS): string {
  if (Math.abs(distance) < 1) return SETTLE_EASE;
  const toward = Math.sign(velocity) === Math.sign(distance) ? Math.abs(velocity) : 0;
  const slope = Math.min(10, Math.max(2, (toward * durationMs) / Math.abs(distance)));
  const y1 = Math.min(1, slope * 0.3);
  const x1 = y1 / slope;
  return `cubic-bezier(${x1.toFixed(3)}, ${y1.toFixed(3)}, 0.36, 1)`;
}

/** How far the header has replaced the peek row: 0 at the peek, 1 from the half detent up. */
export function openProgress(offsets: SheetOffsets, y: number): number {
  const span = offsets.peek - offsets.half;
  if (span <= 0) return y < offsets.peek ? 1 : 0;
  return Math.min(1, Math.max(0, (offsets.peek - y) / span));
}
