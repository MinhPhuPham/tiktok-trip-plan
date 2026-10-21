import { describe, expect, it } from "vitest";
import type { Filters } from "../state/store";
import { makeDay, makePlace, makeStop, makeTrip } from "../test/fixtures";
import { intentCounts, listedPlaces, visiblePlaceIds } from "./filters";
import { getTripPlan } from "./hooks";
import { countIntents, INTENT_IDS, intentIndex, openAtNight, rankByIntents, type IntentId } from "./intents";
import { buildTripModel } from "./model";
import { planFromData, type MapPlace, type OpeningPeriod, type TripData } from "./types";

const daily = (open: string, close: string | null): OpeningPeriod[] =>
  Array.from({ length: 7 }, (_, day) => ({ day, open, close }));
const hours = (periods: OpeningPeriod[]): MapPlace["hours"] => ({ en: "", vi: "", periods });
const best = (range: string): MapPlace["best_time"] => ({ hours: range, days: null, months: null, deadline: null, source: "heuristic" });

const places = [
  makePlace("pho", { tags: ["breakfast"], best_time: best("06:30–09:00"), rating: 4.2 }),
  makePlace("banh", { tags: ["breakfast", "lunch"], priority: "high", hours: hours(daily("10:00", "14:00")), rating: 4.8 }),
  makePlace("xoi", { tags: ["breakfast"], best_time: best("06:00–08:00"), rating: 4 }),
  makePlace("bun", { tags: ["lunch"], priority: "must" }),
  makePlace("lau", { tags: ["dinner", "view"], hours: hours(daily("15:00", "23:00")) }),
  makePlace("kem", { tags: ["dessert"] }),
  makePlace("oc", { tags: ["snack", "late_night", "view"] }),
  makePlace("garden-cafe", { category: "cafe", tags: ["garden"], rating: 4.1 }),
  makePlace("plain-cafe", { category: "cafe", rating: 4.9 }),
  makePlace("hill", { category: "attraction", tags: ["sunrise", "cloud_hunting", "view", "photo_spot", "nature"], hours: hours(daily("00:00", null)) }),
  makePlace("lake", { category: "attraction", tags: ["sunset", "garden"], hours: hours(daily("06:00", "20:30")) }),
  makePlace("museum", { category: "attraction", tags: ["history", "family"] }),
  makePlace("market", { category: "other", tags: ["shopping"] }),
];

const trip = (patch: Partial<TripData> = {}): TripData =>
  makeTrip({ places, days: [makeDay(1, [makeStop("place", "xoi", { number: 1, slot: "breakfast" })])], unplaced: [], ...patch });

const model = buildTripModel(trip());
const plan = getTripPlan(model, planFromData(model.data));
const index = intentIndex(model);
const none: Filters = { q: "", day: "all", priorities: new Set(), categories: new Set(), intents: new Set() };
const members = (id: IntentId) => [...(index.members.get(id) ?? [])].sort();
const ids = (list: readonly MapPlace[]) => list.map((p) => p.id);

