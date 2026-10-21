import { describe, expect, it } from "vitest";
import { scrollBackTo } from "./dom";

function scroller(scrollTop: number, anchorTop: number) {
  const box = document.createElement("div");
  box.style.overflowY = "auto";
  const anchor = document.createElement("div");
  box.append(anchor);
  document.body.append(box);
  box.scrollTop = scrollTop;
  box.getBoundingClientRect = () => DOMRect.fromRect({ y: 100, height: 400 });
  anchor.getBoundingClientRect = () => DOMRect.fromRect({ y: anchorTop, height: 1 });
  return { box, anchor };
}

describe("scrollBackTo", () => {
  it("scrolls back up when the anchor is above the visible area", () => {
    const { box, anchor } = scroller(900, -500);
    scrollBackTo(anchor);
    expect(box.scrollTop).toBe(300);
  });

  it("leaves the scroll alone while the anchor is still below the top", () => {
    const { box, anchor } = scroller(40, 180);
    scrollBackTo(anchor);
    expect(box.scrollTop).toBe(40);
  });
});
