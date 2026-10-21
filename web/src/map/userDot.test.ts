import { describe, expect, it } from "vitest";
import { accuracyShown, MAX_ACCURACY_M, metersPerPixel } from "./userDot";

describe("metersPerPixel", () => {
  it("halves with every zoom level and shrinks towards the poles", () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156_543, 0);
    expect(metersPerPixel(0, 15) * 2).toBeCloseTo(metersPerPixel(0, 14), 6);
    expect(metersPerPixel(60, 10)).toBeCloseTo(metersPerPixel(0, 10) / 2, 6);
  });
});

describe("accuracyShown", () => {
  const phone: [number, number] = [390, 736];

  it("shows a circle smaller than the view", () => {
    expect(accuracyShown(25, 6, phone)).toBe(true);
    expect(accuracyShown(400, 300, phone)).toBe(true);
  });

  it("hides a circle that would tint the whole view", () => {
    expect(accuracyShown(900, Math.hypot(390, 736) / 2, phone)).toBe(false);
  });

  it("hides anything wider than 2 km, whatever the zoom", () => {
    expect(accuracyShown(MAX_ACCURACY_M, 20, phone)).toBe(true);
    expect(accuracyShown(MAX_ACCURACY_M + 1, 20, phone)).toBe(false);
  });
});
