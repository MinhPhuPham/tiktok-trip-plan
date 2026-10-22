export type Step = -1 | 1;

export const SWIPE_MIN_PX = 40;

/** A horizontal swipe of at least `min` pixels: left steps forward, right back. */
export function swipeStep(dx: number, dy: number, min: number = SWIPE_MIN_PX): Step | null {
  if (Math.abs(dx) < min || Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? 1 : -1;
}
