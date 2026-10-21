import { makeDay, makePlace, makeStop, makeTrip } from "../test/fixtures";
import { advancedFilterCount, filtersActive, listedPlaces, visiblePlaceIds } from "./filters";
import { buildTripModel } from "./model";
import { directionsFor, normalizePlan } from "./plan";
import { peekStart, stopName, stopTime, todayTripDay } from "./stops";
import { createTranslator } from "../i18n/translator";
import { planFromData } from "./types";

const model = buildTripModel(makeTrip());
const filters = { q: "", day: "all", sectors: new Set<string>(), priorities: new Set<string>(), categories: new Set<string>(), tags: new Set<string>() };

describe("trip model", () => {
  it("orders places by priority, then distance", () => {
    expect(model.places.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(model.target("center")?.type).toBe("center");
    expect(model.target("n1")?.type).toBe("nearby");
    expect(model.target("nope")).toBeNull();
    expect(model.sectorInk("N")).toBe("#ffffff");
    expect(model.sectorColor("missing")).toBe("#9e9e9e");
  });
});

describe("normalizePlan", () => {
  it("numbers visits and records each place's day", () => {
    const plan = normalizePlan(model, planFromData(model.data));
    expect(plan.days[0]?.stops.map((s) => s.number)).toEqual([null, 1, 2, null]);
    expect(plan.placeSlots.get("a")).toEqual({ day: 1, stop: 1 });
    expect(plan.visitCount).toBe(2);
    expect(plan.days[0]?.areas).toBe("N");
  });

  it("recomputes areas and directions for an edited day", () => {
    const edited = [makeDay(1, [makeStop("start", null), makeStop("place", "b"), makeStop("end", null)])];
    const plan = normalizePlan(model, { days: edited, unplaced: [], edited: true });
    expect(plan.days[0]?.areas).toBe("E");
    expect(plan.days[0]?.directions).toHaveLength(1);
    expect(plan.placeSlots.has("a")).toBe(false);
  });

  it("splits directions into legs of at most 9 waypoints", () => {
    const points = Array.from({ length: 23 }, (_, i) => [10 + i / 100, 106] as const);
    const urls = directionsFor(points, "walking");
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain("travelmode=walking");
  });
});

describe("stops", () => {
  const t = createTranslator(model.data.labels.en!, "en");
  const plan = normalizePlan(model, planFromData(model.data));

  it("names and times stops", () => {
    const [start, place] = plan.days[0]!.stops;
    expect(stopName(model, t, start!)).toBe("Hotel");
    expect(stopName(model, t, place!)).toBe("Phở Gia Truyền");
    expect(stopTime(t, place!)).toBe("9:00–10:00 AM");
  });

  it("follows the clock only on a trip day of a dated trip", () => {
    const morning = new Date(2026, 9, 20, 10, 30);
    expect(peekStart(model, plan, 1, morning)).toMatchObject({ stop: { ref: "a" }, live: false });
    const dated = buildTripModel({ ...model.data, tripDates: ["2026-10-20", null, null] });
    expect(todayTripDay(dated.data, morning)).toBe(1);
    expect(todayTripDay(dated.data, new Date(2026, 9, 21))).toBeNull();
    expect(peekStart(dated, plan, 1, morning)).toMatchObject({ stop: { ref: "n1" }, live: true });
    expect(peekStart(dated, plan, 1, new Date(2026, 9, 20, 20, 0))).toMatchObject({ stop: { ref: "a" }, live: false });
  });
});

describe("filters", () => {
  const plan = normalizePlan(model, planFromData(model.data));

  it("matches folded search words, days and sets", () => {
    const list = (patch: Partial<typeof filters>) =>
      listedPlaces(model, plan, { filters: { ...filters, ...patch }, hidden: new Set(), showHidden: false }).map((p) => p.id);
    expect(list({ q: "pho" })).toEqual(["a"]);
    expect(list({ q: "dia phuong" })).toEqual(["a"]);
    expect(list({ day: "1" })).toEqual(["a"]);
    expect(list({ day: "none" })).toEqual(["b", "c"]);
    expect(list({ priorities: new Set(["none"]) })).toEqual(["c"]);
    expect(advancedFilterCount({ ...filters, tags: new Set(["local"]) })).toBe(1);
    expect(filtersActive(filters)).toBe(false);
  });

  it("keeps hidden places off the map unless shown", () => {
    const input = { tab: "plan" as const, filters: { ...filters, q: "zzz" }, hidden: new Set(["b"]), showHidden: false };
    expect([...visiblePlaceIds(model, plan, input)]).toEqual(["a", "c"]);
    expect(visiblePlaceIds(model, plan, { ...input, tab: "places" }).size).toBe(0);
  });
});

it("builds a model from places with unknown priorities", () => {
  const custom = buildTripModel(makeTrip({ places: [makePlace("x", { priority: "weird" }), makePlace("y")] }));
  expect(custom.places.map((p) => p.id)).toEqual(["y", "x"]);
});
