const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3_OR_6 = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
export const FALLBACK_COLOR = "#9e9e9e";

export function safeColor(color: string | null | undefined): string {
  return color && HEX6.test(color) ? color : FALLBACK_COLOR;
}

export function isInkColor(color: string | null | undefined): color is string {
  return Boolean(color && HEX3_OR_6.test(color));
}

function channel(hex: string, at: number): number {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Black or white, whichever has the higher WCAG contrast ratio on the fill. */
export function inkFor(fill: string | null | undefined): "#000000" | "#ffffff" {
  const color = safeColor(fill);
  const lum = 0.2126 * channel(color, 1) + 0.7152 * channel(color, 3) + 0.0722 * channel(color, 5);
  return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? "#000000" : "#ffffff";
}
