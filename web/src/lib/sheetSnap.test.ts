import { describe, expect, it } from "vitest";
import { openProgress, pickDetent, releaseVelocity, rubberBand, settleEase, sheetOffsets, stepDetent } from "./sheetSnap";

/* iPhone 390×844: sheet min(82dvh, 760px) = 692, peek 100. */
const offsets = sheetOffsets({ sheetHeight: 692, peekHeight: 100, viewportHeight: 844 });

describe("sheet snap", () => {
  it("places the detents: full at 0, half shows half the viewport, peek shows the peek height", () => {
    expect(offsets).toEqual({ full: 0, half: 270, peek: 592 });
    expect(sheetOffsets({ sheetHeight: 400, peekHeight: 100, viewportHeight: 420 })).toEqual({ full: 0, half: 140, peek: 300 });
    expect(sheetOffsets({ sheetHeight: 200, peekHeight: 250, viewportHeight: 300 })).toEqual({ full: 0, half: 0, peek: 0 });
  });

  it("steps between neighbouring detents and stops at the ends", () => {
    expect(stepDetent("peek", -1)).toBe("half");
    expect(stepDetent("half", -1)).toBe("full");
    expect(stepDetent("full", -1)).toBe("full");
    expect(stepDetent("full", 1)).toBe("half");
    expect(stepDetent("peek", 1)).toBe("peek");
  });

  it("follows 1:1 inside the range and resists more and more past either end", () => {
    expect(rubberBand(300, 0, 592, 692)).toBe(300);
    const [a = 0, b = 0, c = 0] = [-100, -200, -300].map((y) => rubberBand(y, 0, 592, 692));
    expect(a).toBeLessThan(0);
    expect(a).toBeGreaterThan(-100);
    expect(b - c).toBeLessThan(a - b);
    const down = rubberBand(692, 0, 592, 692);
    expect(down).toBeGreaterThan(592);
    expect(down).toBeLessThan(692);
    expect(rubberBand(-50, 0, 592, 0)).toBe(0);
  });

  it("measures the release velocity over the last 80 ms and reads a resting finger as still", () => {
    const flick = [0, 16, 32, 48, 64, 80, 96].map((t) => ({ t, y: 500 - 2 * t }));
    expect(releaseVelocity(flick, 96)).toBeCloseTo(-2);
    const slowThenFast = [{ t: 0, y: 500 }, { t: 400, y: 480 }, { t: 450, y: 400 }, { t: 480, y: 340 }];
    expect(releaseVelocity(slowThenFast, 480)).toBeCloseTo(-140 / 80);
    expect(releaseVelocity(flick, 300)).toBe(0);
    expect(releaseVelocity([{ t: 10, y: 1 }], 10)).toBe(0);
    expect(releaseVelocity([], 10)).toBe(0);
  });

  it("settles at the detent nearest the projected position", () => {
    expect(pickDetent(offsets, 300, 0)).toBe("half");
    expect(pickDetent(offsets, 120, 0)).toBe("full");
    expect(pickDetent(offsets, 440, 0)).toBe("peek");
    expect(pickDetent(offsets, 420, -0.4)).toBe("half");
    expect(pickDetent(offsets, -30, 0)).toBe("full");
    expect(pickDetent(offsets, 640, 0)).toBe("peek");
  });

  it("moves a flick at least one detent and a fast flick across several", () => {
    expect(pickDetent(offsets, 580, -0.6)).toBe("half");
    expect(pickDetent(offsets, 560, -3)).toBe("full");
    expect(pickDetent(offsets, 12, 0.6)).toBe("half");
    expect(pickDetent(offsets, 20, 3)).toBe("peek");
    expect(pickDetent(offsets, 280, 0.6)).toBe("peek");
    expect(pickDetent(offsets, -10, -2)).toBe("full");
  });

  it("starts the settle at the release speed, gently when the finger rested or moved away", () => {
    const parse = (ease: string) => ease.match(/[\d.]+/g)?.map(Number) ?? [];
    const [x1 = 0, y1 = 0] = parse(settleEase(-200, -2, 320));
    expect(y1 / x1).toBeCloseTo((2 * 320) / 200, 1);
    const [rx1 = 0, ry1 = 0] = parse(settleEase(-200, 0, 320));
    expect(ry1 / rx1).toBeCloseTo(2);
    const [ox1 = 0, oy1 = 0] = parse(settleEase(-200, 1, 320));
    expect(oy1 / ox1).toBeCloseTo(2);
    const [fx1 = 0, fy1 = 0] = parse(settleEase(-20, -5, 320));
    expect(fy1 / fx1).toBeCloseTo(10);
    expect(fy1).toBeLessThanOrEqual(1);
  });

  it("swaps the peek row for the header between the peek and half", () => {
    expect(openProgress(offsets, 592)).toBe(0);
    expect(openProgress(offsets, 431)).toBeCloseTo(0.5);
    expect(openProgress(offsets, 270)).toBe(1);
    expect(openProgress(offsets, 0)).toBe(1);
    expect(openProgress(offsets, 700)).toBe(0);
    expect(openProgress({ full: 0, half: 0, peek: 0 }, 0)).toBe(0);
  });
});
