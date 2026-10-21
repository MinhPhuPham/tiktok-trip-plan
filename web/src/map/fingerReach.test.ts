import type { LeafletMouseEvent } from "leaflet";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFingerReach, FINGER_REACH_PX } from "./fingerReach";
import L from "./leafletGlobal";

function setup() {
  const element = document.createElement("div");
  document.body.append(element);
  const map = L.map(element, { fadeAnimation: false, zoomAnimation: false }).setView([10.77, 106.7], 14);
  const reach = createFingerReach(map);
  const near = L.marker([10.77, 106.7]).addTo(map);
  const origin = map.latLngToContainerPoint(near.getLatLng());
  const far = L.marker(map.containerPointToLatLng(origin.add([20, 0]))).addTo(map);
  const clicks = { near: vi.fn(), far: vi.fn() };
  near.on("click", clicks.near);
  far.on("click", clicks.far);
  reach.add(() => [near, far]);
  const tap = (dx: number, pointerType: string, detail = 1) =>
    reach.claim({
      containerPoint: origin.add([dx, 0]),
      originalEvent: Object.assign(new MouseEvent("click", { detail }), { pointerType }),
    } as unknown as LeafletMouseEvent);
  const cleanup = () => {
    map.remove();
    element.remove();
  };
  return { tap, clicks, cleanup };
}

describe("createFingerReach", () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it("clicks the nearest drawn target within reach of a finger tap", () => {
    const s = setup();
    cleanup = s.cleanup;
    expect(s.tap(-12, "touch")).toBe(true);
    expect(s.clicks.near).toHaveBeenCalledOnce();
    expect(s.tap(14, "touch")).toBe(true);
    expect(s.clicks.far).toHaveBeenCalledOnce();
    expect(s.tap(-FINGER_REACH_PX - 4, "touch")).toBe(false);
  });

  it("leaves mouse clicks and keyboard activation alone", () => {
    const s = setup();
    cleanup = s.cleanup;
    expect(s.tap(-6, "mouse")).toBe(false);
    expect(s.tap(-6, "touch", 0)).toBe(false);
    expect(s.clicks.near).not.toHaveBeenCalled();
  });
});
