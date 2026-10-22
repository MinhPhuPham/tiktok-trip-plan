import { describe, expect, it } from "vitest";
import { swipeStep } from "./swipe";

describe("swipeStep", () => {
  it("a swipe is horizontal, dominant and at least 40 px", () => {
    expect(swipeStep(-40, 0)).toBe(1);
    expect(swipeStep(55, 10)).toBe(-1);
    expect(swipeStep(-39, 0)).toBeNull();
    expect(swipeStep(-60, 60)).toBeNull();
    expect(swipeStep(10, -80)).toBeNull();
  });
});
