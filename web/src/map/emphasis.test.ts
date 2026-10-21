import { describe, expect, it } from "vitest";
import { buildTripModel } from "../data/model";
import { planFromData } from "../data/types";
import { getTripPlan } from "../data/hooks";
import { makeTrip } from "../test/fixtures";
import { HIDDEN_OPACITY, isLit, mapEmphasis, pinOpacity } from "./emphasis";
import { DIMMED_OPACITY } from "./mapCore";

describe("mapEmphasis", () => {
  const data = makeTrip();
  const model = buildTripModel(data);
  const plan = getTripPlan(model, planFromData(data));
  const lit = (focusDay: number | null, hover: string | null, selected: string | null = null) => {
    const emphasis = mapEmphasis(plan, focusDay, hover, selected);
    return ["a", "b", "c", "n1"].filter((id) => isLit(emphasis, id));
  };

  it("lights everything with no day open and nothing hovered", () => {
    expect(mapEmphasis(plan, null, null, null).spotlight).toBe(false);
    expect(lit(null, null)).toEqual(["a", "b", "c", "n1"]);
  });

  it("lights only the open day's stops while nothing is hovered", () => {
    expect(mapEmphasis(plan, 1, null, null).spotlight).toBe(false);
    expect(lit(1, null)).toEqual(["a", "n1"]);
    expect(lit(1, null, "c")).toEqual(["a", "n1"]);
  });

  it("keeps the open day lit when one of its stops is hovered", () => {
    expect(mapEmphasis(plan, 1, "a", null).spotlight).toBe(false);
    expect(lit(1, "a")).toEqual(["a", "n1"]);
    expect(lit(1, "n1")).toEqual(["a", "n1"]);
  });

  it("adds a hovered place outside the open day to the lit day", () => {
    expect(mapEmphasis(plan, 1, "b", null).spotlight).toBe(false);
    expect(lit(1, "b")).toEqual(["a", "b", "n1"]);
  });

  it("spotlights the hovered marker and the open card when no day is open", () => {
    expect(mapEmphasis(plan, null, "b", null).spotlight).toBe(true);
    expect(lit(null, "b")).toEqual(["b"]);
    expect(lit(null, "b", "c")).toEqual(["b", "c"]);
  });

  it("treats a focus day without stops as no day open", () => {
    expect(mapEmphasis(plan, 9, "b", null).spotlight).toBe(true);
    expect(lit(9, "b")).toEqual(["b"]);
  });

  it("fades hidden pins unless hovered or under a spotlight", () => {
    const hidden = new Set(["a", "c"]);
    expect(pinOpacity(mapEmphasis(plan, null, null, null), "a", hidden)).toBe(HIDDEN_OPACITY);
    expect(pinOpacity(mapEmphasis(plan, 1, "b", null), "a", hidden)).toBe(HIDDEN_OPACITY);
    expect(pinOpacity(mapEmphasis(plan, 1, "b", null), "b", hidden)).toBe(1);
    expect(pinOpacity(mapEmphasis(plan, 1, "a", null), "a", hidden)).toBe(1);
    expect(pinOpacity(mapEmphasis(plan, 1, null, null), "b", hidden)).toBe(DIMMED_OPACITY);
    expect(pinOpacity(mapEmphasis(plan, null, "b", null), "c", hidden)).toBe(DIMMED_OPACITY);
  });
});