describe("intents", () => {
  it("maps each intent to its tags, category or rule", () => {
    expect(members("breakfast")).toEqual(["banh", "pho", "xoi"]);
    expect(members("lunch")).toEqual(["banh", "bun"]);
    expect(members("dinner")).toEqual(["lau"]);
    expect(members("snack")).toEqual(["kem", "oc"]);
    expect(members("late_night")).toEqual(["oc"]);
    expect(members("cafe")).toEqual(["garden-cafe", "plain-cafe"]);
    expect(members("sunrise")).toEqual(["hill"]);
    expect(members("clouds")).toEqual(["hill"]);
    expect(members("sunset")).toEqual(["lake"]);
    expect(members("night")).toEqual(["lau", "oc"]);
    expect(members("view")).toEqual(["hill", "lau", "oc"]);
    expect(members("photo")).toEqual(["hill"]);
    expect(members("nature")).toEqual(["garden-cafe", "hill", "lake"]);
    expect(members("family")).toEqual(["museum"]);
    expect(members("history")).toEqual(["museum"]);
    expect(members("shopping")).toEqual(["market"]);
    expect(index.available).toEqual(INTENT_IDS);
  });

  it("counts night views only for places really open late", () => {
    expect(openAtNight(daily("15:00", "23:00"))).toBe(true);
    expect(openAtNight(daily("17:00", "02:00"))).toBe(true);
    expect(openAtNight([{ day: 5, open: "18:00", close: "21:00" }])).toBe(true);
    expect(openAtNight(daily("06:00", "20:30"))).toBe(false);
    expect(openAtNight(daily("00:00", null))).toBe(false);
    expect(openAtNight(daily("00:00", "23:59"))).toBe(false);
    expect(openAtNight([])).toBe(false);
  });

  it("hides intents nothing fits, and night views with fewer than two places", () => {
    const one = buildTripModel(trip({ places: places.filter((p) => p.id !== "oc") }));
    expect(intentIndex(one).available).not.toContain("night");
    expect(intentIndex(one).available).not.toContain("late_night");
    const untagged = buildTripModel(trip({ places: places.map((p) => ({ ...p, tags: [] })) }));
    expect(intentIndex(untagged).available).toEqual(["cafe"]);
  });

  it("counts the given places per available intent", () => {
    const counts = countIntents(index, places.filter((p) => p.category === "food"));
    expect(counts.get("breakfast")).toBe(3);
    expect(counts.get("cafe")).toBe(0);
    expect([...counts.keys()]).toEqual(index.available);
  });

  it("lists the union of the chosen intents, ranked for them", () => {
    const list = (patch: Partial<Filters>) =>
      ids(listedPlaces(model, plan, { filters: { ...none, ...patch }, hidden: new Set(), showHidden: false }));
    expect(list({ intents: new Set(["breakfast"]) })).toEqual(["xoi", "banh", "pho"]);
    expect(list({ intents: new Set(["breakfast", "lunch"]) })).toEqual(["xoi", "bun", "banh", "pho"]);
    expect(list({ intents: new Set(["cafe"]) })).toEqual(["garden-cafe", "plain-cafe"]);
    expect(list({ intents: new Set(["breakfast"]), priorities: new Set(["high"]) })).toEqual(["banh"]);
  });

  it("keeps the map's pins to the chosen intents on the Places tab only", () => {
    const input = { filters: { ...none, intents: new Set(["sunset", "shopping"]) }, hidden: new Set<string>(), showHidden: false };
    expect([...visiblePlaceIds(model, plan, { ...input, tab: "places" })].sort()).toEqual(["lake", "market"]);
    expect(visiblePlaceIds(model, plan, { ...input, tab: "plan" }).size).toBe(places.length);
  });

  it("ranks planned slot, then priority, then a good time, then rating", () => {
    const rank = (list: MapPlace[], intents: string[]) => ids(rankByIntents(list, new Set(intents), index, plan));
    const breakfasts = places.filter((p) => p.tags.includes("breakfast"));
    expect(rank(breakfasts, ["breakfast"])).toEqual(["xoi", "banh", "pho"]);
    const unplanned = getTripPlan(model, { days: [], unplaced: [], edited: true });
    expect(ids(rankByIntents(breakfasts, new Set(["breakfast"]), index, unplanned))).toEqual(["banh", "pho", "xoi"]);
    const sameTier = breakfasts.map((p) => ({ ...p, priority: "medium" }));
    expect(ids(rankByIntents(sameTier, new Set(["breakfast"]), index, unplanned))).toEqual(["pho", "xoi", "banh"]);
  });

  it("counts against the other filters and the hidden places", () => {
    const counts = (patch: Partial<Filters>, hidden: string[] = []) =>
      intentCounts(model, plan, { filters: { ...none, ...patch }, hidden: new Set(hidden), showHidden: false });
    expect(counts({}).get("breakfast")).toBe(3);
    expect(counts({ q: "pho" }).get("breakfast")).toBe(1);
    expect(counts({ categories: new Set(["cafe"]) }).get("breakfast")).toBe(0);
    expect(counts({ day: "1" }).get("breakfast")).toBe(1);
    expect(counts({ intents: new Set(["lunch"]) }).get("breakfast")).toBe(3);
    expect(counts({}, ["pho"]).get("breakfast")).toBe(2);
  });
});
