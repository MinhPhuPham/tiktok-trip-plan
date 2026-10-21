import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTripModel } from "../data/model";
import { planFromData } from "../data/types";
import type { UserFix } from "../location/position";
import { createTripStore, type TripStoreApi } from "../state/store";
import { makeTrip } from "../test/fixtures";
import L from "./leafletGlobal";
import { USER_PANE } from "./mapCore";
import { FOLLOW_INTERVAL_MS } from "./userDot";
import { startUserLayer } from "./userLayer";

const HERE: UserFix = { lat: 11.9404, lng: 108.4419, accuracy: 25, heading: null };

function setup() {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { value: 400 });
  Object.defineProperty(element, "clientHeight", { value: 600 });
  document.body.append(element);
  const map = L.map(element, { fadeAnimation: false, zoomAnimation: false }).setView([11.95, 108.43], 13);
  const pane = map.createPane(USER_PANE);
  pane.style.pointerEvents = "none";
  const data = makeTrip();
  const store: TripStoreApi = createTripStore({
    city: data.city,
    langs: buildTripModel(data).langs,
    defaultLang: "en",
    plan: planFromData(data),
    phone: false,
    persistence: null,
  });
  const stop = startUserLayer(map, store);
  const actions = () => store.getState().actions;
  const mode = () => store.getState().locate.mode;
  const follow = (fix: UserFix = HERE) => {
    actions().locate({ type: "tap" });
    actions().receiveFix(fix);
  };
  const cleanup = () => {
    stop();
    map.remove();
    element.remove();
  };
  return { map, pane, store, actions, mode, follow, cleanup };
}

/** Moves without animation, so every camera move ends within the call. */
function reducedMotion(): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList,
  );
}

describe("startUserLayer", () => {
  beforeEach(() => {
    reducedMotion();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("draws the dot in its own click-through pane, never interactive", () => {
    const { pane, actions, cleanup } = setup();
    expect(pane.querySelector(".user-loc")).toBeNull();
    actions().locate({ type: "granted" });
    actions().receiveFix(HERE);
    const icon = pane.querySelector<HTMLElement>(".user-loc-wrap");
    expect(icon).not.toBeNull();
    expect(icon!.classList.contains("leaflet-interactive")).toBe(false);
    expect(pane.style.pointerEvents).toBe("none");
    actions().locate({ type: "tap" });
    actions().locate({ type: "tap" });
    expect(pane.querySelector(".user-loc")).toBeNull();
    cleanup();
  });

  it("the silent start shows the dot without moving the map", () => {
    const { map, actions, cleanup } = setup();
    const before = map.getCenter();
    actions().locate({ type: "granted" });
    actions().receiveFix(HERE);
    expect(map.getCenter()).toEqual(before);
    expect(map.getZoom()).toBe(13);
    cleanup();
  });

  it("the first fix after a tap centres the dot at zoom 15 or closer", () => {
    const { map, follow, mode, cleanup } = setup();
    follow();
    expect(mode()).toBe("following");
    expect(map.getZoom()).toBe(15);
    const dot = map.latLngToContainerPoint([HERE.lat, HERE.lng]);
    expect(Math.abs(dot.x - 200)).toBeLessThan(2);
    expect(Math.abs(dot.y - 300)).toBeLessThan(2);
    cleanup();
  });

  it("keeps a closer zoom", () => {
    const { map, follow, cleanup } = setup();
    map.setZoom(17);
    follow();
    expect(map.getZoom()).toBe(17);
    cleanup();
  });

  it("follows later fixes with its own pans, at most once a second, and stays following", () => {
    const { map, actions, follow, mode, cleanup } = setup();
    follow();
    const moved = { ...HERE, lat: HERE.lat + 0.002 };
    actions().receiveFix(moved);
    expect(map.latLngToContainerPoint([moved.lat, moved.lng]).y).toBeLessThan(290);
    vi.advanceTimersByTime(FOLLOW_INTERVAL_MS);
    expect(mode()).toBe("following");
    expect(Math.abs(map.latLngToContainerPoint([moved.lat, moved.lng]).y - 300)).toBeLessThan(2);
    cleanup();
  });

  it("small moves within the tolerance do not pan", () => {
    const { map, actions, follow, cleanup } = setup();
    follow();
    vi.advanceTimersByTime(FOLLOW_INTERVAL_MS);
    const before = map.getCenter();
    actions().receiveFix({ ...HERE, lat: HERE.lat + 0.00002 });
    expect(map.getCenter()).toEqual(before);
    cleanup();
  });

  it("a camera move it did not start ends following; the dot stays", () => {
    const { map, pane, follow, mode, cleanup } = setup();
    follow();
    map.panBy([60, 0], { animate: false });
    expect(mode()).toBe("showing");
    expect(pane.querySelector(".user-loc")).not.toBeNull();
    cleanup();
  });

  it("a drag ends following even while its own move runs", () => {
    const { map, follow, mode, cleanup } = setup();
    follow();
    map.fire("dragstart");
    expect(mode()).toBe("showing");
    cleanup();
  });

  it("a tap after a pan re-centres and follows again", () => {
    const { map, actions, follow, mode, cleanup } = setup();
    follow();
    map.panBy([120, 80], { animate: false });
    actions().locate({ type: "tap" });
    expect(mode()).toBe("following");
    const dot = map.latLngToContainerPoint([HERE.lat, HERE.lng]);
    expect(Math.hypot(dot.x - 200, dot.y - 300)).toBeLessThan(3);
    cleanup();
  });

  it("hides the accuracy circle beyond 2 km", () => {
    const { pane, actions, cleanup } = setup();
    actions().locate({ type: "granted" });
    actions().receiveFix({ ...HERE, accuracy: 3000 });
    expect(pane.querySelector("path.user-acc")).toBeNull();
    actions().receiveFix({ ...HERE, accuracy: 40 });
    expect(pane.querySelector("path.user-acc")).not.toBeNull();
    cleanup();
  });

  it("points the heading cone along the GPS course", () => {
    const { pane, actions, cleanup } = setup();
    actions().locate({ type: "granted" });
    actions().receiveFix({ ...HERE, heading: 90 });
    const icon = pane.querySelector<HTMLElement>(".user-loc-wrap")!;
    expect(icon.classList.contains("has-heading")).toBe(true);
    expect(icon.style.getPropertyValue("--heading")).toBe("90deg");
    actions().receiveFix(HERE);
    expect(icon.classList.contains("has-heading")).toBe(false);
    cleanup();
  });
});
