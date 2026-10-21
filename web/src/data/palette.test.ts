import { describe, expect, it } from "vitest";
import { makeTrip } from "../test/fixtures";
import type { TripData } from "./types";
import { buildTripModel } from "./model";
import { DEFAULT_CATEGORY_COLORS, DEFAULT_CATEGORY_INK } from "./palette";
import schema from "./trip.schema.json";

describe("category palette", () => {
  it("mirrors the export defaults", () => {
    expect(schema.properties.category_colors.default).toEqual(DEFAULT_CATEGORY_COLORS);
    expect(schema.properties.category_ink.default).toEqual(DEFAULT_CATEGORY_INK);
  });

  it("uses the export's colours and falls back to the built-in copy for older data", () => {
    const current = buildTripModel(makeTrip({ category_colors: { food: "#123456" }, category_ink: { food: "#ffffff" } }));
    expect(current.categoryColor("food")).toBe("#123456");
    expect(current.categoryInk("food")).toBe("#ffffff");
    expect(current.categoryColor("cafe")).toBe(DEFAULT_CATEGORY_COLORS.cafe);

    const { category_colors: _colors, category_ink: _ink, ...older } = makeTrip();
    const legacy = buildTripModel(older as TripData);
    expect(legacy.categoryColor("attraction")).toBe(DEFAULT_CATEGORY_COLORS.attraction);
    expect(legacy.categoryInk("attraction")).toBe(DEFAULT_CATEGORY_INK.attraction);
    expect(legacy.categoryColor("unknown")).toBe(DEFAULT_CATEGORY_COLORS.other);
  });
});
