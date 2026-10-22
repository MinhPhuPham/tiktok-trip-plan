import { describe, expect, it } from "vitest";
import { makePlace } from "../test/fixtures";
import { shownOrder, splitMustGo } from "./filters";

const a = makePlace("a", { priority: "high" });
const b = makePlace("b", { priority: "must" });
const c = makePlace("c", { priority: null });

describe("shownOrder", () => {
  it("puts must-go places first, as the grouped list shows them", () => {
    expect(shownOrder([a, b, c], false).map((p) => p.id)).toEqual(["b", "a", "c"]);
    expect(splitMustGo([a, b, c])).toEqual({ must: [b], rest: [a, c] });
  });

  it("keeps a ranked list and a list without must-go places as they are", () => {
    const ranked = [a, b, c];
    expect(shownOrder(ranked, true)).toBe(ranked);
    const plain = [a, c];
    expect(shownOrder(plain, false)).toBe(plain);
  });
});
