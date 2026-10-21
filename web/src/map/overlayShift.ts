export type Pixels = [x: number, y: number];

export interface MapOverlays {
  /** The open place card's size; null while it is closed. */
  card: { width: number; height: number } | null;
  /** Pixels of the map hidden under the open phone sheet (0 while it rests at the peek). */
  sheet: number;
}

/**
 * Camera offset that keeps a pin in the free part of the map: the pin sits at the map centre minus
 * this, so right of the card on desktop, above the card or the open sheet on phones.
 */
export function overlayShift(phone: boolean, { card, sheet }: MapOverlays): Pixels {
  if (!phone) return card ? [-(card.width + 12) / 2, 0] : [0, 0];
  return [0, Math.max(card ? card.height / 2 + 8 : 0, sheet / 2)];
}

/**
 * The `panBy` offset that brings `pin` to the centre of the visible map (`size` shifted by
 * `shift`), or null when it is already within `tolerance` pixels of it.
 */
export function centringPan(pin: Pixels, size: Pixels, shift: Pixels, tolerance: number): Pixels | null {
  const dx = pin[0] - (size[0] / 2 - shift[0]);
  const dy = pin[1] - (size[1] / 2 - shift[1]);
  return Math.hypot(dx, dy) <= tolerance ? null : [dx, dy];
}
