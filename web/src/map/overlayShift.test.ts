import { describe, expect, it } from "vitest";
import { centringPan, overlayShift, type Pixels } from "./overlayShift";

const SIZE: Pixels = [1000, 800];
const card = { width: 380, height: 300 };
const visibleCentre = (shift: Pixels): Pixels => [SIZE[0] / 2 - shift[0], SIZE[1] / 2 - shift[1]];

describe("overlayShift", () => {
  it("is zero with nothing over the map", () => {
    expect(overlayShift(false, { card: null, sheet: 0 })).toEqual([0, 0]);
    expect(overlayShift(true, { card: null, sheet: 0 })).toEqual([0, 0]);
  });

  it("puts the centre of the area right of the desktop card", () => {
    const [x] = visibleCentre(overlayShift(false, { card, sheet: 0 }));
    const cardRight = 12 + card.width;
    expect(x).toBe((cardRight + SIZE[0]) / 2);
  });

  it("ignores the sheet on desktop, where the panel sits beside the map", () => {
    expect(overlayShift(false, { card: null, sheet: 500 })).toEqual([0, 0]);
  });

  it("puts the centre of the area above the open phone sheet", () => {
    const [, y] = visibleCentre(overlayShift(true, { card: null, sheet: 600 }));
    expect(y).toBe((SIZE[1] - 600) / 2);
  });

  it("clears whichever covers more on phones, the card or the sheet", () => {
    expect(overlayShift(true, { card, sheet: 100 })).toEqual([0, card.height / 2 + 8]);
    expect(overlayShift(true, { card, sheet: 600 })).toEqual([0, 300]);
  });
});

describe("centringPan", () => {
  it("moves the pin onto the map centre", () => {
    expect(centringPan([900, 100], SIZE, [0, 0], 24)).toEqual([400, -300]);
  });

  it("aims at the centre right of the card", () => {
    const shift = overlayShift(false, { card, sheet: 0 });
    const [cx, cy] = visibleCentre(shift);
    expect(centringPan([100, 400], SIZE, shift, 24)).toEqual([100 - cx, 400 - cy]);
  });

  it("aims at the centre above the phone sheet", () => {
    const shift = overlayShift(true, { card: null, sheet: 600 });
    expect(centringPan([500, 700], SIZE, shift, 24)).toEqual([0, 600]);
  });

  it("leaves a pin within the tolerance alone", () => {
    expect(centringPan([515, 415], SIZE, [0, 0], 24)).toBeNull();
    expect(centringPan([524, 400], SIZE, [0, 0], 24)).toBeNull();
    expect(centringPan([525, 400], SIZE, [0, 0], 24)).toEqual([25, 0]);
  });
});
